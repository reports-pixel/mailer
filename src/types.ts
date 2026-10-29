export interface Employee { employeeCode: string; employeeName: string; email: string; selectable: boolean; company?: string }
export interface MailTemplate { id: string; name: string; subject: string; message: string; updatedTime: string }
export interface Config {
  sender: string; defaultCc: string; mailEnabled: boolean; pdfFolder: string;
  mailStatus: { ready: boolean; code: string; detail: string; checkedAt: string };
  limits: { files: number; fileBytes: number; totalBytes: number; recipients: number };
  schedulesEnabled: boolean; users: UserSummary; senders: Sender[];
}
export interface UserSummary { total: number; updatedTime: string; canSync: boolean }
export interface ImportResult { imported: number; withoutEmail: number; updatedTime: string }
export interface SearchResponse { data: Employee[]; page: number; hasMore: boolean }
export interface HistoryEntry {
  requestId: string; subject: string; submittedTime: string; status: string;
  recipientCount: number; attachmentCount: number; sender: string; recipients: string; cc: string;
  employeeCodes?: string; attachmentNames?: string;
}
export interface HistoryResponse { data: HistoryEntry[]; page: number; hasMore: boolean }
export interface MailForm { cc: string; subject: string; message: string }
export interface PdfMatch {
  employeeCode: string; employeeName: string; email: string; fileName: string; size: number;
  status: 'READY' | 'MISSING' | 'INVALID' | 'UNAVAILABLE'; detail: string; sha256: string;
}
export interface PdfPlan { success: boolean; folder: string; data: PdfMatch[] }
export interface RecipientLookup { data: Employee[]; issues: string[] }
export interface Schedule {
  id: string; name: string; employeeCodes: string[]; times: string[]; days: string[]; cc: string; subject: string; message: string; folder: string;
  enabled: boolean; skipUnchanged: boolean; updatedTime: string; nextRun: string;
}
export type ScheduleInput = Omit<Schedule, 'id' | 'updatedTime' | 'nextRun'>;
export interface ScheduleRun { slot: string; employeeCode: string; status: string; detail: string; fileName: string; requestId: string; runTime: string }
export interface FolderEntry { name: string; path: string; pdfCount: number }
export interface FolderListing { path: string; parent: string | null; pdfCount: number; folders: FolderEntry[] }
export interface Sender { id: string; email: string; isDefault: boolean; builtIn: boolean; updatedTime: string }
