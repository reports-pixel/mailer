import express from 'express';
import multer from 'multer';
import { currentUser, login, logout, requireLogin } from './auth.js';
import { ApiError, config } from './config.js';
import { migrate } from './db.js';
import * as employees from './employees.js';
import { ensureMailChecked, history, mailStatus, sendEmployeePdf, verifyMail } from './mail.js';
import { browse, preview } from './pdfs.js';
import * as schedules from './scheduler.js';
import * as senders from './senders.js';
import * as settings from './settings.js';

// The API, shared by the Windows service (server/index.js) and Vercel (api/index.js).
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', config.onVercel ? 1 : false);

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
app.use((req, res, next) => {
  // The Windows service answers only this machine. Everywhere, the custom header on every change forces a CORS
  // preflight (never allowed), so other websites cannot use a signed-in browser to send mail.
  const remote = req.socket.remoteAddress || '';
  const local = (remote === '::1' || remote.startsWith('127.') || remote === '::ffff:127.0.0.1') && LOCAL_HOSTS.has(req.hostname);
  if ((config.localOnly && !local) || (req.path.startsWith('/api/') && req.method !== 'GET' && req.get('X-KG-Portal') !== '1'))
    return res.status(403).json({ success: false, message: config.localOnly && !local ? 'The portal can only be used from this server.' : 'Request refused.' });
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': app.get('allowFrames') ? 'SAMEORIGIN' : 'DENY' });
  next();
});

const api = express.Router();
api.use(express.json({ limit: '5mb' }));
api.use(async (req, res, next) => { try { await migrate(); next(); } catch (error) { next(error); } });
const handle = fn => async (req, res, next) => { try { res.json({ success: true, ...(await fn(req, res)) }); } catch (error) { next(error); } };
const page = (value, max = 100000) => { const n = Number(value ?? 1); if (!Number.isInteger(n) || n < 1 || n > max) throw new ApiError(400, 'Invalid page.'); return n; };
const serverOnly = (req, res, next) => config.schedulesEnabled ? next()
  : res.status(404).json({ success: false, message: 'Daily schedules and server folders are only available on the Windows server installation.' });

api.post('/auth/login', handle(login));
api.post('/auth/logout', handle(logout));
api.get('/auth/session', handle(req => ({ username: currentUser(req) })));
api.use(requireLogin);

api.get('/config', handle(async () => {
  await ensureMailChecked();
  // Sending works when the default sender can send: a saved sender was checked when added; the server-setting one at startup.
  const senderList = await senders.list();
  const defaultSender = senderList.find(s => s.isDefault);
  return { sender: defaultSender?.email || '', senders: senderList, defaultCc: await settings.defaultCc(),
    mailEnabled: !!defaultSender && (!defaultSender.builtIn || mailStatus().ready),
    mailStatus: defaultSender && !defaultSender.builtIn ? { ready: true, code: 'OK', detail: `Sending as ${defaultSender.email}.`, checkedAt: '' }
      : defaultSender ? mailStatus() : { ready: false, code: 'NO_SENDER', detail: 'No sender is set up. Add one under Settings (⚙) → Sender accounts.', checkedAt: '' },
    pdfFolder: config.pdfFolder, limits: config.limits, schedulesEnabled: config.schedulesEnabled, users: await employees.summary() };
}));
api.post('/mail/verify', handle(async () => ({ mailStatus: await verifyMail() })));

// Settings: sender accounts, default CC addresses and mail templates.
const senderId = req => { if (!/^[0-9a-f-]{36}$/.test(req.params.id)) throw new ApiError(400, 'Invalid sender.'); return req.params.id; };
api.get('/senders', handle(async () => ({ data: await senders.list() })));
api.post('/senders', handle(req => senders.save(req.body)));
api.post('/senders/:id/default', handle(req => senders.makeDefault(senderId(req))));
api.post('/senders/:id/delete', handle(req => senders.remove(senderId(req))));
api.post('/settings/cc', handle(req => settings.saveDefaultCc(req.body?.cc)));
const templateId = req => { if (!/^[0-9a-f-]{36}$/.test(req.params.id)) throw new ApiError(400, 'Invalid template.'); return req.params.id; };
api.get('/templates', handle(async () => ({ data: await settings.templates() })));
api.post('/templates', handle(req => settings.saveTemplate(null, req.body)));
api.post('/templates/:id', handle(req => settings.saveTemplate(templateId(req), req.body)));
api.post('/templates/:id/delete', handle(req => settings.deleteTemplate(templateId(req))));

api.get('/users', handle(employees.summary));
api.post('/users/import', handle(req => employees.importUsers(req.body)));
api.post('/users/sync', serverOnly, handle(() => employees.syncFromApi()));
api.get('/companies', handle(async () => ({ data: await employees.companies() })));
api.get('/employees', handle(async req => ({ data: await employees.byCompany(req.query.company) })));
api.get('/employees/search', handle(req => employees.search(req.query.q, Number(req.query.limit) || 20, page(req.query.page, 1000))));
api.post('/employees/resolve', handle(req => employees.lookup(req.body?.employeeCodes)));

const upload = multer({ storage: multer.memoryStorage(), limits: { files: config.limits.files, fileSize: config.limits.fileBytes, fieldSize: 60000 } });
// One user's files (PDF, Excel, Word, images, text), uploaded from the folder chosen in the browser.
api.post('/emails/send-employee-pdf', upload.array('files'), handle(req => {
  if (!req.files?.length) throw new ApiError(400, 'The file for this user is missing.');
  return sendEmployeePdf({ requestId: req.get('Idempotency-Key'), senderId: req.body.senderId || undefined, employeeCode: req.body.employeeCode, cc: req.body.cc,
    subject: req.body.subject, message: req.body.message, files: req.files.map(f => ({ name: Buffer.from(f.originalname, 'latin1').toString('utf8'), bytes: f.buffer })) });
}));
api.get('/emails/history', handle(req => {
  const size = Number(req.query.pageSize ?? 10);
  if (!Number.isInteger(size) || size < 1 || size > 100) throw new ApiError(400, 'Invalid page size.');
  return history(page(req.query.page), size);
}));

// Windows server only: browse its folders and run daily schedules from them.
api.get('/folders', serverOnly, handle(req => browse(req.query.path)));
api.get('/attachments/employee-pdfs', serverOnly, handle(req => preview(employees.codes(req.query.employeeCodes), req.query.folder)));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const scheduleId = req => { if (!UUID.test(req.params.id)) throw new ApiError(400, 'Invalid schedule.'); return req.params.id; };
api.get('/schedules', serverOnly, handle(async () => ({ data: await schedules.list(), zone: Intl.DateTimeFormat().resolvedOptions().timeZone })));
api.post('/schedules', serverOnly, handle(async req => ({ data: await schedules.save(null, req.body) })));
api.post('/schedules/:id', serverOnly, handle(async req => ({ data: await schedules.save(scheduleId(req), req.body) })));
api.post('/schedules/:id/delete', serverOnly, handle(async req => { await schedules.remove(scheduleId(req)); return {}; }));
api.get('/schedules/:id/runs', serverOnly, handle(req => schedules.runs(scheduleId(req), page(req.query.page, 10000))));

api.use((req, res) => res.status(404).json({ success: false, message: 'Not found.' }));
api.use((error, req, res, next) => {
  if (error instanceof ApiError) return res.status(error.status).json({ success: false, message: error.message });
  if (error instanceof multer.MulterError) return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ success: false, message: `Upload: ${error.code === 'LIMIT_FILE_SIZE' ? `each file must be under ${Math.round(config.limits.fileBytes / 1048576)} MB` : error.message}.` });
  if (error.type === 'entity.parse.failed') return res.status(400).json({ success: false, message: 'Invalid JSON.' });
  if (error.type === 'entity.too.large') return res.status(413).json({ success: false, message: 'Request too large.' });
  if (/LIBSQL|SQLITE|HRANA|fetch failed|ECONN|ETIMEDOUT/i.test(`${error.code} ${error.message}`)) {
    console.error('[db]', error.message);
    return res.status(503).json({ success: false, message: 'The database (Turso) is unavailable. Check TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.' });
  }
  console.error(error);
  res.status(500).json({ success: false, message: 'Unexpected error. Check History before sending again.' });
});
app.use('/api', api);

export default app;
