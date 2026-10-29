import { createClient } from '@libsql/client';
import { ApiError, config } from './config.js';

// Turso (libSQL): users, send history, schedules and schedule runs. Shared by the Vercel site and the Windows server.
let client;
function db() {
  if (!config.turso.url) throw new ApiError(503, 'TURSO_DATABASE_URL is not set.');
  client ||= createClient({ url: config.turso.url, authToken: config.turso.authToken });
  return client;
}

/** Runs one statement; `$1, $2…` placeholders. Returns { rows, rowCount }. */
export async function query(sql, args = []) {
  const result = await db().execute({ sql: sql.replace(/\$(\d+)/g, '?$1'), args });
  return { rows: result.rows, rowCount: result.rowsAffected };
}
/** Runs several statements atomically. */
export async function batch(statements) {
  await db().batch(statements.map(([sql, args = []]) => ({ sql: sql.replace(/\$(\d+)/g, '?$1'), args })), 'write');
}
export const now = () => new Date().toISOString();

let migrated;
export function migrate() {
  migrated ||= (async () => {
    await db().executeMultiple(`
      CREATE TABLE IF NOT EXISTS app_setting (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mail_sender (
        id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_enc TEXT NOT NULL, is_default INTEGER NOT NULL, updated_time TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mail_template (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, subject TEXT NOT NULL, message TEXT NOT NULL, updated_time TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS employee (
        code TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, company TEXT NOT NULL, updated_time TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS email_submission (
        request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, subject TEXT NOT NULL, submitted_time TEXT NOT NULL,
        status TEXT NOT NULL, recipient_count INTEGER NOT NULL, attachment_count INTEGER NOT NULL, sender TEXT NOT NULL,
        recipients TEXT NOT NULL, cc TEXT NOT NULL, employee_codes TEXT NOT NULL, attachment_names TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS email_submission_time ON email_submission (submitted_time DESC);
      CREATE TABLE IF NOT EXISTS email_schedule (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, employee_codes TEXT NOT NULL, times TEXT NOT NULL, days TEXT NOT NULL,
        cc TEXT NOT NULL, subject TEXT NOT NULL, message TEXT NOT NULL, folder TEXT NOT NULL, enabled INTEGER NOT NULL,
        skip_unchanged INTEGER NOT NULL, updated_time TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS email_schedule_slot (
        schedule_id TEXT NOT NULL, slot TEXT NOT NULL, completed INTEGER NOT NULL, PRIMARY KEY (schedule_id, slot));
      CREATE TABLE IF NOT EXISTS email_schedule_run (
        schedule_id TEXT NOT NULL, slot TEXT NOT NULL, employee_code TEXT NOT NULL, status TEXT NOT NULL, detail TEXT NOT NULL,
        file_name TEXT NOT NULL, sha256 TEXT NOT NULL, request_id TEXT NOT NULL, run_time TEXT NOT NULL,
        PRIMARY KEY (schedule_id, slot, employee_code));`);
  })().catch(error => { migrated = undefined; throw error; });
  return migrated;
}

/**
 * A send that was interrupted (crash, timeout) has an unknown outcome and is never resent automatically.
 * Only sends older than 10 minutes are marked, so a send still running on the other host is left alone.
 */
export async function markInterrupted() {
  const before = new Date(Date.now() - 10 * 60000).toISOString();
  await query(`UPDATE email_submission SET status = 'UNKNOWN' WHERE status = 'SUBMITTING' AND submitted_time < $1`, [before]);
  await query(`UPDATE email_schedule_run SET status = 'UNKNOWN', detail = 'The server stopped during this send. It may have been delivered; it will not be resent automatically.' WHERE status = 'SENDING' AND run_time < $1`, [before]);
}
