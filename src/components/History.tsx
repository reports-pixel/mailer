import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Clock3, RefreshCw } from 'lucide-react';
import { history } from '../api';

const PAGE_SIZES = [15, 30, 50, 100];
const statusLabel: Record<string, string> = { SMTP_ACCEPTED: 'Sent', SUBMITTING: 'Sending', SMTP_AUTH_FAILED: 'Sign-in failed', UNKNOWN: 'Uncertain' };
const when = (iso: string) => {
  const date = new Date(iso);
  return { day: date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }), time: date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) };
};
const list = (value?: string) => (value || '').split(',').map(v => v.trim()).filter(Boolean);
/** Page numbers to show: first, last, and two either side of the current one, with gaps as null. */
function pageNumbers(current: number, last: number): (number | null)[] {
  const wanted = new Set([1, last, current - 2, current - 1, current, current + 1, current + 2].filter(n => n >= 1 && n <= last));
  const sorted = [...wanted].sort((a, b) => a - b);
  return sorted.flatMap((n, i) => (i && n - sorted[i - 1] > 1 ? [null, n] : [n]));
}

/** One row per email: when, users, subject, to, CC, attachments and status. On phones each row becomes a card. */
export default function History() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const query = useQuery({ queryKey: ['history', page, pageSize], queryFn: ({ signal }) => history(page, pageSize, signal), staleTime: 0, placeholderData: keepPreviousData });
  const rows = query.data?.data || [];
  const total = query.data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const go = (n: number) => setPage(Math.min(Math.max(1, n), lastPage));
  const first = total ? (page - 1) * pageSize + 1 : 0;
  return <section className="composer history-panel">
    <div className="composer-heading"><div><h2>Sent emails</h2><p>{total ? `${total} emails · newest first` : 'Newest first'}</p></div>
      <button className="icon-button" type="button" aria-label="Refresh history" disabled={query.isFetching} onClick={() => query.refetch()}><RefreshCw size={18} className={query.isFetching ? 'spin' : ''}/></button></div>
    {query.isPending && <div className="skeleton-list"><i/><i/><i/></div>}
    {query.isError && <p className="banner error" role="alert">{query.error.message}</p>}
    {query.data && !rows.length && <div className="empty-state"><Clock3 size={32}/><h3>No emails yet</h3><p>Emails you send will appear here.</p></div>}
    {!!rows.length && <div className={`table-wrap ${query.isPlaceholderData ? 'loading' : ''}`}><table className="history-table">
      <thead><tr><th scope="col">#</th><th scope="col">Date &amp; time</th><th scope="col">User</th><th scope="col">Subject</th><th scope="col">To</th><th scope="col">CC</th><th scope="col">Attachment</th><th scope="col">Status</th></tr></thead>
      <tbody>{rows.map((entry, index) => { const t = when(entry.submittedTime); return <tr key={entry.requestId} title={`Request ID ${entry.requestId}`}>
        <td data-label="#" className="col-number">{first + index}</td>
        <td data-label="Date & time" className="col-time"><div>{t.day} <small>{t.time}</small></div></td>
        <td data-label="User">{list(entry.employeeCodes).join(', ') || '–'}</td>
        <td data-label="Subject" className="col-subject">{entry.subject}</td>
        <td data-label="To" className="col-email"><div>{list(entry.recipients).map(r => <span key={r}>{r}</span>)}</div></td>
        <td data-label="CC" className="col-email"><div>{list(entry.cc).length ? list(entry.cc).map(c => <span key={c}>{c}</span>) : '–'}</div></td>
        <td data-label="Attachment">{list(entry.attachmentNames).join(', ') || '–'}</td>
        <td data-label="Status"><div><span className={`status ${entry.status === 'SMTP_ACCEPTED' ? 'accepted' : 'uncertain'}`}>{statusLabel[entry.status] || entry.status}</span></div></td>
      </tr>; })}</tbody>
    </table></div>}
    {total > 0 && <nav className="pagination" aria-label="History pages">
      <span className="pagination-info">Showing {first}–{Math.min(page * pageSize, total)} of {total}</span>
      <div className="pagination-pages">
        <button type="button" className="page-button" aria-label="First page" disabled={page === 1} onClick={() => go(1)}><ChevronsLeft size={15}/></button>
        <button type="button" className="page-button" aria-label="Previous page" disabled={page === 1} onClick={() => go(page - 1)}><ChevronLeft size={15}/></button>
        {pageNumbers(page, lastPage).map((n, i) => n === null ? <span key={`gap${i}`} className="page-gap">…</span>
          : <button key={n} type="button" className={`page-button ${n === page ? 'current' : ''}`} aria-current={n === page ? 'page' : undefined} onClick={() => go(n)}>{n}</button>)}
        <button type="button" className="page-button" aria-label="Next page" disabled={page >= lastPage} onClick={() => go(page + 1)}><ChevronRight size={15}/></button>
        <button type="button" className="page-button" aria-label="Last page" disabled={page >= lastPage} onClick={() => go(lastPage)}><ChevronsRight size={15}/></button>
      </div>
      <label className="pagination-size">Rows per page
        <select value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1); }}>{PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}</select></label>
    </nav>}
    <p className="hint history-note">"Sent" means the mail server accepted the email. "Uncertain" means it may or may not have been delivered; check before sending again.</p>
  </section>;
}
