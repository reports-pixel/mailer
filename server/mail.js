import { createHash } from 'node:crypto';
import { ApiError, config, parseCc } from './config.js';
import { now, query } from './db.js';
import { lookup } from './employees.js';
import { checkPdf, readPdf, resolveFolder } from './pdfs.js';
import { envTransport, resolve as resolveSender } from './senders.js';

/** Whether the server-setting sender (SMTP_USER) can send; shown to the user as-is. Saved senders are checked when added. */
let status = { ready: false, code: 'CHECKING', detail: 'Checking the connection to the mail server…', checkedAt: '' };
let checking;
export const mailStatus = () => status;
/** Verifies once per server instance (each Vercel instance checks on its first request). */
export function ensureMailChecked() {
  if (status.code === 'CHECKING') checking ||= verifyMail().finally(() => { checking = undefined; });
  return checking || Promise.resolve(status);
}

/** Connects, starts TLS and signs in, then disconnects. No message is sent. */
export async function verifyMail() {
  const where = `${config.smtp.host}:${config.smtp.port}`;
  const passwordHelp = config.onVercel ? 'set SMTP_PASSWORD in the Vercel project settings and redeploy' : 'run .\\scripts\\Set-Secret.ps1 SMTP_PASSWORD as Administrator, then .\\scripts\\Portal-Service.ps1 restart';
  let result;
  if (!config.smtp.host || !config.smtp.user) result = { ready: false, code: 'CONFIG_INCOMPLETE', detail: 'SMTP_HOST and SMTP_USER must be set.' };
  else if (!config.smtp.password) result = { ready: false, code: 'NO_PASSWORD', detail: `The Gmail app password has not been set: ${passwordHelp}.` };
  else {
    try {
      await envTransport.verify();
      result = { ready: true, code: 'OK', detail: `Connected and signed in to ${where} as ${config.smtp.user}.` };
    } catch (error) {
      result = error.code === 'EAUTH'
        ? { ready: false, code: 'AUTH_FAILED', detail: `Gmail rejected the sign-in for ${config.smtp.user}. The app password is wrong or was revoked: create a new one and ${passwordHelp}.` }
        : { ready: false, code: 'CONNECTION_FAILED', detail: `Could not connect to ${where} (${error.code || error.message}). Press Check again in a moment.` };
    }
  }
  status = { ...result, checkedAt: now() };
  console.log(`[mail] ${status.code}: ${status.detail}`);
  return status;
}

/** {} is the user code in the subject and the user name in the message; {employeeCode}, {employeeName} and {date} work in both. */
export function personalize(template, employee, blank) {
  const today = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' }).replaceAll('/', '-');
  return String(template).replace(/\{(employeeCode|employeeName|date|)\}/g, (_, name) =>
    name === 'date' ? today : name ? employee[name] : employee[blank]);
}

function checkText(subject, message) {
  if (typeof subject !== 'string' || !subject.trim() || subject.length > 200 || /[\r\n]/.test(subject)) throw new ApiError(400, 'Subject: enter up to 200 characters on one line.');
  if (typeof message !== 'string' || !message.trim() || message.length > 50000) throw new ApiError(400, 'Message: enter up to 50,000 characters.');
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Sends one message and records it. The request ID makes a repeat of an accepted request return the
 * earlier success instead of sending twice; an interrupted or uncertain send is never repeated automatically.
 */
export async function submit({ requestId, senderId, codes, cc, subject, message, attachments }) {
  if (!UUID.test(String(requestId || ''))) throw new ApiError(400, 'A valid Idempotency-Key (UUID) header is required.');
  const sender = await resolveSender(senderId);
  if (sender.builtIn) {
    await ensureMailChecked();
    if (!status.ready) throw new ApiError(503, `Email not sent. ${status.detail}`);
  }
  checkText(subject, message);
  const copy = parseCc(cc);
  const { data, issues } = await lookup(codes, true);
  if (issues.length) throw new ApiError(400, issues.join(' '));
  const to = [...new Map(data.map(e => [e.email.toLowerCase(), e.email])).values()].sort();
  const finalCc = copy.filter(c => !to.some(t => t.toLowerCase() === c.toLowerCase()));
  if (to.length + finalCc.length > config.limits.recipients) throw new ApiError(400, 'Too many recipients.');

  const hash = createHash('sha256').update(JSON.stringify([data.map(e => e.employeeCode).sort(), finalCc, subject, message]));
  for (const a of attachments) hash.update(a.filename).update(a.content);
  const fingerprint = hash.digest('hex');
  const reserved = await query(
    `INSERT INTO email_submission (request_id, fingerprint, subject, submitted_time, status, recipient_count, attachment_count, sender, recipients, cc, employee_codes, attachment_names)
     VALUES ($1, $2, $3, $4, 'SUBMITTING', $5, $6, $7, $8, $9, $10, $11) ON CONFLICT (request_id) DO NOTHING`,
    [requestId, fingerprint, subject, now(), to.length, attachments.length, sender.from, to.join(', '), finalCc.join(', '),
      data.map(e => e.employeeCode).join(', '), attachments.map(a => a.filename).join(', ')]);
  if (!reserved.rowCount) {
    const { rows: [previous] } = await query('SELECT fingerprint, status, recipient_count, attachment_count FROM email_submission WHERE request_id = $1', [requestId]);
    if (previous.fingerprint !== fingerprint) throw new ApiError(409, 'This request ID belongs to a different message. Start a new mail.');
    if (previous.status !== 'SMTP_ACCEPTED') throw new ApiError(409, 'This mail is already being sent, or its result is uncertain. Check History before sending again.');
    return { success: true, message: 'Already sent earlier.', recipientCount: Number(previous.recipient_count), attachmentCount: Number(previous.attachment_count), requestId };
  }
  const setStatus = value => query('UPDATE email_submission SET status = $1 WHERE request_id = $2', [value, requestId]);
  try {
    await sender.transport.sendMail({ from: sender.from, to, cc: finalCc, subject, text: message, attachments });
  } catch (error) {
    if (error.code === 'EAUTH') { await setStatus('SMTP_AUTH_FAILED'); throw new ApiError(502, `Gmail rejected the sign-in for ${sender.from}. Check its app password under Settings → Sender accounts.`); }
    await setStatus('UNKNOWN');
    throw new ApiError(502, `The mail server did not confirm this mail (${error.code || 'error'}). It may or may not have been delivered; check History before sending again.`);
  }
  await setStatus('SMTP_ACCEPTED');
  return { success: true, message: 'Email sent. The mail server accepted it.', recipientCount: to.length, attachmentCount: attachments.length, requestId };
}

/**
 * One user, one PDF, personalised subject and message. The PDF is either uploaded from the folder chosen in the
 * browser (`file`), or, for schedules on the Windows server, read from a server folder (`folder`, checked against `sha256`).
 */
export async function sendEmployeePdf({ requestId, senderId, employeeCode, cc, subject, message, file, folder, sha256 }) {
  checkText(subject, message);
  const { data, issues } = await lookup([employeeCode]);
  if (issues.length) throw new ApiError(400, issues[0]);
  const employee = data[0];
  let pdf;
  if (file) {
    const expected = `${employee.employeeCode}.pdf`;
    if (String(file.name).toLowerCase() !== expected.toLowerCase()) throw new ApiError(400, `The attachment for ${employee.employeeCode} must be named ${expected}.`);
    pdf = checkPdf(expected, file.bytes);
  } else {
    pdf = await readPdf(await resolveFolder(folder), employee.employeeCode);
    if (sha256 && pdf.sha256 !== sha256) throw new ApiError(409, `${pdf.name} changed after it was checked.`);
  }
  return submit({ requestId, senderId, codes: [employee.employeeCode], cc,
    subject: personalize(subject, employee, 'employeeCode'), message: personalize(message, employee, 'employeeName'),
    attachments: [{ filename: pdf.name, content: pdf.bytes, contentType: 'application/pdf' }] });
}

export async function history(page, pageSize) {
  const { rows } = await query(
    `SELECT request_id, subject, submitted_time, status, recipient_count, attachment_count, sender, recipients, cc, employee_codes, attachment_names
     FROM email_submission ORDER BY submitted_time DESC LIMIT $1 OFFSET $2`, [pageSize + 1, (page - 1) * pageSize]);
  return { data: rows.slice(0, pageSize).map(r => ({ requestId: r.request_id, subject: r.subject, submittedTime: r.submitted_time, status: r.status,
    recipientCount: Number(r.recipient_count), attachmentCount: Number(r.attachment_count), sender: r.sender, recipients: r.recipients, cc: r.cc,
    employeeCodes: r.employee_codes, attachmentNames: r.attachment_names })), page, hasMore: rows.length > pageSize };
}
