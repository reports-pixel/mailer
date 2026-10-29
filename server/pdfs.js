import { createHash } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ApiError, config } from './config.js';
import { lookup } from './employees.js';

/** The folder chosen in the page, or PDF_FOLDER. Only files named <userCode>.pdf are ever read from it. */
export async function resolveFolder(chosen) {
  const wanted = String(chosen ?? '').trim() || config.pdfFolder;
  if (!wanted) throw new ApiError(400, 'Choose the folder that holds the PDFs.');
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

/** Reads <code>.pdf from the folder and checks it really is a PDF within the size limit. */
export async function readPdf(folder, code) {
  const name = `${code}.pdf`;
  const file = path.join(folder, name);
  let info;
  try { info = await fs.lstat(file); }
  catch { throw new ApiError(404, `No file named ${name} in ${folder}.`); }
  if (info.isSymbolicLink() || !info.isFile()) throw new ApiError(400, `${name} is not a regular file.`);
  if (info.size > config.limits.fileBytes) throw new ApiError(400, `${name} is larger than ${Math.round(config.limits.fileBytes / 1048576)} MB.`);
  return checkPdf(name, await fs.readFile(file));
}
/** Checks size and that the contents really are a PDF; used for uploaded and server-folder files alike. */
export function checkPdf(name, bytes) {
  if (!bytes?.length) throw new ApiError(400, `${name} is empty.`);
  if (bytes.length > config.limits.fileBytes) throw new ApiError(400, `${name} is larger than ${Math.round(config.limits.fileBytes / 1048576)} MB.`);
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new ApiError(400, `${name} is not a valid PDF file.`);
  return { name, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

/** For each user: READY (PDF found), MISSING (no PDF), INVALID (unusable PDF) or UNAVAILABLE (no user/email). */
export async function preview(employeeCodes, chosenFolder) {
  const folder = await resolveFolder(chosenFolder);
  const { data } = await lookup(employeeCodes);
  const found = new Map(data.map(e => [e.employeeCode, e]));
  const matches = [];
  for (const code of [...new Set([].concat(employeeCodes).map(c => String(c).trim().toUpperCase()))]) {
    const employee = found.get(code);
    if (!employee) {
      matches.push({ employeeCode: code, employeeName: '', email: '', fileName: `${code}.pdf`, size: 0, status: 'UNAVAILABLE', detail: 'User not found or has no valid registered email.', sha256: '' });
      continue;
    }
    try {
      const pdf = await readPdf(folder, code);
      matches.push({ ...employee, fileName: pdf.name, size: pdf.bytes.length, status: 'READY', detail: 'Only this PDF is sent to this user.', sha256: pdf.sha256 });
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      matches.push({ ...employee, fileName: `${code}.pdf`, size: 0, status: error.status === 404 ? 'MISSING' : 'INVALID', detail: error.message, sha256: '' });
    }
  }
  return { folder, data: matches.map(({ selectable, ...m }) => m) };
}

async function pdfCount(folder) {
  try { return (await fs.readdir(folder)).filter(name => name.toLowerCase().endsWith('.pdf')).length; }
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
    await add(config.pdfFolder, `Default PDF folder (${config.pdfFolder})`);
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
