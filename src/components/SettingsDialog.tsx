import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileText, KeyRound, LoaderCircle, Mail, Pencil, Plus, Save, Settings, Star, Trash2, X } from 'lucide-react';
import { deleteSender, deleteTemplate, makeDefaultSender, saveDefaultCc, saveSender, saveTemplate, templates } from '../api';
import type { Config, MailTemplate } from '../types';
import CcInput from './CcInput';

type Draft = { id?: string; name: string; subject: string; message: string };

/** Settings: sender accounts, CC addresses copied on every mail, and reusable mail templates. Saved in the database for everyone. */
export default function SettingsDialog({ profile, onClose }: { profile: Config; onClose: () => void }) {
  const client = useQueryClient();
  const list = useQuery({ queryKey: ['templates'], queryFn: ({ signal }) => templates(signal) });
  const [cc, setCc] = useState(profile.defaultCc);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [sender, setSender] = useState({ email: '', password: '', makeDefault: false });
  const [busy, setBusy] = useState(''); const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const run = async (key: string, action: () => Promise<unknown>, done: string) => {
    setBusy(key); setNotice(null);
    try { await action(); setNotice({ error: false, text: done }); return true; }
    catch (e) { setNotice({ error: true, text: e instanceof Error ? e.message : 'Could not save.' }); return false; }
    finally { setBusy(''); }
  };
  const saveCc = () => run('cc', async () => { await saveDefaultCc(cc); await client.invalidateQueries({ queryKey: ['config'] }); },
    cc.trim() ? 'CC saved. It is filled in on every new mail.' : 'CC cleared.');
  const saveDraft = async () => {
    if (!draft) return;
    if (await run('template', async () => { await saveTemplate(draft, draft.id); await client.invalidateQueries({ queryKey: ['templates'] }); }, `Template "${draft.name.trim()}" saved.`)) setDraft(null);
  };
  const refreshConfig = () => client.invalidateQueries({ queryKey: ['config'] });
  const addSender = async () => {
    const email = sender.email.trim();
    if (await run('sender', async () => { await saveSender(email, sender.password, sender.makeDefault); await refreshConfig(); },
      `${email} checked with Gmail and saved.`)) setSender({ email: '', password: '', makeDefault: false });
  };
  const remove = (t: MailTemplate) => run(t.id, async () => { await deleteTemplate(t.id); await client.invalidateQueries({ queryKey: ['templates'] }); }, `Template "${t.name}" deleted.`);

  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="confirm-dialog settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <button type="button" className="icon-button dialog-close" aria-label="Close settings" onClick={onClose}><X size={18}/></button>
      <h2 id="settings-title"><Settings size={20}/>Settings</h2>
      {notice && <p className={`banner ${notice.error ? 'error' : 'success'}`} role={notice.error ? 'alert' : 'status'}>{!notice.error && <CheckCircle2 size={16}/>}<span>{notice.text}</span></p>}

      <section className="settings-section">
        <h3>Sender accounts</h3>
        <p className="hint">The Gmail accounts emails are sent from. Use a Google <b>app password</b> (Google Account → Security → App passwords). Each account is checked with Gmail before it is saved; passwords are stored encrypted and never shown again.</p>
        <div className="template-list">{profile.senders.map(s => <article key={s.id} className="template-row">
          <Mail size={18}/><div><strong>{s.email}</strong><small>{s.isDefault ? 'Default sender' : s.builtIn ? 'Server setting' : 'Saved account'}{s.builtIn ? ' · from the server settings' : ''}</small></div>
          {s.isDefault ? <span className="status accepted"><Star size={11}/>Default</span>
            : !s.builtIn && <button type="button" className="secondary small" disabled={!!busy} onClick={() => run(s.id, async () => { await makeDefaultSender(s.id); await refreshConfig(); }, `${s.email} is now the default sender.`)}>Make default</button>}
          {!s.builtIn && <button type="button" className="icon-button" aria-label={`Delete ${s.email}`} disabled={!!busy} onClick={() => run(s.id, async () => { await deleteSender(s.id); await refreshConfig(); }, `${s.email} removed.`)}>{busy === s.id ? <LoaderCircle className="spin" size={15}/> : <Trash2 size={15}/>}</button>}
        </article>)}</div>
        <div className="sender-form">
          <div><label htmlFor="sender-email">Sender email (username)</label><input id="sender-email" type="email" autoComplete="off" placeholder="noreply@yourcompany.com" value={sender.email} disabled={!!busy} onChange={e => setSender({ ...sender, email: e.target.value })}/></div>
          <div><label htmlFor="sender-password">App password</label><input id="sender-password" type="password" autoComplete="new-password" placeholder="16-letter app password" value={sender.password} disabled={!!busy} onChange={e => setSender({ ...sender, password: e.target.value })}/></div>
          <label className="check-row"><input type="checkbox" checked={sender.makeDefault} disabled={!!busy} onChange={e => setSender({ ...sender, makeDefault: e.target.checked })}/><span><strong>Use as default sender</strong><small>Pre-selected on the Send mail page and used by daily schedules.</small></span></label>
          <div className="settings-actions"><button type="button" className="primary" disabled={!!busy || !sender.email.trim() || !sender.password.trim()} onClick={addSender}>
            {busy === 'sender' ? <LoaderCircle className="spin" size={16}/> : <KeyRound size={16}/>}{busy === 'sender' ? 'Checking with Gmail…' : 'Check & save sender'}</button></div>
        </div>
      </section>

      <section className="settings-section">
        <h3>CC email addresses</h3>
        <p className="hint">Copied on every email. Add a Gmail or any email address and press Add, then Save.</p>
        <CcInput id="settings-cc" value={cc} disabled={!!busy} onChange={setCc}/>
        <div className="settings-actions"><button type="button" className="primary" disabled={!!busy || cc === profile.defaultCc} onClick={saveCc}>
          {busy === 'cc' ? <LoaderCircle className="spin" size={16}/> : <Save size={16}/>}Save CC</button></div>
      </section>

      <section className="settings-section">
        <div className="settings-heading"><h3>Mail templates</h3>
          {!draft && <button type="button" className="secondary" onClick={() => setDraft({ name: '', subject: '{}-Attachment', message: 'Dear {},\n\n\n\nRegard\nSecurity' })}><Plus size={16}/>New template</button>}</div>
        <p className="hint">{'{}'} in the subject becomes the user code; in the message, the user name. Choose a template on the Send mail page.</p>
        {list.isPending && <div className="skeleton-list"><i/></div>}
        {list.isError && <p className="banner error">{list.error.message}</p>}
        {!draft && <div className="template-list">{list.data?.data.map(t => <article key={t.id} className="template-row">
          <FileText size={18}/><div><strong>{t.name}</strong><small>{t.subject}</small></div>
          <button type="button" className="icon-button" aria-label={`Edit ${t.name}`} disabled={!!busy} onClick={() => setDraft({ id: t.id, name: t.name, subject: t.subject, message: t.message })}><Pencil size={15}/></button>
          <button type="button" className="icon-button" aria-label={`Delete ${t.name}`} disabled={!!busy} onClick={() => remove(t)}>{busy === t.id ? <LoaderCircle className="spin" size={15}/> : <Trash2 size={15}/>}</button>
        </article>)}</div>}
        {draft && <div className="template-editor">
          <div><label htmlFor="template-name">Template name</label><input id="template-name" maxLength={80} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Monthly attendance"/></div>
          <div><label htmlFor="template-subject">Subject</label><input id="template-subject" maxLength={200} value={draft.subject} onChange={e => setDraft({ ...draft, subject: e.target.value.replace(/[\r\n]/g, '') })}/></div>
          <div><label htmlFor="template-message">Message</label><textarea id="template-message" rows={7} value={draft.message} onChange={e => setDraft({ ...draft, message: e.target.value })}/></div>
          <div className="settings-actions"><button type="button" className="secondary" disabled={!!busy} onClick={() => setDraft(null)}>Cancel</button>
            <button type="button" className="primary" disabled={!!busy || !draft.name.trim() || !draft.subject.trim() || !draft.message.trim()} onClick={saveDraft}>
              {busy === 'template' ? <LoaderCircle className="spin" size={16}/> : <Save size={16}/>}{draft.id ? 'Save changes' : 'Save template'}</button></div>
        </div>}
      </section>
    </section>
  </div>;
}
