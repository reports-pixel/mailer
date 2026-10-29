import { useState } from 'react';
import { LoaderCircle, Users, X } from 'lucide-react';
import { resolveEmployeeCodes } from '../api';
import { parseEmployeeCodes } from '../utils/mail';
import type { Employee } from '../types';

export default function BulkRecipients({ value, onChange, limit, disabled }: {
  value: Employee[]; onChange: (value: Employee[]) => void; limit: number; disabled: boolean;
}) {
  const [open, setOpen] = useState(false); const [text, setText] = useState('');
  const [busy, setBusy] = useState(false); const [issues, setIssues] = useState<string[]>([]); const [notice, setNotice] = useState('');
  async function add() {
    const codes = parseEmployeeCodes(text); setIssues([]); setNotice('');
    if (!codes.length || codes.length > limit) { setIssues([`Paste between 1 and ${limit} full employee codes.`]); return; }
    if (codes.some(code => !/^[A-Z0-9]{2,24}$/.test(code))) { setIssues(['Use full employee codes separated by a space, comma or new line.']); return; }
    setBusy(true);
    try {
      const result = await resolveEmployeeCodes(codes); const merged = [...value];
      for (const employee of result.data) {
        if (!merged.some(e => e.employeeCode.toUpperCase() === employee.employeeCode.toUpperCase() || e.email.toLowerCase() === employee.email.toLowerCase())) merged.push(employee);
      }
      if (merged.length > limit) { setIssues([`Select no more than ${limit} employees.`]); return; }
      onChange(merged); setIssues(result.issues); setNotice(`${merged.length - value.length} employees added.`);
      if (!result.issues.length) { setText(''); setOpen(false); }
    } catch (error) { setIssues([error instanceof Error ? error.message : 'Unable to find employees.']); }
    finally { setBusy(false); }
  }
  return <div className="bulk-recipients"><button className="bulk-toggle" type="button" disabled={disabled || busy} onClick={() => { setOpen(!open); setIssues([]); setNotice(''); }}><Users size={14}/>{open ? 'Close multiple-code entry' : 'Add multiple employees by code'}</button>
    {open && <div className="bulk-entry"><div className="field-heading"><label htmlFor="bulk-employee-codes">Paste employee codes or code + name</label><button type="button" className="icon-button" aria-label="Close code entry" onClick={() => setOpen(false)}><X size={14}/></button></div><textarea id="bulk-employee-codes" rows={3} value={text} disabled={disabled || busy} placeholder={'FP10001 RAVI KUMAR SHAH\nFP10002 ANITA DESAI'} onChange={event => setText(event.target.value)}/><div><span className="hint">Names are loaded from the master. Exact codes only; no typo correction.</span><button className="secondary" type="button" disabled={disabled || busy || !text.trim()} onClick={add}>{busy && <LoaderCircle className="spin" size={13}/>}Add employees</button></div></div>}
    {!!issues.length && <div className="bulk-issues" role="alert">{issues.map(issue => <p key={issue}>{issue}</p>)}</div>}{notice && <p className="hint" role="status">{notice}</p>}
  </div>;
}
