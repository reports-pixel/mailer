import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Clock3, RefreshCw } from 'lucide-react';
import { history } from '../api';

const PAGE_SIZE = 20;
const statusLabel: Record<string, string> = { SMTP_ACCEPTED: 'Sent', SUBMITTING: 'Sending', SMTP_AUTH_FAILED: 'Sign-in failed', UNKNOWN: 'Uncertain' };
const when = (iso: string) => {
  const date = new Date(iso);
  return { day: date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }), time: date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) };
};
const list = (value?: string) => (value || '').split(',').map(v => v.trim()).filter(Boolean);

/** One row per email: when, users, subject, to, CC, attachments and status. On phones each row becomes a card. */
export default function History() {
  const [page, setPage] = useState(1);
  const query = useQuery({ queryKey: ['history', page], queryFn: ({ signal }) => history(page, signal), staleTime: 0 });
  const rows = query.data?.data || [];
  return <section className="composer history-panel">
    <div className="composer-heading"><div><h2>Sent emails</h2><p>Newest first · {PAGE_SIZE} per page</p></div>
      <button className="icon-button" type="button" aria-label="Refresh history" disabled={query.isFetching} onClick={() => query.refetch()}><RefreshCw size={18} className={query.isFetching ? 'spin' : ''}/></button></div>
    {query.isPending && <div className="skeleton-list"><i/><i/><i/></div>}
    {query.isError && <p className="banner error" role="alert">{query.error.message}</p>}
    {query.data && !rows.length && <div className="empty-state"><Clock3 size={32}/><h3>No emails yet</h3><p>Emails you send will appear here.</p></div>}
    {!!rows.length && <div className="table-wrap"><table className="history-table">
      <thead><tr><th scope="col">#</th><th scope="col">Date &amp; time</th><th scope="col">User</th><th scope="col">Subject</th><th scope="col">To</th><th scope="col">CC</th><th scope="col">Attachment</th><th scope="col">Status</th></tr></thead>
      <tbody>{rows.map((entry, index) => { const t = when(entry.submittedTime); return <tr key={entry.requestId} title={`Request ID ${entry.requestId}`}>
        <td data-label="#" className="col-number">{(page - 1) * PAGE_SIZE + index + 1}</td>
        <td data-label="Date & time" className="col-time"><div>{t.day} <small>{t.time}</small></div></td>
        <td data-label="User">{list(entry.employeeCodes).join(', ') || '–'}</td>
        <td data-label="Subject" className="col-subject">{entry.subject}</td>
        <td data-label="To" className="col-email"><div>{list(entry.recipients).map(r => <span key={r}>{r}</span>)}</div></td>
        <td data-label="CC" className="col-email"><div>{list(entry.cc).length ? list(entry.cc).map(c => <span key={c}>{c}</span>) : '–'}</div></td>
        <td data-label="Attachment">{list(entry.attachmentNames).join(', ') || '–'}</td>
        <td data-label="Status"><div><span className={`status ${entry.status === 'SMTP_ACCEPTED' ? 'accepted' : 'uncertain'}`}>{statusLabel[entry.status] || entry.status}</span></div></td>
      </tr>; })}</tbody>
    </table></div>}
    {(page > 1 || query.data?.hasMore) && <div className="history-pagination"><button className="secondary" disabled={page === 1 || query.isFetching} onClick={() => setPage(p => p - 1)}><ChevronLeft size={15}/>Previous</button><span>Page {page}</span><button className="secondary" disabled={!query.data?.hasMore || query.isFetching} onClick={() => setPage(p => p + 1)}>Next<ChevronRight size={15}/></button></div>}
    <p className="hint history-note">"Sent" means the mail server accepted the email. "Uncertain" means it may or may not have been delivered; check before sending again.</p>
  </section>;
}
