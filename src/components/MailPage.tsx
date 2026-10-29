import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileSearch, FileText, LoaderCircle, Send, TriangleAlert, XCircle } from 'lucide-react';
import { ApiError, companies, employeesByCompany, resolveEmployeeCodes, sendEmployeePdf, templates } from '../api';
import { ccValid, createRequestId, employeeMessageTemplate, employeeSubjectTemplate, parseEmployeeCodes, personalizeTemplate, size } from '../utils/mail';
import type { Config, Employee } from '../types';
import CcInput from './CcInput';
import CompanyMultiSelect from './CompanyMultiSelect';
import EmployeeMultiSelect from './EmployeeMultiSelect';
import LocalFolderPicker, { type PickedFolder } from './LocalFolderPicker';
import { belongsTo, problemWith } from '../utils/files';

type Match = Employee & { fileName: string; size: number; files: File[]; detail: string };
type Checked = { key: string; folder: string; ready: Match[]; notFound: Match[]; noEmail: Match[]; invalid: Match[] };
type Row = { status: 'WAITING' | 'SENDING' | 'SENT' | 'FAILED' | 'UNCERTAIN'; detail: string };

/** Company → users → subject/message → path → Check Mail Format → Send Mail. */
export default function MailPage({ profile }: { profile: Config }) {
  const client = useQueryClient();
  const [selectedCompanies, setSelectedCompanies] = useState<string[] | null>(null);
  const [users, setUsers] = useState<Employee[]>([]);
  const [senderId, setSenderId] = useState(() => profile.senders.find(s => s.isDefault)?.id || profile.senders[0]?.id || '');
  // Follow Settings: if the chosen sender is removed, fall back to the default one.
  useEffect(() => { if (!profile.senders.some(s => s.id === senderId)) setSenderId(profile.senders.find(s => s.isDefault)?.id || profile.senders[0]?.id || ''); }, [profile.senders, senderId]);
  const sender = profile.senders.find(s => s.id === senderId);
  const [pasteOpen, setPasteOpen] = useState(false); const [pasteText, setPasteText] = useState('');
  const [pasteIssues, setPasteIssues] = useState<string[]>([]); const [pasting, setPasting] = useState(false);
  const [templateId, setTemplateId] = useState('');
  const [subject, setSubject] = useState(employeeSubjectTemplate);
  const [message, setMessage] = useState(employeeMessageTemplate);
  const [cc, setCc] = useState(profile.defaultCc);
  // When the CC is changed in Settings, the form follows it.
  useEffect(() => setCc(profile.defaultCc), [profile.defaultCc]);
  const [folder, setFolder] = useState<PickedFolder | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [sending, setSending] = useState(false);
  const ids = useRef<Record<string, string>>({});

  const companyList = useQuery({ queryKey: ['companies'], queryFn: ({ signal }) => companies(signal), staleTime: 60000 });
  // FP is selected at first (or the first company); more can be added like users.
  const list = companyList.data?.data;
  const chosen = selectedCompanies ?? (list?.length ? [list.find(c => c.code === 'FP')?.code || list[0].code] : []);
  const changeCompanies = (next: string[]) => { setSelectedCompanies(next); setUsers(current => current.filter(u => !u.company || next.includes(u.company))); };
  const employeeList = useQuery({ queryKey: ['employees', chosen.join(',')], queryFn: ({ signal }) => employeesByCompany(chosen, signal), enabled: chosen.length > 0, staleTime: 60000 });
  /** Selects the pasted codes (one per line, or separated by commas or spaces) and ticks their companies. */
  const selectPasted = async () => {
    const codes = parseEmployeeCodes(pasteText);
    setPasteIssues([]);
    if (!codes.length) { setPasteIssues(['Paste user codes such as FP10001, one per line or separated by commas or spaces.']); return; }
    setPasting(true);
    try {
      const result = await resolveEmployeeCodes(codes);
      const merged = [...users];
      for (const employee of result.data) if (!merged.some(u => u.employeeCode === employee.employeeCode)) merged.push(employee);
      const added = merged.length - users.length;
      const neededCompanies = result.data.map(e => e.company).filter((c): c is string => !!c && !chosen.includes(c));
      if (neededCompanies.length) setSelectedCompanies([...new Set([...chosen, ...neededCompanies])]);
      setUsers(merged);
      setPasteIssues([`${added} of ${codes.length} codes selected.`, ...result.issues]);
      if (!result.issues.length) { setPasteText(''); setPasteOpen(false); }
    } catch (error) { setPasteIssues([error instanceof Error ? error.message : 'The codes could not be checked.']); }
    finally { setPasting(false); }
  };
  const templateList = useQuery({ queryKey: ['templates'], queryFn: ({ signal }) => templates(signal), staleTime: 60000 });
  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const template = templateList.data?.data.find(t => t.id === id);
    if (template) { setSubject(template.subject); setMessage(template.message); }
  };

  // Any change after checking means the preview no longer matches what would be sent.
  const key = JSON.stringify([senderId, users.map(u => u.employeeCode), subject, message, cc, folder?.pickedAt]);
  const stale = !!checked && checked.key !== key;
  const done = Object.values(rows).filter(r => r.status === 'SENT' || r.status === 'FAILED' || r.status === 'UNCERTAIN').length;
  const sent = Object.values(rows).filter(r => r.status === 'SENT').length;
  const finished = !!checked && !sending && checked.ready.length > 0 && done === checked.ready.length;

  const validate = () => {
    const found: string[] = [];
    if (!chosen.length) found.push('Company: choose at least one company.');
    if (!users.length) found.push('User: select at least one user.');
    if (!subject.trim()) found.push('Subject: enter a subject.');
    else if (subject.length > 200) found.push('Subject: keep it under 200 characters.');
    if (!message.trim()) found.push('Message: enter a message.');
    if (!folder) found.push('Path: click "Choose folder…" and pick the folder that holds the files.');
    if (!ccValid(cc)) found.push(`CC: "${cc}" is not a valid list of email addresses separated by commas.`);
    return found;
  };
  const check = async () => {
    const found = validate(); setErrors(found); setChecked(null); setRows({}); ids.current = {};
    if (found.length || !folder) return;
    setChecking(true);
    // Matched in the browser: every file in the chosen folder whose name starts with the user's code (FP10001.pdf,
    // FP10001.xlsx, FP10001_salary.png…), each checked to really be that type and within the size limits.
    const result: Checked = { key, folder: folder.name, ready: [], notFound: [], noEmail: [], invalid: [] };
    try {
      for (const user of users) {
        const files = folder.files.filter(f => belongsTo(f.name, user.employeeCode)).sort((a, b) => a.name.localeCompare(b.name));
        const total = files.reduce((sum, f) => sum + f.size, 0);
        const match: Match = { ...user, fileName: files.map(f => f.name).join(', ') || `${user.employeeCode}.*`, size: total, files, detail: '' };
        if (!user.selectable) { result.noEmail.push(match); continue; }
        if (!files.length) { result.notFound.push(match); continue; }
        const problems = (await Promise.all(files.map(f => problemWith(f, profile.limits.fileBytes)))).filter(Boolean);
        if (!problems.length && files.length > profile.limits.files) problems.push(`more than ${profile.limits.files} files.`);
        if (!problems.length && total > profile.limits.totalBytes) problems.push(`together larger than ${size(profile.limits.totalBytes)}.`);
        if (problems.length) result.invalid.push({ ...match, detail: problems.join(' ') });
        else result.ready.push(match);
      }
      setChecked(result);
    } catch { setErrors(['Path: the folder could not be read. Choose it again.']); }
    finally { setChecking(false); }
  };
  const sendAll = async () => {
    if (!checked || stale || sending) return;
    setSending(true);
    const start: Record<string, Row> = {};
    // A retry skips sent mails, and never resends an uncertain one (it may already have been delivered).
    const keep = (row?: Row) => row?.status === 'SENT' || row?.status === 'UNCERTAIN';
    for (const m of checked.ready) start[m.employeeCode] = keep(rows[m.employeeCode]) ? rows[m.employeeCode] : { status: 'WAITING', detail: 'Waiting…' };
    let current = start; setRows(current);
    const update = (code: string, row: Row) => { current = { ...current, [code]: row }; setRows(current); };
    for (const m of checked.ready) {
      if (keep(current[m.employeeCode])) continue;
      ids.current[m.employeeCode] ||= createRequestId();
      update(m.employeeCode, { status: 'SENDING', detail: `Sending ${m.fileName} to ${m.email}…` });
      try {
        await sendEmployeePdf({ cc, subject, message }, m.employeeCode, m.files, ids.current[m.employeeCode], senderId);
        update(m.employeeCode, { status: 'SENT', detail: `Sent to ${m.email}.` });
      } catch (error) {
        const uncertain = !(error instanceof ApiError) || error.status === 0 || error.status >= 500 || error.status === 409;
        update(m.employeeCode, { status: uncertain ? 'UNCERTAIN' : 'FAILED', detail: error instanceof Error ? error.message : 'Not sent.' });
      }
    }
    setSending(false); client.invalidateQueries({ queryKey: ['history'] });
  };

  // Every reason the Send button is disabled, shown next to it.
  const blockers: string[] = [];
  if (!sender) blockers.push('Sender: add a sender account under Settings (⚙).');
  else if (sender.isDefault && !profile.mailEnabled) blockers.push(`Sender: ${profile.mailStatus.detail}`);
  if (!checked) blockers.push('Click "Check Mail Format" first.');
  else if (stale) blockers.push('The form changed after checking. Click "Check Mail Format" again.');
  else if (!checked.ready.length) blockers.push('No selected user has a file in the chosen folder.');
  if (finished) blockers.push(`Finished: ${sent} of ${checked!.ready.length} sent. Click "Check Mail Format" to send again.`);
  const retryable = finished && Object.values(rows).some(r => r.status === 'FAILED');
  const canSend = profile.mailEnabled && !!checked && !stale && checked.ready.length > 0 && !sending && (!finished || retryable);

  return <section className="composer mail-page">
    <div className="composer-heading"><div className="composer-title"><span className="section-icon"><Send size={21}/></span><div><h2>Mail</h2><p>Each selected user receives a separate email with their own files.</p></div></div></div>
    <div className="mail-form">
      <label htmlFor="mail-sender">Sender</label>
      <div><select id="mail-sender" value={senderId} disabled={sending || !profile.senders.length} onChange={event => setSenderId(event.target.value)}>
        {!profile.senders.length && <option value="">No sender set up</option>}
        {profile.senders.map(s => <option key={s.id} value={s.id}>{s.email}{s.isDefault ? ' (default)' : ''}</option>)}
      </select><p className="hint">Sender accounts (email and app password) are managed under Settings (⚙).</p></div>
      <label htmlFor="mail-company">Company</label>
      <div><CompanyMultiSelect id="mail-company" companies={list || []} value={chosen} onChange={changeCompanies} disabled={sending} loading={companyList.isPending}/>
        {companyList.isError && <p className="field-error">{companyList.error.message}</p>}</div>
      <label htmlFor="mail-users">User</label>
      <div><EmployeeMultiSelect id="mail-users" employees={employeeList.data?.data || []} value={users} onChange={setUsers} disabled={sending || !chosen.length} loading={employeeList.isFetching}/>
        {employeeList.isError && <p className="field-error">{employeeList.error.message}</p>}
        <button type="button" className="bulk-toggle paste-toggle" disabled={sending} onClick={() => { setPasteOpen(!pasteOpen); setPasteIssues([]); }}>{pasteOpen ? 'Close' : 'Paste user codes'}</button>
        {pasteOpen && <div className="bulk-entry">
          <label htmlFor="mail-paste">Paste user codes</label>
          <textarea id="mail-paste" rows={5} value={pasteText} disabled={pasting} placeholder={'FP10001\nFP10002\nFP10003\n\nor  FP10001,FP10002,FP10003\nor  FP10001 FP10002 FP10003'} onChange={event => setPasteText(event.target.value)}/>
          <div><span className="hint">One per line, or separated by commas or spaces. Their companies are ticked automatically.</span>
            <button type="button" className="secondary" disabled={pasting || !pasteText.trim()} onClick={selectPasted}>{pasting && <LoaderCircle className="spin" size={14}/>}Select these users</button></div>
        </div>}
        {!!pasteIssues.length && <div className={pasteIssues.length > 1 ? 'bulk-issues' : 'hint'} role="status">{pasteIssues.map(issue => <p key={issue}>{issue}</p>)}</div>}</div>
      <label htmlFor="mail-template">Template</label>
      <div><select id="mail-template" value={templateId} disabled={sending || !templateList.data} onChange={event => applyTemplate(event.target.value)}>
        <option value="">{templateList.isPending ? 'Loading templates…' : 'Choose a template (optional)'}</option>
        {templateList.data?.data.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select><p className="hint">Fills in Subject and Message; you can still edit them. Manage templates under Settings (⚙).</p></div>
      <label htmlFor="mail-subject">Subject</label>
      <div><input id="mail-subject" value={subject} maxLength={200} disabled={sending} onChange={event => setSubject(event.target.value.replace(/[\r\n]/g, ''))}/>
        <p className="hint">{'{}'} becomes the employee code, for example {personalizeTemplate(subject, { employeeCode: 'FP10001', employeeName: '' }, 'employeeCode')}</p></div>
      <label htmlFor="mail-message">Message</label>
      <div><textarea id="mail-message" rows={7} value={message} maxLength={50000} disabled={sending} onChange={event => setMessage(event.target.value)}/>
        <p className="hint">{'{}'} becomes the employee name.</p></div>
      <label htmlFor="mail-cc">CC</label>
      <CcInput id="mail-cc" value={cc} disabled={sending} onChange={setCc}/>
      <span className="mail-form-label">Path</span>
      <LocalFolderPicker value={folder} disabled={sending} onChange={setFolder}/>
    </div>

    <div className="mail-actions"><button type="button" className="secondary" disabled={checking || sending} onClick={check}>
      {checking ? <LoaderCircle className="spin" size={16}/> : <FileSearch size={16}/>}Check Mail Format</button></div>

    {!!errors.length && <div className="validation-list" role="alert"><strong><XCircle size={16}/>Please fix:</strong><ul>{errors.map(e => <li key={e}>{e}</li>)}</ul></div>}

    {checked && <div className={`mail-preview ${stale ? 'stale' : ''}`}>
      {stale && <p className="banner info"><TriangleAlert size={16}/>The form changed after checking. Click "Check Mail Format" again.</p>}
      <h3><CheckCircle2 size={17}/>{checked.ready.length} {checked.ready.length === 1 ? 'mail' : 'mails'} ready, files from folder "{checked.folder}"</h3>
      {checked.ready.map(m => { const row = rows[m.employeeCode]; return <article key={m.employeeCode} className={`mail-card ${row ? row.status.toLowerCase() : ''}`}>
        <div className="mail-card-head"><span><b>To:</b> {m.employeeCode}-{m.employeeName} &lt;{m.email}&gt;</span>
          {row && <span className={`status ${row.status === 'SENT' ? 'accepted' : 'uncertain'}`}>{row.status === 'SENDING' && <LoaderCircle className="spin" size={11}/>}{row.status === 'SENT' ? 'Sent' : row.status === 'SENDING' ? 'Sending' : row.status === 'WAITING' ? 'Waiting' : row.status === 'FAILED' ? 'Not sent' : 'Uncertain'}</span>}</div>
        <p><b>Sub:</b> {personalizeTemplate(subject, m, 'employeeCode')}</p>
        <p><b>{m.files.length > 1 ? 'Attachments' : 'Attachment'}:</b> <FileText size={13}/> {m.fileName} ({size(m.size)})</p>
        <p><b>Message:</b></p><pre>{personalizeTemplate(message, m, 'employeeName')}</pre>
        {row && (row.status === 'FAILED' || row.status === 'UNCERTAIN') && <p className="field-error">{row.detail}</p>}
      </article>; })}
      {!!checked.notFound.length && <div className="validation-list"><strong><XCircle size={16}/>No file found, these users will not get a mail:</strong>
        <p>{checked.notFound.map(m => m.employeeCode).join(', ')}. No file whose name starts with their code in folder "{checked.folder}".</p></div>}
      {!!checked.noEmail.length && <div className="validation-list"><strong><XCircle size={16}/>No registered email, will not get a mail:</strong>
        <p>{checked.noEmail.map(m => m.employeeCode).join(', ')}.</p></div>}
      {!!checked.invalid.length && <div className="validation-list"><strong><XCircle size={16}/>File cannot be used, will not get a mail:</strong>
        <ul>{checked.invalid.map(m => <li key={m.employeeCode}>{m.fileName}: {m.detail}</li>)}</ul></div>}
    </div>}

    {(sending || done > 0) && checked && <div className="send-progress" role="status">
      <div><span>{sending ? `Sending ${Math.min(done + 1, checked.ready.length)} of ${checked.ready.length}…` : `Done: ${sent} sent, ${done - sent} not sent`}</span><span>{Math.round(done / checked.ready.length * 100)}%</span></div>
      <progress max={checked.ready.length} value={done}/></div>}

    <div className="mail-actions send">
      {!canSend && !sending && !!blockers.length && <ul className="send-blockers">{blockers.map(b => <li key={b}>{b}</li>)}</ul>}
      <button type="button" className="primary" disabled={!canSend} onClick={sendAll}>{sending ? <LoaderCircle className="spin" size={16}/> : <Send size={16}/>}
        {sending ? 'Sending…' : retryable ? 'Retry not sent' : `Send Mail${checked && !stale && checked.ready.length ? ` (${checked.ready.length})` : ''}`}</button>
    </div>
  </section>;
}
