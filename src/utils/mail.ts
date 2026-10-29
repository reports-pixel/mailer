import type { Config } from '../types';

export const extensions = ['pdf', 'docx', 'xlsx', 'xls', 'csv', 'txt', 'jpg', 'jpeg', 'png'];
export const accept = extensions.map(e => `.${e}`).join(',');
export const size = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
export const emailValid = (value: string) => /^[^\s<>(),;:]+@[^\s<>(),;:]+\.[^\s<>(),;:]+$/.test(value) && value.length <= 254;
export const ccValid = (value: string) => !value.trim() || (!/[\r\n]/.test(value) && value.split(/[,;]/).length <= 20 && value.split(/[,;]/).every(e => emailValid(e.trim())));
export const fileId = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;
export function parseEmployeeCodes(text: string): string[] {
  const found = [...text.matchAll(/(?:^|[\s,;])([a-z]+\d+)(?=$|[\s,;])/gi)].map(match => match[1].toUpperCase());
  return [...new Set(found.length ? found : text.split(/[\s,;]+/).map(code => code.trim().toUpperCase()).filter(Boolean))];
}
export const employeeSubjectTemplate = '{}-Attachment';
export const employeeMessageTemplate = 'Dear {},\n\nHere is the attachments.\n\nRegard\nSecurity';
/** Same rules as the server (server/mail.js): {} is the code in the subject and the name in the message. */
export function personalizeTemplate(template: string, employee: { employeeCode: string; employeeName: string }, blank: 'employeeCode' | 'employeeName'): string {
  const today = new Date().toLocaleDateString('en-GB').replaceAll('/', '-');
  return template.replace(/\{(employeeCode|employeeName|date|)\}/g, (_, field: string) =>
    field === 'date' ? today : field === 'employeeCode' || field === 'employeeName' ? employee[field] : employee[blank]);
}
export function createRequestId(): string {
  const source = globalThis.crypto;
  if (!source || typeof source.getRandomValues !== 'function') throw new Error('Your browser cannot create a secure request ID. Please use a current browser.');
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function addFiles(existing: File[], incoming: File[], limits: Config['limits']): File[] {
  const unique = [...existing];
  for (const file of incoming) {
    if (!extensions.includes(file.name.split('.').pop()?.toLowerCase() || '')) throw new Error(`${file.name}: unsupported file type.`);
    if (!file.size || file.size > limits.fileBytes) throw new Error(`${file.name}: choose a nonempty file up to ${size(limits.fileBytes)}.`);
    if (!unique.some(f => fileId(f) === fileId(file))) unique.push(file);
  }
  if (unique.length > limits.files) throw new Error(`Attach up to ${limits.files} files.`);
  if (unique.reduce((total, f) => total + f.size, 0) > limits.totalBytes) throw new Error(`Combined files must be under ${size(limits.totalBytes)}.`);
  return unique;
}
