// Same rules as the server (server/pdfs.js): which documents can be sent and how files are matched to users.

/** Allowed extensions, with the first bytes their contents must start with (null: plain text). */
export const ALLOWED: Record<string, string | null> = {
  pdf: '%PDF-', xlsx: 'PK\x03\x04', xls: '\xD0\xCF\x11\xE0', docx: 'PK\x03\x04', doc: '\xD0\xCF\x11\xE0',
  csv: null, txt: null, text: null, png: '\x89PNG', jpg: '\xFF\xD8\xFF', jpeg: '\xFF\xD8\xFF',
};
export const allowedList = Object.keys(ALLOWED).join(', ');
export const extensionOf = (name: string) => (/\.([a-z0-9]+)$/i.exec(name)?.[1] || '').toLowerCase();
export const isAllowed = (name: string) => extensionOf(name) in ALLOWED;

/** FP13309.pdf, FP13309_salary.xlsx and "FP13309 May.pdf" belong to FP13309; FP1330.pdf never does. */
export function belongsTo(name: string, code: string) {
  const upper = name.toUpperCase();
  return isAllowed(name) && upper.startsWith(code) && /^[._ -]/.test(upper.slice(code.length));
}

/** Returns why a file cannot be sent, or '' when it is fine: the contents must match the extension. */
export async function problemWith(file: File, maxBytes: number): Promise<string> {
  const ext = extensionOf(file.name);
  if (!(ext in ALLOWED)) return `${file.name}: this file type cannot be sent.`;
  if (!file.size) return `${file.name} is empty.`;
  if (file.size > maxBytes) return `${file.name} is larger than ${Math.round(maxBytes / 1048576)} MB.`;
  const signature = ALLOWED[ext];
  const head = new Uint8Array(await file.slice(0, signature ? signature.length : 4096).arrayBuffer());
  const ok = signature ? [...signature].every((char, i) => head[i] === char.charCodeAt(0)) : !head.includes(0);
  return ok ? '' : `${file.name} is not a valid .${ext} file (its contents do not match the extension).`;
}
