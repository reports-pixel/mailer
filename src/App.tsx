import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Check, CheckCircle2, Clock3, FileText, Info, LoaderCircle, LockKeyhole, LogOut, Mail, PenLine, Send, ShieldCheck, Users as UsersIcon, X } from 'lucide-react';
import { ApiError, config, logout, send, session, whenSignedOut } from './api';
import Login from './components/Login';
import RecipientPicker from './components/RecipientPicker';
import Attachments from './components/Attachments';
import CcInput from './components/CcInput';
import SendChecklist, { mailCheck, MailStatusBanner, type Check as CheckItem } from './components/SendChecklist';
import { ccValid, createRequestId } from './utils/mail';
import type { Employee, MailForm, Config } from './types';

const History = lazy(() => import('./components/History'));
const MailPage = lazy(() => import('./components/MailPage'));
const Schedules = lazy(() => import('./components/Schedules'));
const Users = lazy(() => import('./components/Users'));
type Tab = 'compose' | 'schedules' | 'users' | 'history';
const pages: Record<Tab, { title: string; text: string }> = {
  compose: { title: 'Send mail', text: 'Each selected user receives a separate email with their own PDF.' },
  schedules: { title: 'Daily schedules', text: 'Send the PDFs automatically at set times, once or several times a day.' },
  users: { title: 'Users', text: 'The user list that the Company and User fields are filled from.' },
  history: { title: 'History', text: 'Every email sent from this portal, with its status.' },
};
type Notice = { type: 'error' | 'success'; text: string } | null;

function Brand() { return <div className="brand"><span className="brand-monogram">KG<span>◆</span></span><span><strong>KG GIRDHARLAL</strong><small>EMPLOYEE EMAIL PORTAL</small></span></div>; }

function Composer({ profile }: { profile: Config }) {
  const [mode, setMode] = useState<'individual' | 'shared'>('individual');
  return <><div className="delivery-mode" role="group" aria-label="Email delivery mode"><button type="button" className={mode === 'individual' ? 'active' : ''} onClick={() => setMode('individual')}><FileText size={16}/>Employee-specific PDFs</button><button type="button" className={mode === 'shared' ? 'active' : ''} onClick={() => setMode('shared')}><Mail size={16}/>Shared email & attachments</button></div>
    <div className={mode === 'individual' ? '' : 'hidden'}><Suspense fallback={<div className="composer skeleton-list"><i/><i/><i/></div>}><MailPage profile={profile}/></Suspense></div><div className={mode === 'shared' ? '' : 'hidden'}><SharedComposer profile={profile}/></div></>;
}

function SharedComposer({ profile }: { profile: Config }) {
  const queryClient = useQueryClient();
  const { register, handleSubmit, reset, control, formState: { errors, isDirty } } = useForm<MailForm>({ defaultValues: { cc: profile.defaultCc, subject: '', message: '' } });
  const [subject = '', message = '', cc = ''] = useWatch({ control, name: ['subject', 'message', 'cc'] });
  const [recipients, setRecipients] = useState<Employee[]>([]); const [files, setFiles] = useState<File[]>([]);
  const [notice, setNotice] = useState<Notice>(null); const [busy, setBusy] = useState(false); const [progress, setProgress] = useState(0);
  const [locked, setLocked] = useState(false); const [completed, setCompleted] = useState(false); const [confirmClear, setConfirmClear] = useState(false);
  const requestId = useRef<string | null>(null); const sending = useRef(false);
  const dirty = isDirty || recipients.length > 0 || files.length > 0 || locked;
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => { if (dirty && !completed) event.preventDefault(); };
    window.addEventListener('beforeunload', handler); return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, completed]);
  const clear = () => { reset({ cc: profile.defaultCc, subject: '', message: '' }); setRecipients([]); setFiles([]); setNotice(null); setLocked(false); setCompleted(false); setProgress(0); requestId.current = null; setConfirmClear(false); };
  const submit = async (values: MailForm) => {
    if (sending.current || completed) return;
    if (!recipients.length) { setNotice({ type: 'error', text: 'Select at least one employee to receive this email.' }); return; }
    sending.current = true; setNotice(null); setProgress(0);
    try {
      // getRandomValues also works on LAN HTTP; retain the same ID after uncertain results.
      requestId.current ||= createRequestId();
      setBusy(true); setLocked(true);
      const response = await send(values, recipients.map(e => e.employeeCode), files, requestId.current, setProgress);
      setNotice({ type: 'success', text: response.message }); setCompleted(true); queryClient.invalidateQueries({ queryKey: ['history'] });
    } catch (e) {
      setNotice({ type: 'error', text: e instanceof Error ? e.message : 'The email could not be submitted. Please try again.' });
      if (!requestId.current || (e instanceof ApiError && [400, 413, 429].includes(e.status))) { setLocked(false); requestId.current = null; }
    } finally { setBusy(false); sending.current = false; }
  };
  const checks: CheckItem[] = [mailCheck(profile),
    { label: 'Recipients', ok: recipients.length > 0, detail: recipients.length ? `${recipients.length} selected.` : 'No recipients selected. Search for employees above.' },
    { label: 'Subject', ok: !!subject.trim() && subject.length <= 200, detail: subject.trim() ? 'OK.' : 'Enter a subject.' },
    { label: 'Message', ok: !!message.trim(), detail: message.trim() ? 'OK.' : 'Enter a message.' },
    { label: 'CC', ok: ccValid(cc), detail: ccValid(cc) ? (cc.trim() ? cc : 'No CC.') : `"${cc}" is not a valid list of email addresses separated by commas.` },
    { label: 'Attachments', ok: true, detail: files.length ? `${files.length} attached.` : 'None (optional).' }];
  if (completed) checks.push({ label: 'This email', ok: false, detail: 'Already sent. Click "Compose another" to write a new one.' });
  return <>
    <section className="composer"><div className="composer-heading"><div className="composer-title"><span className="section-icon"><PenLine size={21}/></span><div><h2>Compose email</h2><p>A clear message. The right people.</p></div></div><span className="internal-badge"><span/>INTERNAL COMMUNICATION</span></div>
      {notice && <div className={`banner ${notice.type}`} role={notice.type === 'error' ? 'alert' : 'status'}>{notice.type === 'success' ? <CheckCircle2 size={19}/> : <Info size={19}/>}<span>{notice.text}</span></div>}
      <form onSubmit={handleSubmit(submit)}>
        <div className="compose-fields"><div className="field-heading"><label htmlFor="from">From</label><span><LockKeyhole size={12}/>Managed by your organization</span></div>
          <div className="from-field"><span className="avatar sender-avatar">KG</span><input id="from" readOnly value={profile.sender}/><span className="verified-mark"><CheckCircle2 size={15}/>Verified sender</span></div>
          <fieldset disabled={busy || locked} className="recipient-fieldset"><RecipientPicker value={recipients} onChange={value => { setRecipients(value); setNotice(null); }} limit={profile.limits.recipients} disabled={busy || locked}/></fieldset>
          <div className="cc-field"><div className="field-heading"><label htmlFor="cc">CC</label><span>Optional</span></div><Controller control={control} name="cc" rules={{ validate: value => ccValid(value) || 'Enter valid CC emails.' }} render={({ field }) => <CcInput id="cc" value={field.value} onChange={field.onChange} disabled={busy || locked}/>}/>{errors.cc && <p className="field-error">{errors.cc.message}</p>}</div>
          <div className="subject-field"><label htmlFor="subject">Subject <span className="required">*</span></label><input id="subject" placeholder="Give your email a subject" readOnly={locked} disabled={busy} maxLength={200} aria-invalid={!!errors.subject} {...register('subject', { validate: value => !!value.trim() || 'Enter a subject.', maxLength: { value: 200, message: 'Keep the subject under 200 characters.' }, pattern: { value: /^[^\r\n]*$/, message: 'Remove line breaks from the subject.' } })}/>{errors.subject && <p className="field-error">{errors.subject.message}</p>}</div>
          <div className="message-field"><div className="field-heading"><label htmlFor="message">Message <span className="required">*</span></label><span>Plain text · line breaks preserved</span></div><textarea id="message" placeholder={'Dear team,\n\nWrite your message here…\n\nRegards'} readOnly={locked} disabled={busy} maxLength={50000} aria-invalid={!!errors.message} {...register('message', { validate: value => !!value.trim() || 'Enter a message.', maxLength: { value: 50000, message: 'Keep the message under 50,000 characters.' } })}/>{errors.message && <p className="field-error">{errors.message.message}</p>}<div className="editor-footer"><span><FileText size={13}/>Simple, readable and ready to send</span><span>UTF-8</span></div></div>
          <Attachments files={files} onChange={setFiles} limits={profile.limits} disabled={busy || locked} onError={text => setNotice({ type: 'error', text })}/>
        </div>
        {busy && <div className="upload-progress" role="status"><div><span>{progress < 100 ? `Uploading attachments… ${progress}%` : 'Upload complete. Waiting for SMTP confirmation…'}</span><span className="spin"><LoaderCircle size={14}/></span></div><progress max={100} value={progress}/></div>}
        {locked && !busy && !completed && <p className="banner info"><Info size={17}/>This submission is preserved. A retry uses the same request ID. Check history before clearing or creating another message.</p>}
        {!busy && <SendChecklist checks={checks}/>}
        <div className="composer-actions"><span className="privacy-note"><ShieldCheck size={15}/>Sent securely through your organization</span><div><button className="secondary" type="button" disabled={busy} onClick={() => dirty && !completed ? setConfirmClear(true) : clear()}>{completed ? 'Compose another' : 'Clear form'}</button><button className="primary" type="submit" disabled={busy || completed || !profile.mailEnabled}>{busy ? <LoaderCircle className="spin" size={17}/> : completed ? <Check size={17}/> : <Send size={17}/>} {busy ? 'Sending…' : completed ? 'Submitted' : locked ? 'Retry same submission' : 'Send email'}</button></div></div>
      </form>
    </section>
    {confirmClear && <div className="modal-backdrop"><section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="clear-title"><button className="icon-button dialog-close" aria-label="Cancel clearing" onClick={() => setConfirmClear(false)}><X size={18}/></button><h2 id="clear-title">Clear this message?</h2><p>{locked ? 'A previous submission may already have reached SMTP. Check history before sending this content again.' : 'The recipients, message and selected attachments will be removed.'}</p><div><button autoFocus className="secondary" onClick={() => setConfirmClear(false)}>Keep message</button><button className="primary" onClick={clear}>Clear form</button></div></section></div>}
  </>;
}

/** Shows the sign-in screen until there is a valid session. */
export default function App() {
  const client = useQueryClient();
  const auth = useQuery({ queryKey: ['session'], queryFn: session, staleTime: Infinity });
  useEffect(() => whenSignedOut(() => client.setQueryData(['session'], { username: null })), [client]);
  if (auth.isPending) return <div className="app-loading"><Brand/><LoaderCircle className="spin"/></div>;
  if (auth.isError) return <div className="app-loading"><Brand/><p className="banner error" role="alert">{auth.error.message}</p><button className="secondary" onClick={() => auth.refetch()}>Try again</button></div>;
  if (!auth.data.username) return <Login onSignedIn={() => { client.removeQueries({ predicate: q => q.queryKey[0] !== 'session' }); auth.refetch(); }}/>;
  return <Portal username={auth.data.username} onSignOut={async () => { await logout().catch(() => {}); client.clear(); client.setQueryData(['session'], { username: null }); }}/>;
}

function Portal({ username, onSignOut }: { username: string; onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>('compose');
  const current = useQuery({ queryKey: ['config'], queryFn: config, staleTime: 60000 });
  const profile = current.data;
  if (current.isPending) return <div className="app-loading"><Brand/><LoaderCircle className="spin"/><p>Opening your workspace…</p></div>;
  if (!profile) return <div className="app-loading"><Brand/><p className="banner error" role="alert">{current.error?.message || 'The portal service is not available.'}</p><button className="secondary" onClick={() => current.refetch()}>Try again</button></div>;
  const nav = ([['compose', PenLine], ['schedules', CalendarClock], ['users', UsersIcon], ['history', Clock3]] as [Tab, typeof PenLine][])
    .filter(([id]) => id !== 'schedules' || profile.schedulesEnabled);
  return <div className="app-shell">
    <aside className="sidebar"><Brand/>
      <nav aria-label="Main navigation">{nav.map(([id, Icon]) => <button key={id} type="button" className={tab === id ? 'nav-item selected' : 'nav-item'} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}><Icon size={18}/><span>{pages[id].title}</span></button>)}</nav>
      <div className="sidebar-status" title={profile.mailStatus.detail}><span className={`status-dot ${profile.mailEnabled ? 'on' : 'off'}`}/><span><strong>{profile.mailEnabled ? 'Sending on' : 'Sending off'}</strong><small>{profile.sender}</small></span><button type="button" className="icon-button sign-out" aria-label={`Sign out ${username}`} title={`Sign out (${username})`} onClick={onSignOut}><LogOut size={16}/></button></div>
    </aside>
    <main className="main-content">
      <header className="page-head"><h1>{pages[tab].title}</h1><p>{pages[tab].text}</p></header>
      <MailStatusBanner profile={profile}/>
      <div className={tab === 'compose' ? '' : 'hidden'}><Composer profile={profile}/></div>
      {tab === 'users' && <Suspense fallback={<div className="composer skeleton-list"><i/><i/><i/></div>}><Users/></Suspense>}
      {tab === 'schedules' && <Suspense fallback={<div className="composer skeleton-list"><i/><i/><i/></div>}><Schedules profile={profile}/></Suspense>}
      {tab === 'history' && <Suspense fallback={<div className="composer skeleton-list"><i/><i/><i/></div>}><History/></Suspense>}
      <footer className="main-footer">© {new Date().getFullYear()} KG Girdharlal · Internal use only</footer>
    </main>
  </div>;
}
