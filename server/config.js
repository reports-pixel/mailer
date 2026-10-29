// All settings come from the environment: .env and encrypted secrets on the Windows server, project settings on Vercel.
const env = (name, fallback = '') => (process.env[name] ?? fallback).trim();
const number = (name, fallback) => {
  const value = Number(env(name, String(fallback)));
  if (!Number.isInteger(value) || value < 1) throw new Error(`Invalid ${name}`);
  return value;
};
const onVercel = !!process.env.VERCEL;

export const config = {
  onVercel,
  host: env('HOST', '127.0.0.1'),
  port: number('PORT', 6001),
  // The Windows service only answers this machine; on Vercel the login is the protection.
  localOnly: env('LOCAL_ONLY', onVercel ? 'false' : 'true') === 'true',
  admin: { username: env('ADMIN_USERNAME', 'admin'), password: env('ADMIN_PASSWORD', 'admin') },
  sessionSecret: env('SESSION_SECRET'),
  turso: { url: env('TURSO_DATABASE_URL'), authToken: env('TURSO_AUTH_TOKEN') },
  // Only the Windows server can reach the employee API on the office network; it copies the users into Turso.
  employeeApiUrl: env('EMPLOYEE_API_URL'),
  pdfFolder: env('PDF_FOLDER'),
  smtp: { host: env('SMTP_HOST', 'smtp.gmail.com'), port: number('SMTP_PORT', 587), user: env('SMTP_USER'), password: env('SMTP_PASSWORD').replace(/\s/g, '') },
  defaultCc: env('DEFAULT_CC'),
  limits: {
    files: number('MAX_FILES', 10),
    // Vercel rejects request bodies over 4.5 MB, so uploads are kept below that there.
    fileBytes: number('MAX_FILE_BYTES', onVercel ? 4 * 1024 * 1024 : 10 * 1024 * 1024),
    totalBytes: number('MAX_TOTAL_BYTES', onVercel ? 4 * 1024 * 1024 : 20 * 1024 * 1024),
    recipients: number('MAX_RECIPIENTS', 100),
  },
  // Daily schedules read PDFs from a folder on the Windows server, so they run there only.
  schedulesEnabled: !onVercel,
  scheduleGraceMinutes: number('SCHEDULE_GRACE_MINUTES', 30),
};

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const EMAIL = /^[^\s<>(),;:@]+@[^\s<>(),;:@]+\.[^\s<>(),;:@]+$/;
export const validEmail = value => typeof value === 'string' && value.length <= 254 && EMAIL.test(value);

/** Parses "a@x.com, b@y.com" (comma or semicolon separated); every address must be valid. */
export function parseCc(value) {
  if (value == null || !String(value).trim()) return [];
  const text = String(value);
  if (text.length > 4096 || /[\r\n]/.test(text)) throw new ApiError(400, 'CC is too long or contains line breaks.');
  const result = [];
  for (const piece of text.split(/[,;]/)) {
    const address = piece.trim();
    if (!address) continue;
    if (!validEmail(address)) throw new ApiError(400, `CC: "${address}" is not a valid email address.`);
    if (!result.some(existing => existing.toLowerCase() === address.toLowerCase())) result.push(address);
  }
  if (result.length > 20) throw new ApiError(400, 'CC: at most 20 addresses.');
  return result;
}
