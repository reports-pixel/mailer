import { useEffect, useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight, LoaderCircle, Search, UserPlus, X } from 'lucide-react';
import { searchEmployees } from '../api';
import type { Employee } from '../types';

export default function RecipientPicker({ value, onChange, limit, disabled }: {
  value: Employee[]; onChange: (value: Employee[]) => void; limit: number; disabled: boolean;
}) {
  const id = useId();
  const [text, setText] = useState(''); const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1); const [open, setOpen] = useState(false); const [active, setActive] = useState(-1);
  useEffect(() => { const timer = setTimeout(() => { setDebounced(text.trim()); setPage(1); setActive(-1); }, 250); return () => clearTimeout(timer); }, [text]);
  const query = useQuery({ queryKey: ['employees', debounced, page], queryFn: ({ signal }) => searchEmployees(debounced, page, signal),
    enabled: debounced.length >= 2 && !disabled, staleTime: 30000, gcTime: 60000 });
  const results = query.data?.data || [];
  const selected = (employee: Employee) => value.some(v => v.employeeCode.toUpperCase() === employee.employeeCode.toUpperCase() || v.email.toLowerCase() === employee.email.toLowerCase());
  const allowed = (employee: Employee) => employee.selectable && !selected(employee) && value.length < limit;
  const add = (employee: Employee) => { if (allowed(employee)) { onChange([...value, employee]); setText(''); setOpen(false); setActive(-1); } };
  return <div className="recipient-picker" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <div className="field-heading"><label htmlFor={`${id}-input`}>To <span className="required">*</span></label><span>{value.length} / {limit} selected</span></div>
    <div className={`recipient-box ${open ? 'focused' : ''}`}>
      {value.map(employee => <span className="recipient-chip" key={employee.employeeCode}><span className="avatar mini">{employee.employeeName.slice(0, 1)}</span><span>{employee.employeeName}</span><button type="button" disabled={disabled} aria-label={`Remove ${employee.employeeName}`} onClick={() => onChange(value.filter(e => e.employeeCode !== employee.employeeCode))}><X size={13}/></button></span>)}
      <div className="search-line"><Search size={17}/><input id={`${id}-input`} role="combobox" aria-label="Search employees by name, code or email" aria-expanded={open && text.trim().length >= 2} aria-controls={`${id}-list`} aria-autocomplete="list" aria-activedescendant={active >= 0 && active < results.length ? `${id}-option-${active}` : undefined}
        value={text} maxLength={80} disabled={disabled} placeholder="Search employee name, FP code or email…" autoComplete="off"
        onChange={e => { setText(e.target.value); setOpen(true); setActive(-1); }} onFocus={() => setOpen(true)} onKeyDown={e => {
          if (e.key === 'Escape') { setOpen(false); return; }
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault(); setOpen(true); const direction = e.key === 'ArrowDown' ? 1 : -1;
            for (let i = 1; i <= results.length; i++) { const next = (active + direction * i + results.length) % results.length; if (allowed(results[next])) { setActive(next); document.getElementById(`${id}-option-${next}`)?.scrollIntoView({ block: 'nearest' }); break; } }
          }
          if (e.key === 'Enter') { e.preventDefault(); if (open && active >= 0 && active < results.length) add(results[active]); }
        }}/>{query.isFetching && <LoaderCircle className="spin" size={17}/>}<UserPlus size={17}/></div>
    </div>
    <p className="hint">Search with 2 or more characters. Try an FP code or any part of a name.</p>
    {open && text.trim().length >= 2 && <div className="dropdown">
      <div className="dropdown-heading"><span>EMPLOYEE DIRECTORY</span><span>{query.isFetching || text.trim() !== debounced ? 'Searching…' : `${results.length} results`}</span></div>
      {query.isError ? <p role="alert" className="dropdown-message error-text">{query.error.message} <button type="button" onClick={() => query.refetch()}>Try again</button></p>
        : query.isFetching || text.trim() !== debounced ? <div className="skeleton-list" aria-label="Searching employees"><i/><i/><i/></div>
        : !results.length ? <p className="dropdown-message">No employees found. Try another name or code.</p> : null}
      <ul id={`${id}-list`} role="listbox" aria-label="Employee results" aria-multiselectable="true">
        {!query.isFetching && text.trim() === debounced && results.map((employee, index) => <li id={`${id}-option-${index}`} key={employee.employeeCode} role="option" aria-selected={selected(employee)} aria-disabled={!allowed(employee)} className={`employee-option ${active === index ? 'active' : ''} ${!allowed(employee) ? 'unavailable' : ''}`}
          onMouseDown={e => e.preventDefault()} onClick={() => add(employee)}>
          <span className="avatar">{employee.employeeName.slice(0, 1)}</span><span className="employee-details"><strong>{employee.employeeName}</strong><span><b>{employee.employeeCode}</b><span className="dot">·</span>{employee.selectable ? employee.email : 'No valid registered email'}</span></span>{selected(employee) && <Check size={17}/>}
        </li>)}
      </ul>
      {(page > 1 || query.data?.hasMore) && <div className="dropdown-pages"><button type="button" disabled={page === 1 || query.isFetching} onClick={() => { setPage(p => p - 1); setActive(-1); }}><ChevronLeft size={14}/>Previous</button><span>Page {page}</span><button type="button" disabled={!query.data?.hasMore || query.isFetching} onClick={() => { setPage(p => p + 1); setActive(-1); }}>Next<ChevronRight size={14}/></button></div>}
    </div>}
  </div>;
}
