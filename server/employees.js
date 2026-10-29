import { ApiError, config, validEmail } from './config.js';
import { batch, now, query } from './db.js';

// Users live in Turso (table "employee"). They are imported from the employee API JSON:
// [{ comCode, userCode, username, email }] — pasted/uploaded in the portal, or synced by the Windows server.
let cache = { expires: 0, list: [], byCode: new Map() };

const field = (row, ...names) => names.map(name => String(row?.[name] ?? '').trim()).find(Boolean) || '';
const toEmployee = r => ({ employeeCode: r.code, employeeName: r.name, email: r.email, selectable: validEmail(r.email), company: r.company });

async function directory(fresh = false) {
  if (fresh || cache.expires < Date.now()) {
    const { rows } = await query('SELECT code, name, email, company FROM employee ORDER BY company, length(code), code');
    const list = rows.map(toEmployee);
    cache = { expires: Date.now() + 30000, list, byCode: new Map(list.map(e => [e.employeeCode, e])) };
  }
  return cache;
}
const view = ({ company, ...employee }) => employee;

/** Replaces the whole user list with the rows of the employee API response. */
export async function importUsers(rows) {
  if (!Array.isArray(rows)) throw new ApiError(400, 'Expected the employee API JSON: a list like [{ "comCode": "FP", "userCode": "FP10001", "username": "…", "email": "…" }].');
  const users = new Map();
  for (const row of rows) {
    // The API can also return its cached procedure columns (e_code, e_name, e_email).
    const code = field(row, 'userCode', 'e_code').toUpperCase();
    const name = field(row, 'username', 'e_name');
    if (!/^[A-Z0-9]{2,24}$/.test(code) || !name || name.length > 200 || users.has(code)) continue;
    users.set(code, { code, name, email: field(row, 'email', 'e_email'), company: (field(row, 'comCode') || code.replace(/[0-9].*$/, '')).toUpperCase() });
  }
  if (!users.size) throw new ApiError(400, 'No valid users found. Each row needs userCode and username.');
  const time = now();
  const statements = [['DELETE FROM employee']];
  for (const u of users.values()) statements.push(['INSERT INTO employee (code, name, email, company, updated_time) VALUES ($1, $2, $3, $4, $5)', [u.code, u.name, u.email, u.company, time]]);
  await batch(statements);
  cache.expires = 0;
  const list = [...users.values()];
  return { imported: list.length, withoutEmail: list.filter(u => !validEmail(u.email)).length, updatedTime: time };
}
/** Windows server only: copies the office employee API into Turso. */
export async function syncFromApi() {
  if (!config.employeeApiUrl) throw new ApiError(400, 'EMPLOYEE_API_URL is not set on this server.');
  let rows;
  try {
    const response = await fetch(config.employeeApiUrl, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new ApiError(503, `The employee API answered HTTP ${response.status}.`);
    rows = await response.json();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, `The employee API could not be reached (${config.employeeApiUrl}).`);
  }
  return importUsers(rows);
}
export async function summary() {
  const { rows } = await query('SELECT count(*) AS total, max(updated_time) AS updated FROM employee');
  return { total: Number(rows[0].total), updatedTime: rows[0].updated || '', canSync: !!config.employeeApiUrl && !config.onVercel };
}

export async function companies() {
  const counts = new Map();
  for (const e of (await directory()).list) counts.set(e.company, (counts.get(e.company) || 0) + 1);
  return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([code, employees]) => ({ code, employees }));
}
/** Users of one or more companies ("FP" or "FP,DP"), each with its company code. */
export async function byCompany(company) {
  const codes = [...new Set([].concat(company ?? []).join(',').split(',').map(c => c.trim().toUpperCase()).filter(Boolean))];
  if (!codes.length || codes.some(code => !/^[A-Z]{1,10}$/.test(code))) throw new ApiError(400, 'Choose at least one company.');
  return (await directory()).list.filter(e => codes.includes(e.company));
}
export async function search(queryText, limit, page) {
  const q = String(queryText || '').trim().toUpperCase();
  if (q.length < 2 || q.length > 80 || page < 1 || page > 1000) throw new ApiError(400, 'Search using 2–80 characters.');
  const size = Math.max(1, Math.min(30, limit || 20));
  const { list } = await directory();
  const codeMatches = list.filter(e => e.employeeCode.startsWith(q) || e.employeeCode.replace(/^[A-Z]+/, '').startsWith(q));
  const others = list.filter(e => !codeMatches.includes(e) && `${e.employeeCode}\n${e.employeeName}\n${e.email}`.toUpperCase().includes(q));
  const all = [...codeMatches, ...others];
  return { data: all.slice((page - 1) * size, page * size).map(view), page, hasMore: all.length > page * size };
}
/** Normalises and validates a list of employee codes. */
export function codes(input, max = config.limits.recipients) {
  const list = Array.isArray(input) ? input : input == null ? [] : [input];
  if (!list.length || list.length > max) throw new ApiError(400, `Select between 1 and ${max} users.`);
  const unique = [...new Set(list.map(c => String(c ?? '').trim().toUpperCase()))];
  const bad = unique.find(c => !/^[A-Z0-9]{2,24}$/.test(c));
  if (bad !== undefined) throw new ApiError(400, `"${bad}" is not a valid employee code.`);
  return unique;
}
/** Exact codes → employees, with a readable issue for each code that cannot receive mail. */
export async function lookup(input, fresh = false) {
  const { byCode } = await directory(fresh);
  const data = [], issues = [];
  for (const code of codes(input)) {
    const employee = byCode.get(code);
    if (!employee) issues.push(`${code}: not found in the user list.`);
    else if (!employee.selectable) issues.push(`${code}: no valid registered email address.`);
    else data.push(employee);
  }
  return { data, issues };
}
