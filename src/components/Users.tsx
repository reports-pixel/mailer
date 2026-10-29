import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, LoaderCircle, RefreshCw, Upload, Users as UsersIcon } from 'lucide-react';
import { importUsers, syncUsers, users } from '../api';

/** The user list in Turso: import the employee API JSON (paste or file), or sync it from the Windows server. */
export default function Users() {
  const client = useQueryClient();
  const summary = useQuery({ queryKey: ['users'], queryFn: users });
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const done = async (action: () => Promise<{ imported: number; withoutEmail: number }>) => {
    setBusy(true); setNotice(null);
    try {
      const result = await action();
      setNotice({ error: false, text: `Imported ${result.imported} users${result.withoutEmail ? ` (${result.withoutEmail} without a valid email; they cannot be selected)` : ''}.` });
      setText('');
      await Promise.all(['users', 'companies', 'employees', 'config'].map(key => client.invalidateQueries({ queryKey: [key] })));
    } catch (e) { setNotice({ error: true, text: e instanceof Error ? e.message : 'Import failed.' }); }
    finally { setBusy(false); }
  };
  const importText = (value: string) => done(() => {
    let rows: unknown;
    try { rows = JSON.parse(value); } catch { throw new Error('This is not valid JSON. Paste the full response of the employee API, starting with [ and ending with ].'); }
    return importUsers(rows);
  });
  const data = summary.data;
  return <section className="composer">
    <div className="composer-heading"><div className="composer-title"><span className="section-icon"><UsersIcon size={21}/></span>
      <div><h2>{data ? `${data.total} users` : 'Users'}</h2><p>{data?.updatedTime ? `Last updated ${new Date(data.updatedTime).toLocaleString()}` : 'No users imported yet.'}</p></div></div>
      {data?.canSync && <button type="button" className="secondary" disabled={busy} onClick={() => done(syncUsers)}>{busy ? <LoaderCircle className="spin" size={16}/> : <RefreshCw size={16}/>}Sync from employee API</button>}</div>
    {summary.isError && <p className="banner error" role="alert">{summary.error.message}</p>}
    {notice && <p className={`banner ${notice.error ? 'error' : 'success'}`} role={notice.error ? 'alert' : 'status'}>{!notice.error && <CheckCircle2 size={16}/>}<span>{notice.text}</span></p>}
    <div className="compose-fields">
      <p className="hint">The user list is stored in the database. {data?.canSync ? 'This server also syncs it from the employee API every hour.' : 'The Windows server syncs it from the office employee API every hour; you can also import it here.'}</p>
      <div><label htmlFor="users-json">Paste the employee API response</label>
        <textarea id="users-json" rows={8} value={text} disabled={busy} placeholder={'[\n  { "comCode": "FP", "userCode": "FP10001", "username": "RAVI KUMAR SHAH", "email": "…" }\n]'} onChange={e => setText(e.target.value)}/>
        <p className="hint">Importing replaces the whole list. Fields used: comCode, userCode, username, email.</p></div>
      <div className="mail-actions">
        <label className="secondary file-button"><Upload size={16}/>Upload .json file<input type="file" accept=".json,application/json" className="sr-only" disabled={busy} onChange={async e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) await importText(await file.text()); }}/></label>
        <button type="button" className="primary" disabled={busy || !text.trim()} onClick={() => importText(text)}>{busy ? <LoaderCircle className="spin" size={16}/> : <Upload size={16}/>}Import pasted list</button>
      </div>
    </div>
  </section>;
}
