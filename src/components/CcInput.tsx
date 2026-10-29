import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { emailValid } from '../utils/mail';

const split = (value: string) => value.split(/[,;]/).map(v => v.trim()).filter(Boolean);

/** CC addresses as chips: type an address and press Add or Enter; × removes it. The value is a comma-separated string. */
export default function CcInput({ id, value, onChange, disabled }: { id: string; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const [draft, setDraft] = useState(''); const [error, setError] = useState('');
  const list = split(value);
  const add = () => {
    const incoming = split(draft);
    if (!incoming.length) return;
    const bad = incoming.find(address => !emailValid(address));
    if (bad) { setError(`"${bad}" is not a valid email address.`); return; }
    const merged = [...list];
    for (const address of incoming) if (!merged.some(a => a.toLowerCase() === address.toLowerCase())) merged.push(address);
    if (merged.length > 20) { setError('At most 20 CC addresses.'); return; }
    onChange(merged.join(', ')); setDraft(''); setError('');
  };
  return <div className="cc-input">
    {!!list.length && <div className="cc-chips">{list.map(address => <span key={address} className={`cc-chip ${emailValid(address) ? '' : 'invalid'}`}>{address}
      {!disabled && <button type="button" aria-label={`Remove ${address}`} onClick={() => onChange(list.filter(a => a !== address).join(', '))}><X size={12}/></button>}</span>)}</div>}
    <div className="cc-add"><input id={id} type="email" value={draft} disabled={disabled} placeholder={list.length ? 'Add another CC email' : 'Add CC email (optional)'}
      onChange={event => { setDraft(event.target.value); setError(''); }}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); add(); } }}/>
      <button type="button" className="secondary" disabled={disabled || !draft.trim()} onClick={add}><Plus size={14}/>Add</button></div>
    {error && <p className="field-error">{error}</p>}
  </div>;
}
