import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUp, Check, FileText, Folder, FolderOpen, HardDrive, LoaderCircle, X } from 'lucide-react';
import { listFolders } from '../api';

const STORAGE_KEY = 'kg-pdf-folder';
export function rememberedFolder(fallback: string) {
  try { return localStorage.getItem(STORAGE_KEY) || fallback; } catch { return fallback; }
}
export function rememberFolder(path: string) {
  try { localStorage.setItem(STORAGE_KEY, path); } catch { /* Remembering the folder is optional. */ }
}

/** Choose a folder on this server: type a path, or browse drives and folders. */
export default function FolderPicker({ value, onChange, disabled, id }: { value: string; onChange: (path: string) => void; disabled?: boolean; id: string }) {
  const [open, setOpen] = useState(false); const [draft, setDraft] = useState(value); const [browse, setBrowse] = useState(value);
  const listing = useQuery({ queryKey: ['folders', browse], queryFn: ({ signal }) => listFolders(browse, signal), enabled: open, retry: false });
  const choose = (path: string) => { onChange(path); setDraft(path); setOpen(false); };
  return <div className="folder-picker">
    <div className="field-heading"><label htmlFor={id}>PDF folder</label><span>Files must be named &lt;employeeCode&gt;.pdf</span></div>
    <div className="folder-input"><FolderOpen size={18}/><input id={id} value={draft} disabled={disabled} placeholder="C:\Users\Administrator\Downloads\mail-path"
      onChange={event => setDraft(event.target.value)} onBlur={() => draft.trim() !== value && onChange(draft.trim())}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); onChange(draft.trim()); } }}/>
      <button type="button" className="secondary" disabled={disabled} onClick={() => { setBrowse(draft.trim() || value); setOpen(true); }}>Browse…</button></div>
    {open && <div className="modal-backdrop" role="presentation" onClick={() => setOpen(false)}><section className="confirm-dialog folder-dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} onClick={event => event.stopPropagation()}>
      <button type="button" className="icon-button dialog-close" aria-label="Close" onClick={() => setOpen(false)}><X size={18}/></button>
      <h2 id={`${id}-title`}>Choose the PDF folder</h2>
      <div className="folder-current"><span>{listing.data?.path || 'This server'}</span>{!!listing.data?.path && <small><FileText size={12}/>{listing.data.pdfCount} PDF files here</small>}</div>
      <div className="folder-list">
        {browse && <button type="button" className="folder-row" onClick={() => setBrowse(listing.data?.parent ?? '')}><ArrowUp size={16}/><span>{listing.data?.parent ? 'Up one level' : 'Drives and shortcuts'}</span></button>}
        {listing.isFetching && <p className="hint"><LoaderCircle className="spin" size={14}/> Loading…</p>}
        {listing.isError && <p className="banner error" role="alert">{listing.error.message}</p>}
        {listing.data?.folders.map(folder => <button type="button" className="folder-row" key={folder.path} onClick={() => setBrowse(folder.path)}>
          {browse ? <Folder size={16}/> : <HardDrive size={16}/>}<span>{folder.name}</span>{folder.pdfCount > 0 && <small>{folder.pdfCount} PDF</small>}</button>)}
        {listing.data && !listing.data.folders.length && <p className="hint">No subfolders.</p>}
      </div>
      <div><button type="button" className="secondary" onClick={() => setOpen(false)}>Cancel</button>
        <button type="button" className="primary" disabled={!listing.data?.path} onClick={() => listing.data && choose(listing.data.path)}><Check size={16}/>Use this folder</button></div>
    </section></div>}
  </div>;
}
