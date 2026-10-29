import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import { ApiError, config, validEmail } from './config.js';
import { now, query } from './db.js';

// Sender accounts ("from" addresses). The master list lives in Turso with each app password encrypted (AES-256-GCM).
// The key is SECRET_KEY, or derived from the Turso token, which both the Vercel site and the Windows server have.
// If that token changes without SECRET_KEY being set, saved sender passwords must be entered again.
const key = () => createHash('sha256').update(process.env.SECRET_KEY?.trim() || `kg-mail-portal-senders|${config.turso.authToken}`).digest();
function encrypt(text) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(b => b.toString('base64')).join('.');
}
function decrypt(stored) {
  const [iv, tag, data] = String(stored).split('.').map(part => Buffer.from(part, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

const transportFor = (user, pass) => nodemailer.createTransport({
  host: config.smtp.host, port: config.smtp.port, secure: config.smtp.port === 465, requireTLS: config.smtp.port !== 465,
  auth: { user, pass }, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 30000,
});
/** The sender from SMTP_USER / SMTP_PASSWORD in the environment ("server setting"). */
export const envTransport = transportFor(config.smtp.user, config.smtp.password);
const cache = new Map();

const view = r => ({ id: r.id, email: r.email, isDefault: !!Number(r.is_default), updatedTime: r.updated_time, builtIn: false });

/** Saved senders (never their passwords), plus the server-setting sender when SMTP_USER is set. */
export async function list() {
  const { rows } = await query('SELECT id, email, is_default, updated_time FROM mail_sender ORDER BY email COLLATE NOCASE');
  const saved = rows.map(view);
  const builtIn = config.smtp.user && !saved.some(s => s.email.toLowerCase() === config.smtp.user.toLowerCase())
    ? [{ id: 'env', email: config.smtp.user, isDefault: !saved.some(s => s.isDefault), updatedTime: '', builtIn: true }] : [];
  return [...builtIn, ...saved];
}

/** Adds or updates a sender after Gmail accepts the sign-in; nothing is saved if it does not. */
export async function save(body = {}) {
  const email = String(body.email ?? '').trim();
  const password = String(body.password ?? '').replace(/\s/g, '');
  if (!validEmail(email)) throw new ApiError(400, 'Sender: enter a valid email address.');
  if (password.length < 8 || password.length > 100) throw new ApiError(400, 'Password: enter the Gmail app password (16 letters).');
  try { await transportFor(email, password).verify(); }
  catch (error) {
    throw new ApiError(400, error.code === 'EAUTH'
      ? `Gmail rejected ${email} with this password. Use a Google app password (Google Account → Security → App passwords), not the normal account password.`
      : `Could not reach ${config.smtp.host}:${config.smtp.port} to check this sender (${error.code || 'error'}). Try again.`);
  }
  const { rows } = await query('SELECT id FROM mail_sender WHERE lower(email) = lower($1)', [email]);
  const id = rows[0]?.id || randomUUID();
  const makeDefault = body.makeDefault === true || !(await query('SELECT id FROM mail_sender LIMIT 1')).rows.length;
  if (makeDefault) await query('UPDATE mail_sender SET is_default = 0');
  await query(`INSERT INTO mail_sender (id, email, password_enc, is_default, updated_time) VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (id) DO UPDATE SET email = $2, password_enc = $3, is_default = CASE WHEN $4 = 1 THEN 1 ELSE is_default END, updated_time = $5`,
    [id, email, encrypt(password), makeDefault ? 1 : 0, now()]);
  cache.delete(id);
  return { data: (await list()).find(s => s.id === id) };
}
export async function makeDefault(id) {
  if (!(await query('SELECT id FROM mail_sender WHERE id = $1', [id])).rows.length) throw new ApiError(404, 'Sender not found.');
  await query('UPDATE mail_sender SET is_default = CASE WHEN id = $1 THEN 1 ELSE 0 END', [id]);
  return {};
}
export async function remove(id) {
  const { rowCount } = await query('DELETE FROM mail_sender WHERE id = $1', [id]);
  if (!rowCount) throw new ApiError(404, 'Sender not found.');
  cache.delete(id);
  return {};
}

/**
 * The account to send from: the chosen sender, or the default one. Returns its address and a ready transport;
 * `builtIn` means the server-setting sender, whose readiness is the startup mail check.
 */
export async function resolve(senderId) {
  let row;
  if (senderId && senderId !== 'env') {
    row = (await query('SELECT * FROM mail_sender WHERE id = $1', [senderId])).rows[0];
    if (!row) throw new ApiError(400, 'The chosen sender no longer exists. Choose another sender.');
  } else if (!senderId) {
    row = (await query('SELECT * FROM mail_sender WHERE is_default = 1 LIMIT 1')).rows[0];
  }
  if (!row) {
    if (!config.smtp.user) throw new ApiError(503, 'No sender is set up. Add one under Settings → Sender accounts.');
    return { from: config.smtp.user, transport: envTransport, builtIn: true };
  }
  const cached = cache.get(row.id);
  if (cached && cached.updated === row.updated_time) return cached.sender;
  let password;
  try { password = decrypt(row.password_enc); }
  catch { throw new ApiError(503, `The saved password for ${row.email} cannot be read here (the encryption key changed). Enter it again under Settings → Sender accounts.`); }
  const sender = { from: row.email, transport: transportFor(row.email, password), builtIn: false };
  cache.set(row.id, { updated: row.updated_time, sender });
  return sender;
}
