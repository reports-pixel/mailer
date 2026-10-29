import { useRef, useState } from 'react';
import { FolderOpen, LoaderCircle } from 'lucide-react';

/** A folder chosen on the user's own computer: its PDF files by lower-case name. Nothing is uploaded when choosing. */
export type PickedFolder = { name: string; files: Map<string, File>; pickedAt: number };

type DirectoryHandle = { name: string; values(): AsyncIterable<{ kind: string; name: string; getFile(): Promise<File> }> };
const picker = (window as unknown as { showDirectoryPicker?: (options?: object) => Promise<DirectoryHandle> }).showDirectoryPicker;

/** Opens the computer's folder dialog (Chrome/Edge folder picker, or a folder upload input in other browsers). */
export default function LocalFolderPicker({ value, onChange, disabled }: { value: PickedFolder | null; onChange: (folder: PickedFolder) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false); const [error, setError] = useState('');
  const choose = async () => {
    setError('');
    if (!picker) { input.current?.click(); return; }
    try {
      const handle = await picker({ id: 'kg-pdf-folder', mode: 'read' });
      setReading(true);
      const files = new Map<string, File>();
      for await (const entry of handle.values())
        if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.pdf')) files.set(entry.name.toLowerCase(), await entry.getFile());
      onChange({ name: handle.name, files, pickedAt: Date.now() });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setError('The folder could not be read. Choose it again.');
    } finally { setReading(false); }
  };
  const fromInput = (list: FileList | null) => {
    if (!list?.length) return;
    // Only PDFs directly inside the chosen folder, not in subfolders.
    const files = new Map<string, File>();
    let name = '';
    for (const file of Array.from(list)) {
      const parts = (file.webkitRelativePath || file.name).split('/');
      name ||= parts[0];
      if (parts.length === 2 && file.name.toLowerCase().endsWith('.pdf')) files.set(file.name.toLowerCase(), file);
    }
    onChange({ name, files, pickedAt: Date.now() });
  };
  return <div className="local-folder">
    <button type="button" className="folder-choose" disabled={disabled || reading} onClick={choose}>
      {reading ? <LoaderCircle className="spin" size={18}/> : <FolderOpen size={18}/>}
      <span>{value ? <><strong>{value.name}</strong><small>{value.files.size} PDF {value.files.size === 1 ? 'file' : 'files'} found · click to choose another folder</small></>
        : <><strong>Choose folder…</strong><small>Opens your computer's folder picker</small></>}</span>
    </button>
    <input ref={input} type="file" className="sr-only" tabIndex={-1} aria-hidden="true" {...{ webkitdirectory: '', directory: '' }} multiple onChange={event => { fromInput(event.target.files); event.target.value = ''; }}/>
    <p className="hint">Files must be named &lt;userCode&gt;.pdf, for example FP10001.pdf. Only each user's own PDF is uploaded, when you send.</p>
    {error && <p className="field-error">{error}</p>}
  </div>;
}
