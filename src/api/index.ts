import type { Employee, HistoryResponse, Sender, ImportResult, MailForm, MailTemplate, PdfPlan, RecipientLookup, Schedule, ScheduleInput, ScheduleRun, SearchResponse, Config, FolderListing, UserSummary } from '../types';

const base = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
/** Called when the session has expired, so the page can show the sign-in screen again. */
let onSignedOut = () => {};
export const whenSignedOut = (handler: () => void) => { onSignedOut = handler; };
async function decode<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && !response.url.includes('/auth/')) onSignedOut();
  if (!response.ok) throw new ApiError(data.message || `Service returned ${response.status}. Try again later.`, response.status);
  return data as T;
}
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  try { return await decode<T>(await fetch(`${base}/api${path}`, { credentials: 'same-origin', ...init })); }
  catch (error) {
    if (error instanceof ApiError || (error instanceof DOMException && error.name === 'AbortError')) throw error;
    throw new ApiError('Cannot reach the service. Check your network connection.', 0);
  }
}
// Every change carries this header; other websites cannot send it without a (refused) CORS preflight.
const json = { 'Content-Type': 'application/json', 'X-KG-Portal': '1' };
export function session() { return request<{ username: string | null }>('/auth/session'); }
export function login(username: string, password: string) {
  return request<{ username: string }>('/auth/login', { method: 'POST', headers: json, body: JSON.stringify({ username, password }) });
}
export function logout() { return request('/auth/logout', { method: 'POST', headers: json }); }
export function config() { return request<Config>('/config'); }
export function users() { return request<UserSummary>('/users'); }
export function importUsers(rows: unknown) { return request<ImportResult>('/users/import', { method: 'POST', headers: json, body: JSON.stringify(rows) }); }
export function syncUsers() { return request<ImportResult>('/users/sync', { method: 'POST', headers: json }); }
export function searchEmployees(q: string, page: number, signal: AbortSignal) {
  return request<SearchResponse>(`/employees/search?${new URLSearchParams({ q, limit: '20', page: String(page) })}`, { signal });
}
export function history(page: number, signal: AbortSignal) { return request<HistoryResponse>(`/emails/history?page=${page}&pageSize=20`, { signal }); }
export function resolveEmployeeCodes(employeeCodes: string[]) {
  return request<RecipientLookup>('/employees/resolve', { method: 'POST', headers: json, body: JSON.stringify({ employeeCodes }) });
}
/** Windows server only: match codes to PDFs in a server folder (used by schedules). */
export function employeePdfPlan(employeeCodes: string[], folder: string, signal: AbortSignal) {
  const params = new URLSearchParams({ folder }); employeeCodes.forEach(code => params.append('employeeCodes', code));
  return request<PdfPlan>(`/attachments/employee-pdfs?${params}`, { signal });
}
/** Sends one user their PDF, uploaded from the folder chosen in the browser. */
export async function sendEmployeePdf(form: MailForm, employeeCode: string, pdf: File, id: string, senderId: string) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 90000);
  const data = new FormData();
  data.append('employeeCode', employeeCode); data.append('senderId', senderId); data.append('cc', form.cc); data.append('subject', form.subject); data.append('message', form.message);
  data.append('pdf', pdf, `${employeeCode}.pdf`);
  try {
    return await request<{ success: boolean; message: string; requestId: string }>('/emails/send-employee-pdf', {
      method: 'POST', signal: controller.signal, headers: { 'X-KG-Portal': '1', 'Idempotency-Key': id }, body: data,
    });
  } finally { clearTimeout(timer); }
}
export function schedules(signal: AbortSignal) { return request<{ data: Schedule[]; zone: string }>('/schedules', { signal }); }
export function saveSchedule(input: ScheduleInput, id?: string) {
  return request<{ data: Schedule }>(id ? `/schedules/${id}` : '/schedules', { method: 'POST', headers: json, body: JSON.stringify(input) });
}
export function deleteSchedule(id: string) { return request(`/schedules/${id}/delete`, { method: 'POST', headers: json }); }
export function scheduleRuns(id: string, page: number, signal: AbortSignal) {
  return request<{ data: ScheduleRun[]; page: number; hasMore: boolean }>(`/schedules/${id}/runs?page=${page}`, { signal });
}
export function verifyMail() { return request<{ mailStatus: Config['mailStatus'] }>('/mail/verify', { method: 'POST', headers: json }); }
export function listFolders(path: string, signal: AbortSignal) { return request<FolderListing>(`/folders?${new URLSearchParams({ path })}`, { signal }); }
export function companies(signal: AbortSignal) { return request<{ data: { code: string; employees: number }[] }>('/companies', { signal }); }
export function employeesByCompany(companies: string[], signal: AbortSignal) {
  return request<{ data: Employee[] }>(`/employees?${new URLSearchParams({ company: companies.join(',') })}`, { signal });
}
export function saveDefaultCc(cc: string) { return request<{ cc: string }>('/settings/cc', { method: 'POST', headers: json, body: JSON.stringify({ cc }) }); }
export function templates(signal?: AbortSignal) { return request<{ data: MailTemplate[] }>('/templates', { signal }); }
export function saveTemplate(template: Pick<MailTemplate, 'name' | 'subject' | 'message'>, id?: string) {
  return request<{ data: MailTemplate }>(id ? `/templates/${id}` : '/templates', { method: 'POST', headers: json, body: JSON.stringify(template) });
}
export function deleteTemplate(id: string) { return request(`/templates/${id}/delete`, { method: 'POST', headers: json }); }
export function senders() { return request<{ data: Sender[] }>('/senders'); }
export function saveSender(email: string, password: string, makeDefault: boolean) { return request<{ data: Sender }>('/senders', { method: 'POST', headers: json, body: JSON.stringify({ email, password, makeDefault }) }); }
export function makeDefaultSender(id: string) { return request(`/senders/${id}/default`, { method: 'POST', headers: json }); }
export function deleteSender(id: string) { return request(`/senders/${id}/delete`, { method: 'POST', headers: json }); }
