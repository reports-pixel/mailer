import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import type { Employee } from '../types';

export const employeeLabel = (e: Employee) => `${e.employeeCode}-${e.employeeName}`;

/** Dropdown with checkboxes. Selected users show as "CODE-NAME", up to 5 lines, then scroll. */
export default function EmployeeMultiSelect({ id, employees, value, onChange, disabled, loading }: {
  id: string; employees: Employee[]; value: Employee[]; onChange: (value: Employee[]) => void; disabled?: boolean; loading?: boolean;
}) {
  const [open, setOpen] = useState(false); const [filter, setFilter] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close); return () => document.removeEventListener('mousedown', close);
  }, []);
  const selected = useMemo(() => new Set(value.map(e => e.employeeCode)), [value]);
  const q = filter.trim().toUpperCase();
  const shown = q ? employees.filter(e => employeeLabel(e).toUpperCase().includes(q)) : employees;
  const toggle = (employee: Employee) => onChange(selected.has(employee.employeeCode)
    ? value.filter(e => e.employeeCode !== employee.employeeCode) : [...value, employee]);
  const selectShown = () => onChange([...value, ...shown.filter(e => e.selectable && !selected.has(e.employeeCode))]);
  return <div className="multi-select" ref={box}>
    <button type="button" id={id} className="multi-select-box" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
      {value.length ? <span className="multi-select-values">{value.map(e => <span key={e.employeeCode} className="multi-select-value">{employeeLabel(e)}
        {!disabled && <i role="button" tabIndex={-1} aria-label={`Remove ${e.employeeCode}`} onClick={event => { event.stopPropagation(); toggle(e); }}><X size={12}/></i>}</span>)}</span>
        : <span className="multi-select-placeholder">{loading ? 'Loading users…' : 'Select users'}</span>}
      <ChevronDown size={16}/>
    </button>
    {open && !disabled && <div className="multi-select-menu" role="listbox" aria-multiselectable="true">
      <div className="multi-select-search"><Search size={14}/><input autoFocus placeholder="Search code or name" value={filter} onChange={event => setFilter(event.target.value)}/></div>
      <div className="multi-select-tools"><span>{value.length} selected · {shown.length} shown</span>
        <button type="button" onClick={selectShown}>Select all shown</button><button type="button" onClick={() => onChange([])}>Clear</button></div>
      <div className="multi-select-options">{shown.slice(0, 500).map(e => <label key={e.employeeCode} className={e.selectable ? '' : 'disabled'}>
        <input type="checkbox" checked={selected.has(e.employeeCode)} disabled={!e.selectable} onChange={() => toggle(e)}/>
        <span>{employeeLabel(e)}</span>{!e.selectable && <small>no email</small>}</label>)}
        {shown.length > 500 && <p className="hint">Showing the first 500. Type to narrow the list.</p>}
        {!shown.length && <p className="hint">{loading ? 'Loading…' : 'No users match.'}</p>}</div>
    </div>}
  </div>;
}
