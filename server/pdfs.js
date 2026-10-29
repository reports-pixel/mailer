import { createHash } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ApiError, config } from './config.js';
import { lookup } from './employees.js';

/** Document types that can be sent, with the first bytes their contents must start with (null: plain text). */
export const ALLOWED = {
  pdf: '%PDF-', xlsx: 'PK\x03\x04', xls: '\xD0\xCF\x11\xE0', docx: 'PK\x03\x04', doc: '\xD0\xCF\x11\xE0',
  csv: null, txt: null, text: null, png: '\x89PNG', jpg: '\xFF\xD8\xFF', jpeg: '\xFF\xD8\xFF',
};
const extension = name => (/\.([a-z0-9]+)$/i.exec(name)?.[1] || '').toLowerCase();
const mb = bytes => Math.round(bytes / 1048576);

/** The folder chosen in the page, or PDF_FOLDER. Only files belonging to a user code (see belongsTo) are ever read from it. */
export async function resolveFolder(chosen) {
  const wanted = String(chosen ?? '').trim() || config.pdfFolder;
  if (!wanted) throw new ApiError(400, 'Choose the folder that holds the files.');
  if (!path.isAbsolute(wanted)) throw new ApiError(400, 'Enter a full folder path, for example C:\\Users\\Administrator\\Downloads\\mail-path.');
  let real;
  try { real = await fs.realpath(wanted); }
  catch (error) {
    if (error.code === 'ENOENT') throw new ApiError(400, `The folder ${wanted} does not exist.`);
    if (error.code === 'EACCES' || error.code === 'EPERM') throw new ApiError(400, `The folder ${wanted} cannot be opened (access denied).`);
    throw new ApiError(400, `The folder ${wanted} is not a valid path.`);
  }
  if (!(await fs.stat(real)).isDirectory()) throw new ApiError(400, `${wanted} is a file, not a folder.`);
  return real;
}

/**
 * A file belongs to a user when it is named <code>.<ext>, or <code> followed by "_", "-", " " or "." and more text,
 * e.g. FP13309.pdf or FP13309_salary.xlsx. FP1330.pdf never matches FP13309.
 */
export function belongsTo(name, code) {
  const upper = String(name).toUpperCase();
  return extension(name) in ALLOWED && upper.startsWith(code) && /^[._ -]/.test(upper.slice(code.length));
}
/** Checks type, size and that the contents match the extension; used for uploaded and server-folder files alike. */
export function checkFile(name, bytes) {
  const ext = extension(name);
  if (!(ext in ALLOWED) || /[\\/:*?"<>|]/.test(name)) throw new ApiError(400, `${name}: this file type cannot be sent. Allowed: ${Object.keys(ALLOWED).join(', ')}.`);
  if (!bytes?.length) throw new ApiError(400, `${name} is empty.`);
  if (bytes.length > config.limits.fileBytes) throw new ApiError(400, `${name} is larger than ${mb(config.limits.fileBytes)} MB.`);
  const signature = ALLOWED[ext];
  if (signature ? bytes.subarray(0, signature.length).toString('latin1') !== signature : bytes.includes(0))
    throw new ApiError(400, `${name} is not a valid .${ext} file (its contents do not match the extension).`);
  return { name, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}
/** All of one user's checked files and a combined fingerprint; together they must fit in one email. */
export function bundle(files) {
  const total = files.reduce((sum, f) => sum + f.bytes.length, 0);
  if (files.length > config.limits.files) throw new ApiError(400, `More than ${config.limits.files} files for one user.`);
  if (total > config.limits.totalBytes) throw new ApiError(400, `${files.map(f => f.name).join(', ')}: together larger than ${mb(config.limits.totalBytes)} MB.`);
  const sha256 = createHash('sha256').update(files.map(f => `${f.name}:${f.sha256}`).sort().join('|')).digest('hex');
  return { files, total, sha256 };
}
/** Reads every file in a server folder that belongs to the user (daily schedules on the Windows server). */
export async function readUserFiles(folder, code) {
  const names = (await fs.readdir(folder)).filter(name => belongsTo(name, code)).sort();
  if (!names.length) throw new ApiError(404, `No file for ${code} in ${folder} (expected e.g. ${code}.pdf or ${code}.xlsx).`);
  const files = [];
  for (const name of names) {
    const file = path.join(folder, name);
    const info = await fs.lstat(file);
    if (info.isSymbolicLink() || !info.isFile()) throw new ApiError(400, `${name} is not a regular file.`);
    if (info.size > config.limits.fileBytes) throw new ApiError(400, `${name} is larger than ${mb(config.limits.fileBytes)} MB.`);
    files.push(checkFile(name, await fs.readFile(file)));
  }
  return bundle(files);
}

/** For each user: READY (files found), MISSING (no file), INVALID (unusable file) or UNAVAILABLE (no user/email). */
export async function preview(employeeCodes, chosenFolder) {
  const folder = await resolveFolder(chosenFolder);
  const { data } = await lookup(employeeCodes);
  const found = new Map(data.map(e => [e.employeeCode, e]));
  const matches = [];
  for (const code of [...new Set([].concat(employeeCodes).map(c => String(c).trim().toUpperCase()))]) {
    const employee = found.get(code);
    if (!employee) {
      matches.push({ employeeCode: code, employeeName: '', email: '', fileName: `${code}.*`, size: 0, status: 'UNAVAILABLE', detail: 'User not found or has no valid registered email.', sha256: '' });
      continue;
    }
    try {
      const files = await readUserFiles(folder, code);
      matches.push({ ...employee, fileName: files.files.map(f => f.name).join(', '), size: files.total, status: 'READY', detail: 'Only these files are sent to this user.', sha256: files.sha256 });
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      matches.push({ ...employee, fileName: `${code}.*`, size: 0, status: error.status === 404 ? 'MISSING' : 'INVALID', detail: error.message, sha256: '' });
    }
  }
  return { folder, data: matches.map(({ selectable, company, ...m }) => m) };
}

async function pdfCount(folder) {
  try { return (await fs.readdir(folder)).filter(name => extension(name) in ALLOWED).length; }
  catch { return 0; }
}
async function isFolder(folder) {
  try { await fs.access(folder, constants.R_OK); return (await fs.stat(folder)).isDirectory(); } catch { return false; }
}

/** Folder browser for the page: drives and shortcuts, or the subfolders of one folder. */
export async function browse(requested) {
  if (!String(requested ?? '').trim()) {
    const places = [];
    const add = async (folder, name) => {
      if (folder && !places.some(p => p.path.toLowerCase() === folder.toLowerCase()) && await isFolder(folder)) places.push({ name, path: folder, pdfCount: await pdfCount(folder) });
    };
    await add(config.pdfFolder, `Default folder (${config.pdfFolder})`);
    for (const home of ['C:\\Users\\Administrator', os.homedir()]) await add(path.join(home, 'Downloads'), path.join(home, 'Downloads'));
    for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') await add(`${letter}:\\`, `${letter}:\\`);
    return { path: '', parent: null, pdfCount: 0, folders: places };
  }
  const folder = await resolveFolder(requested);
  const entries = await fs.readdir(folder, { withFileTypes: true }).catch(() => { throw new ApiError(400, `The folder ${folder} cannot be listed.`); });
  const folders = [];
  for (const entry of entries) {
    if (folders.length >= 1000) break;
    if (entry.isDirectory() && !entry.name.startsWith('$') && !entry.name.startsWith('.')) {
      const full = path.join(folder, entry.name);
      folders.push({ name: entry.name, path: full, pdfCount: await pdfCount(full) });
    }
  }
  folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const parent = path.dirname(folder);
  return { path: folder, parent: parent === folder ? '' : parent, pdfCount: await pdfCount(folder), folders };
}
