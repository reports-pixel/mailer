import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Clock3, RefreshCw } from 'lucide-react';
import { history } from '../api';

export default function History() {
  const [page, setPage] = useState(1);
  const query = useQuery({ queryKey: ['history', page], queryFn: ({ signal }) => history(page, signal), staleTime: 0 });
  return <section className="composer history-panel"><div className="composer-heading"><div><h2>Submission history</h2><p>Your email submissions and SMTP acceptance status.</p></div><button className="icon-button" type="button" aria-label="Refresh history" onClick={() => query.refetch()}><RefreshCw size={18}/></button></div>
    {query.isPending && <div className="skeleton-list"><i/><i/><i/></div>}
    {query.isError && <p className="banner error" role="alert">{query.error.message}</p>}
    {query.data?.data.length === 0 && <div className="empty-state"><Clock3 size={32}/><h3>No submissions yet</h3><p>Emails you submit will appear here.</p></div>}
    {query.data?.data.map(entry => <article className="history-row" key={entry.requestId}><div className="history-title"><strong>{entry.subject}</strong><span className={`status ${entry.status === 'SMTP_ACCEPTED' ? 'accepted' : 'uncertain'}`}>{entry.status === 'SMTP_ACCEPTED' ? 'SMTP accepted' : entry.status === 'SUBMITTING' ? 'Processing' : entry.status === 'SMTP_AUTH_FAILED' ? 'Authentication failed' : 'Acceptance uncertain'}</span></div><p>From: {entry.sender}</p><p>To: {entry.recipients}</p>{entry.cc && <p>CC: {entry.cc}</p>}{entry.employeeCodes && <p><strong>Employees:</strong> {entry.employeeCodes}</p>}{entry.attachmentNames && <p><strong>Attachments:</strong> {entry.attachmentNames}</p>}<p>{new Date(entry.submittedTime).toLocaleString()} · {entry.recipientCount} recipients · {entry.attachmentCount} attachments</p><code>Request: {entry.requestId}</code></article>)}
    <div className="history-pagination"><button className="secondary" disabled={page === 1 || query.isFetching} onClick={() => setPage(p => p - 1)}><ChevronLeft size={15}/>Previous</button><span>Page {page}</span><button className="secondary" disabled={!query.data?.hasMore || query.isFetching} onClick={() => setPage(p => p + 1)}>Next<ChevronRight size={15}/></button></div>
    <p className="hint history-note">SMTP acceptance confirms submission to the mail server. It does not guarantee inbox delivery. Ask the mail administrator to investigate uncertain submissions before sending again.</p>
  </section>;
}
