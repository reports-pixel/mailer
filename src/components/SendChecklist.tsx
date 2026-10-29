import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CircleAlert, LoaderCircle, RefreshCw, XCircle } from 'lucide-react';
import { verifyMail } from '../api';
import type { Config } from '../types';

export type Check = { label: string; ok: boolean; detail: string; pending?: boolean };

/** Every condition for sending, each shown as passed, failed or still checking. */
export default function SendChecklist({ checks }: { checks: Check[] }) {
  const failing = checks.filter(check => !check.ok && !check.pending);
  const pending = checks.some(check => check.pending);
  return <section className={`send-checklist ${failing.length ? 'blocked' : pending ? 'checking' : 'ready'}`} aria-live="polite" aria-label="Before sending">
    <div className="checklist-head">{failing.length ? <XCircle size={18}/> : pending ? <LoaderCircle className="spin" size={18}/> : <CheckCircle2 size={18}/>}
      <strong>{failing.length ? `Can't send yet: ${failing.length} ${failing.length === 1 ? 'issue' : 'issues'} to fix` : pending ? 'Checking…' : 'Ready to send'}</strong></div>
    <ul>{checks.map(check => <li key={check.label} className={check.pending ? 'pending' : check.ok ? 'ok' : 'fail'}>
      {check.pending ? <LoaderCircle className="spin" size={15}/> : check.ok ? <CheckCircle2 size={15}/> : <XCircle size={15}/>}
      <div><strong>{check.label}</strong><p>{check.detail}</p></div></li>)}</ul>
  </section>;
}

export function mailCheck(profile: Config): Check {
  return { label: 'Mail server', ok: profile.mailEnabled, detail: profile.mailStatus.detail, pending: profile.mailStatus.code === 'CHECKING' };
}

/** Shows exactly why sending is unavailable, with a button to test the connection again. */
export function MailStatusBanner({ profile }: { profile: Config }) {
  const client = useQueryClient(); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  if (profile.mailEnabled) return null;
  const recheck = async () => {
    setBusy(true); setError('');
    try { const result = await verifyMail(); client.setQueryData(['config'], { ...profile, mailStatus: result.mailStatus, mailEnabled: result.mailStatus.ready }); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not test the mail server.'); }
    finally { setBusy(false); }
  };
  return <div className="banner error mail-status" role="alert"><CircleAlert size={18}/>
    <span><strong>Email sending is unavailable ({profile.mailStatus.code.replaceAll('_', ' ').toLowerCase()}).</strong> {profile.mailStatus.detail}{error && <> {error}</>}</span>
    <button type="button" className="secondary" disabled={busy} onClick={recheck}>{busy ? <LoaderCircle className="spin" size={14}/> : <RefreshCw size={14}/>}Check again</button></div>;
}
