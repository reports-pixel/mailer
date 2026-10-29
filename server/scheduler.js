import { createHash, randomUUID } from 'node:crypto';
import { ApiError, config, parseCc } from './config.js';
import { now as timestamp, query } from './db.js';
import { lookup } from './employees.js';
import { mailStatus, sendEmployeePdf } from './mail.js';
import { preview, resolveFolder } from './pdfs.js';
import { resolve as resolveSender } from './senders.js';

// Daily schedules: at each time on the chosen days, every user gets their own PDF. Uses this server's local time.
export const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const pad = n => String(n).padStart(2, '0');
const slotKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const at = (day, time) => { const d = new Date(day); const [h, m] = time.split(':').map(Number); d.setHours(h, m, 0, 0); return d; };

// Turso stores lists as JSON text and true/false as 1/0.
const row = r => ({ ...r, employee_codes: JSON.parse(r.employee_codes), times: JSON.parse(r.times), days: JSON.parse(r.days),
  enabled: !!Number(r.enabled), skip_unchanged: !!Number(r.skip_unchanged), updated_time: new Date(r.updated_time) });
const view = r => ({ id: r.id, name: r.name, employeeCodes: r.employee_codes, times: r.times, days: r.days, cc: r.cc, subject: r.subject,
  message: r.message, folder: r.folder, enabled: r.enabled, skipUnchanged: r.skip_unchanged, updatedTime: r.updated_time.toISOString(), nextRun: nextRun(r) });

export function nextRun(r) {
  if (!r.enabled) return '';
  const now = new Date();
  for (let ahead = 0; ahead < 8; ahead++) {
    const day = new Date(now); day.setDate(now.getDate() + ahead);
    if (!r.days.includes(DAYS[day.getDay()])) continue;
    const next = r.times.map(t => at(day, t)).find(d => d > now);
    if (next) return slotKey(next);
  }
  return '';
}

export async function list() { return (await query('SELECT * FROM email_schedule ORDER BY name')).rows.map(r => view(row(r))); }
async function get(id) {
  const { rows } = await query('SELECT * FROM email_schedule WHERE id = $1', [id]);
  if (!rows.length) throw new ApiError(404, 'Schedule not found.');
  return row(rows[0]);
}

export async function save(id, body = {}) {
  const name = String(body.name ?? '').trim();
  if (!name || name.length > 100 || /[\r\n]/.test(name)) throw new ApiError(400, 'Name: enter up to 100 characters.');
  const { data, issues } = await lookup(body.employeeCodes);
  if (issues.length) throw new ApiError(400, issues.join(' '));
  const times = [...new Set((body.times || []).map(t => String(t).trim()))].sort();
  if (!times.length || times.length > 24) throw new ApiError(400, 'Times: add between 1 and 24 send times.');
  if (times.some(t => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))) throw new ApiError(400, 'Times: use 24-hour HH:MM.');
  const days = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].filter(d => (body.days || []).map(x => String(x).toUpperCase()).includes(d));
  if (!days.length) throw new ApiError(400, 'Days: choose at least one day.');
  const cc = parseCc(body.cc).join(', ');
  if (!String(body.subject ?? '').trim() || body.subject.length > 200 || /[\r\n]/.test(body.subject)) throw new ApiError(400, 'Subject: enter up to 200 characters on one line.');
  if (!String(body.message ?? '').trim() || body.message.length > 50000) throw new ApiError(400, 'Message: enter a message.');
  const folder = await resolveFolder(body.folder);
  if (id) await get(id);
  const { rows: [saved] } = await query(
    `INSERT INTO email_schedule (id, name, employee_codes, times, days, cc, subject, message, folder, enabled, skip_unchanged, updated_time)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (id) DO UPDATE SET name = $2, employee_codes = $3, times = $4, days = $5, cc = $6, subject = $7, message = $8, folder = $9,
       enabled = $10, skip_unchanged = $11, updated_time = $12 RETURNING *`,
    [id || randomUUID(), name, JSON.stringify(data.map(e => e.employeeCode)), JSON.stringify(times), JSON.stringify(days), cc, body.subject, body.message,
      folder, body.enabled !== false ? 1 : 0, body.skipUnchanged === true ? 1 : 0, timestamp()]);
  return view(row(saved));
}
export async function remove(id) {
  await get(id);
  for (const table of ['email_schedule_run', 'email_schedule_slot']) await query(`DELETE FROM ${table} WHERE schedule_id = $1`, [id]);
  await query('DELETE FROM email_schedule WHERE id = $1', [id]);
}
export async function runs(id, page) {
  await get(id);
  const { rows } = await query('SELECT * FROM email_schedule_run WHERE schedule_id = $1 ORDER BY slot DESC, employee_code LIMIT 31 OFFSET $2', [id, (page - 1) * 30]);
  return { data: rows.slice(0, 30).map(r => ({ slot: r.slot, employeeCode: r.employee_code, status: r.status, detail: r.detail, fileName: r.file_name,
    requestId: r.request_id, runTime: r.run_time })), page, hasMore: rows.length > 30 };
}

async function record(id, slot, code, status, detail, fileName, sha256, requestId) {
  const r = await query(`INSERT INTO email_schedule_run (schedule_id, slot, employee_code, status, detail, file_name, sha256, request_id, run_time)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT DO NOTHING`, [id, slot, code, status, detail.slice(0, 1000), fileName, sha256, requestId, timestamp()]);
  return r.rowCount > 0;
}
/** Request ID fixed per schedule, time and user, so the send history blocks a second submission of the same slot. */
function requestIdFor(id, slot, code) {
  const h = createHash('sha1').update(`${id}|${slot}|${code}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

async function runSlot(s, slot) {
  let matches;
  try {
    // Schedules send from the default sender; a saved sender was checked when added, the server-setting one at startup.
    if ((await resolveSender()).builtIn && !mailStatus().ready) throw new ApiError(503, `Sending was unavailable when this schedule was due. ${mailStatus().detail}`);
    matches = (await preview(s.employee_codes, s.folder)).data;
  } catch (error) {
    for (const code of s.employee_codes) await record(s.id, slot, code, 'NOT_SENT', error.message, `${code}.pdf`, '', '');
    return;
  }
  console.log(`[schedule] ${s.name} ${slot}: ${matches.length} users`);
  for (const m of matches) {
    if (m.status !== 'READY') { await record(s.id, slot, m.employeeCode, m.status, m.detail, m.fileName, '', ''); continue; }
    if (s.skip_unchanged) {
      const { rows } = await query(`SELECT sha256 FROM email_schedule_run WHERE schedule_id = $1 AND employee_code = $2 AND status = 'SMTP_ACCEPTED' ORDER BY run_time DESC LIMIT 1`, [s.id, m.employeeCode]);
      if (rows[0]?.sha256 === m.sha256) { await record(s.id, slot, m.employeeCode, 'SKIPPED_UNCHANGED', `Not sent: ${m.fileName} is unchanged since it was last sent.`, m.fileName, m.sha256, ''); continue; }
    }
    const requestId = requestIdFor(s.id, slot, m.employeeCode);
    if (!await record(s.id, slot, m.employeeCode, 'SENDING', 'Sending.', m.fileName, m.sha256, requestId)) continue;
    let outcome;
    try {
      await sendEmployeePdf({ requestId, employeeCode: m.employeeCode, sha256: m.sha256, cc: s.cc, subject: s.subject, message: s.message, folder: s.folder });
      outcome = ['SMTP_ACCEPTED', `Sent ${m.fileName} to ${m.email}.`];
    } catch (error) {
      const uncertain = !(error instanceof ApiError) || error.status >= 500 || error.status === 409;
      outcome = [uncertain ? 'UNKNOWN' : 'FAILED', error.message];
    }
    await query('UPDATE email_schedule_run SET status = $1, detail = $2, run_time = $3 WHERE schedule_id = $4 AND slot = $5 AND employee_code = $6',
      [outcome[0], outcome[1].slice(0, 1000), timestamp(), s.id, slot, m.employeeCode]);
  }
}

let running = false;
/** Runs every 30 seconds. Only slots due in the last SCHEDULE_GRACE_MINUTES run, so a restart never sends a burst of old mails. */
export async function tick() {
  if (running) return;
  running = true;
  try {
    const now = new Date();
    const oldest = new Date(now.getTime() - config.scheduleGraceMinutes * 60000);
    for (const s of (await query('SELECT * FROM email_schedule WHERE enabled = 1')).rows.map(row)) {
      for (const back of [1, 0]) {
        const day = new Date(now); day.setDate(now.getDate() - back);
        if (!s.days.includes(DAYS[day.getDay()])) continue;
        for (const time of s.times) {
          const due = at(day, time);
          if (due > now || due < oldest || due <= s.updated_time) continue;
          const slot = slotKey(due);
          const opened = await query(`INSERT INTO email_schedule_slot (schedule_id, slot, completed) VALUES ($1, $2, 0) ON CONFLICT DO NOTHING`, [s.id, slot]);
          if (!opened.rowCount) {
            const { rows } = await query('SELECT completed FROM email_schedule_slot WHERE schedule_id = $1 AND slot = $2', [s.id, slot]);
            if (Number(rows[0]?.completed)) continue;
          }
          try { await runSlot(s, slot); }
          finally { await query('UPDATE email_schedule_slot SET completed = 1 WHERE schedule_id = $1 AND slot = $2', [s.id, slot]); }
        }
      }
    }
  } catch (error) { console.error('[schedule] check failed:', error.message); }
  finally { running = false; }
}
