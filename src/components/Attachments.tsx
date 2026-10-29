import { useRef, useState } from 'react';
import { FileText, Paperclip, UploadCloud, X } from 'lucide-react';
import { accept, addFiles, fileId, size } from '../utils/mail';
import type { Config } from '../types';

export default function Attachments({ files, onChange, limits, disabled, onError }: { files: File[]; onChange: (files: File[]) => void; limits: Config['limits']; disabled: boolean; onError: (message: string) => void }) {
  const input = useRef<HTMLInputElement>(null); const [dragging, setDragging] = useState(false);
  const add = (incoming: File[]) => { try { onChange(addFiles(files, incoming, limits)); } catch (e) { onError((e as Error).message); } };
  const total = files.reduce((sum, file) => sum + file.size, 0);
  return <section className="attachments-section" aria-label="Attendance attachments">
    <div className="field-heading"><label htmlFor="attachment-input">Attendance & attachments</label><span>Optional</span></div>
    <div className={`dropzone ${dragging ? 'dragging' : ''}`} onDragOver={e => { e.preventDefault(); if (!disabled) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); if (!disabled) add(Array.from(e.dataTransfer.files)); }}>
      <span className="upload-icon"><UploadCloud size={23}/></span><div><p>Drag your documents here, or <button type="button" disabled={disabled} onClick={() => input.current?.click()}>browse files</button></p><span>PDF, Word, Excel, CSV, TXT, JPG and PNG</span></div>
      <input id="attachment-input" className="sr-only" ref={input} type="file" multiple accept={accept} disabled={disabled} onChange={e => { add(Array.from(e.target.files || [])); e.target.value = ''; }}/>
    </div>
    <p className="hint">Up to {limits.files} files · {size(limits.fileBytes)} per file · {size(limits.totalBytes)} total</p>
    {files.length > 0 && <div className="file-list">{files.map(file => <div className="file-row" key={fileId(file)}><span className={`file-icon ${file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : ''}`}><FileText size={20}/></span><span className="file-details"><strong>{file.name}</strong><span>{file.name.split('.').pop()?.toUpperCase()} document · {size(file.size)}</span></span><button type="button" className="icon-button" disabled={disabled} aria-label={`Remove ${file.name}`} onClick={() => onChange(files.filter(f => fileId(f) !== fileId(file)))}><X size={17}/></button></div>)}</div>}
    <div className="attachment-summary"><span><Paperclip size={14}/>{files.length} {files.length === 1 ? 'attachment' : 'attachments'}</span><span>{size(total)} <span className="muted">/ {size(limits.totalBytes)}</span></span></div>
  </section>;
}
