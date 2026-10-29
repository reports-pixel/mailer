import { useEffect, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';

export type Company = { code: string; employees: number };

/** Dropdown with checkboxes for companies, styled like the user selection. */
export default function CompanyMultiSelect({ id, companies, value, onChange, disabled, loading }: {
  id: string; companies: Company[]; value: string[]; onChange: (value: string[]) => void; disabled?: boolean; loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close); return () => document.removeEventListener('mousedown', close);
  }, []);
  const label = (code: string) => { const c = companies.find(x => x.code === code); return c ? `${c.code} (${c.employees} users)` : code; };
  const toggle = (code: string) => onChange(value.includes(code) ? value.filter(c => c !== code) : companies.map(c => c.code).filter(c => c === code || value.includes(c)));
  return <div className="multi-select" ref={box}>
    <button type="button" id={id} className="multi-select-box" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
      {value.length ? <span className="multi-select-values">{value.map(code => <span key={code} className="multi-select-value">{label(code)}
        {!disabled && <i role="button" tabIndex={-1} aria-label={`Remove ${code}`} onClick={event => { event.stopPropagation(); toggle(code); }}><X size={12}/></i>}</span>)}</span>
        : <span className="multi-select-placeholder">{loading ? 'Loading companies…' : 'Select companies'}</span>}
      <ChevronDown size={16}/>
    </button>
    {open && !disabled && <div className="multi-select-menu" role="listbox" aria-multiselectable="true">
      <div className="multi-select-tools"><span>{value.length} of {companies.length} selected</span>
        <button type="button" onClick={() => onChange(companies.map(c => c.code))}>Select all</button><button type="button" onClick={() => onChange([])}>Clear</button></div>
      <div className="multi-select-options">{companies.map(c => <label key={c.code}>
        <input type="checkbox" checked={value.includes(c.code)} onChange={() => toggle(c.code)}/><span>{c.code}</span><small className="count">{c.employees} users</small></label>)}</div>
    </div>}
  </div>;
}
