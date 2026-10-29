import { randomUUID } from 'node:crypto';
import { ApiError, config, parseCc } from './config.js';
import { now, query } from './db.js';

// Settings shared by every installation (stored in Turso): default CC addresses and mail templates.

/** Saved default CC, or DEFAULT_CC from the environment until someone saves one in Settings. */
export async function defaultCc() {
  const { rows } = await query(`SELECT value FROM app_setting WHERE key = 'default_cc'`);
  return rows.length ? String(rows[0].value) : config.defaultCc;
}
export async function saveDefaultCc(value) {
  const cc = parseCc(value).join(', ');
  await query(`INSERT INTO app_setting (key, value) VALUES ('default_cc', $1) ON CONFLICT (key) DO UPDATE SET value = $1`, [cc]);
  return { cc };
}

const STARTER = { name: 'Attachment', subject: '{}-Attachment', message: 'Dear {},\n\nHere is the attachments.\n\nRegard\nSecurity' };
const view = r => ({ id: r.id, name: r.name, subject: r.subject, message: r.message, updatedTime: r.updated_time });

export async function templates() {
  let { rows } = await query('SELECT * FROM mail_template ORDER BY name COLLATE NOCASE');
  if (!rows.length) {
    // First use: one starter template with the standard wording.
    await query('INSERT INTO mail_template (id, name, subject, message, updated_time) VALUES ($1, $2, $3, $4, $5)', [randomUUID(), STARTER.name, STARTER.subject, STARTER.message, now()]);
    ({ rows } = await query('SELECT * FROM mail_template ORDER BY name COLLATE NOCASE'));
  }
  return rows.map(view);
}
export async function saveTemplate(id, body = {}) {
  const name = String(body.name ?? '').trim();
  const subject = String(body.subject ?? '');
  const message = String(body.message ?? '');
  if (!name || name.length > 80 || /[\r\n]/.test(name)) throw new ApiError(400, 'Template name: enter up to 80 characters.');
  if (!subject.trim() || subject.length > 200 || /[\r\n]/.test(subject)) throw new ApiError(400, 'Template subject: enter up to 200 characters on one line.');
  if (!message.trim() || message.length > 50000) throw new ApiError(400, 'Template message: enter a message.');
  const { rows } = await query('SELECT id FROM mail_template WHERE lower(name) = lower($1) AND id <> $2', [name, id || '']);
  if (rows.length) throw new ApiError(400, `A template named "${name}" already exists.`);
  if (id && !(await query('SELECT id FROM mail_template WHERE id = $1', [id])).rows.length) throw new ApiError(404, 'Template not found.');
  const saved = id || randomUUID();
  await query(`INSERT INTO mail_template (id, name, subject, message, updated_time) VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (id) DO UPDATE SET name = $2, subject = $3, message = $4, updated_time = $5`, [saved, name, subject, message, now()]);
  return { data: view((await query('SELECT * FROM mail_template WHERE id = $1', [saved])).rows[0]) };
}
export async function deleteTemplate(id) {
  const { rowCount } = await query('DELETE FROM mail_template WHERE id = $1', [id]);
  if (!rowCount) throw new ApiError(404, 'Template not found.');
  return {};
}
