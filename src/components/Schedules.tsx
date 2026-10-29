import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, ChevronLeft, ChevronRight, Clock3, Info, LoaderCircle, Pause, Pencil, Play, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react';
import { deleteSchedule, resolveEmployeeCodes, saveSchedule, scheduleRuns, schedules } from '../api';
import { ccValid, employeeMessageTemplate, employeeSubjectTemplate } from '../utils/mail';
import type { Employee, Schedule, ScheduleInput, Config } from '../types';
import RecipientPicker from './RecipientPicker';
import BulkRecipients from './BulkRecipients';
import CcInput from './CcInput';
import FolderPicker, { rememberedFolder } from './FolderPicker';

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const dayLabel = (day: string) => day.slice(0, 1) + day.slice(1).toLowerCase();
const runLabel: Record<string, string> = { SMTP_ACCEPTED: 'SMTP accepted', SKIPPED_UNCHANGED: 'Skipped · unchanged', SENDING: 'Sending…', UNKNOWN: 'Acceptance uncertain',
  FAILED: 'Not sent', NOT_SENT: 'Not sent', MISSING: 'PDF missing', INVALID: 'Invalid PDF', UNAVAILABLE: 'Unavailable' };
type Fields = { name: string; cc: string; subject: string; message: string };

function Runs({ schedule }: { schedule: Schedule }) {
  const [page, setPage] = useState(1);
  const runs = useQuery({ queryKey: ['schedule-runs', schedule.id, page], queryFn: ({ signal }) => scheduleRuns(schedule.id, page, signal), refetchInterval: 30000 });
  return <div className="schedule-runs"><div className="field-heading"><label>Recent runs</label><button type="button" className="bulk-toggle" onClick={() => runs.refetch()}><RefreshCw size={13}/>Refresh</button></div>
    {runs.isPending && <div className="skeleton-list"><i/><i/></div>}
    {runs.isError && <p className="banner error" role="alert">{runs.error.message}</p>}
    {runs.data?.data.length === 0 && <p className="hint">No runs yet. The first run happens at {schedule.nextRun || 'the next scheduled time'}.</p>}
    {!!runs.data?.data.length && <div className="run-list">{runs.data.data.map(run => <div className="run-row" key={run.slot + run.employeeCode}>
      <span className="run-slot">{run.slot}</span><strong>{run.employeeCode}</strong><span className="run-file">{run.fileName}</span>
      <span className={`status ${run.status === 'SMTP_ACCEPTED' ? 'accepted' : 'uncertain'}`}>{runLabel[run.status] || run.status}</span><p>{run.detail}</p></div>)}</div>}
    {(page > 1 || runs.data?.hasMore) && <div className="history-pagination"><button className="secondary" disabled={page === 1} onClick={() => setPage(p => p - 1)}><ChevronLeft size={15}/>Newer</button><span>Page {page}</span><button className="secondary" disabled={!runs.data?.hasMore} onClick={() => setPage(p => p + 1)}>Older<ChevronRight size={15}/></button></div>}
  </div>;
}

function Editor({ profile, schedule, initial, onDone }: { profile: Config; schedule?: Schedule; initial: Employee[]; onDone: () => void }) {
  const client = useQueryClient();
  const { register, handleSubmit, control, formState: { errors, isSubmitting } } = useForm<Fields>({ defaultValues: schedule
    ? { name: schedule.name, cc: schedule.cc, subject: schedule.subject, message: schedule.message }
    : { name: 'Daily attendance PDFs', cc: profile.defaultCc, subject: employeeSubjectTemplate + ' {date}', message: employeeMessageTemplate } });
  const [recipients, setRecipients] = useState<Employee[]>(initial);
  const [times, setTimes] = useState<string[]>(schedule?.times || ['09:00']);
  const [days, setDays] = useState<string[]>(schedule?.days || DAYS.slice(0, 6));
  const [enabled, setEnabled] = useState(schedule?.enabled ?? true);
  const [skipUnchanged, setSkipUnchanged] = useState(schedule?.skipUnchanged ?? false);
  const [folder, setFolder] = useState(schedule?.folder || rememberedFolder(profile.pdfFolder));
  const [failure, setFailure] = useState('');
  const submit = async (values: Fields) => {
    setFailure('');
    if (!recipients.length) { setFailure('Choose at least one employee.'); return; }
    const cleanTimes = [...new Set(times.filter(Boolean))].sort();
    if (!cleanTimes.length) { setFailure('Add at least one send time.'); return; }
    if (!days.length) { setFailure('Choose at least one day.'); return; }
    const input: ScheduleInput = { ...values, employeeCodes: recipients.map(e => e.employeeCode), times: cleanTimes, days, folder, enabled, skipUnchanged };
    try { await saveSchedule(input, schedule?.id); await client.invalidateQueries({ queryKey: ['schedules'] }); onDone(); }
    catch (e) { setFailure(e instanceof Error ? e.message : 'The schedule could not be saved.'); }
  };
  return <form className="schedule-editor" onSubmit={handleSubmit(submit)}>
    <div className="composer-heading"><div className="composer-title"><span className="section-icon"><CalendarClock size={21}/></span><div><h2>{schedule ? 'Edit schedule' : 'New daily schedule'}</h2><p>The server sends each employee their own PDF at every time you add.</p></div></div><button type="button" className="icon-button" aria-label="Close editor" onClick={onDone}><X size={18}/></button></div>
    {failure && <p className="banner error" role="alert"><Info size={17}/>{failure}</p>}
    <div className="compose-fields">
      <div><label htmlFor="schedule-name">Schedule name <span className="required">*</span></label><input id="schedule-name" maxLength={100} {...register('name', { validate: v => !!v.trim() || 'Enter a name.' })}/>{errors.name && <p className="field-error">{errors.name.message}</p>}</div>
      <RecipientPicker value={recipients} onChange={setRecipients} limit={profile.limits.recipients} disabled={isSubmitting}/>
      <BulkRecipients value={recipients} onChange={setRecipients} limit={profile.limits.recipients} disabled={isSubmitting}/>
      <div><div className="field-heading"><label>Send times (24-hour)</label><span>Add as many times per day as you need</span></div>
        <div className="schedule-times">{times.map((time, index) => <span className="time-chip" key={index}><Clock3 size={14}/><input type="time" aria-label={`Send time ${index + 1}`} value={time} required onChange={event => setTimes(times.map((t, i) => i === index ? event.target.value : t))}/>{times.length > 1 && <button type="button" className="icon-button" aria-label={`Remove ${time}`} onClick={() => setTimes(times.filter((_, i) => i !== index))}><X size={13}/></button>}</span>)}
          {times.length < 24 && <button type="button" className="secondary add-time" onClick={() => setTimes([...times, ''])}><Plus size={14}/>Add time</button>}</div></div>
      <div><label>Days</label><div className="day-picker" role="group" aria-label="Days">{DAYS.map(day => <button type="button" key={day} aria-pressed={days.includes(day)} className={days.includes(day) ? 'active' : ''} onClick={() => setDays(days.includes(day) ? days.filter(d => d !== day) : DAYS.filter(d => d === day || days.includes(d)))}>{dayLabel(day)}</button>)}</div></div>
      <FolderPicker id="schedule-folder" value={folder} disabled={isSubmitting} onChange={setFolder}/>
      <div className="cc-field"><div className="field-heading"><label htmlFor="schedule-cc">CC</label><span>Copied on every individual email</span></div><Controller control={control} name="cc" rules={{ validate: v => ccValid(v) || 'Enter valid CC addresses.' }} render={({ field }) => <CcInput id="schedule-cc" value={field.value} onChange={field.onChange} disabled={isSubmitting}/>}/>{errors.cc && <p className="field-error">{errors.cc.message}</p>}</div>
      <div className="subject-field"><label htmlFor="schedule-subject">Subject template <span className="required">*</span></label><input id="schedule-subject" maxLength={200} {...register('subject', { validate: v => !!v.trim() || 'Enter a subject.', pattern: { value: /^[^\r\n]*$/, message: 'Remove line breaks.' } })}/>{errors.subject && <p className="field-error">{errors.subject.message}</p>}<p className="hint">{'{employeeCode}'}, {'{employeeName}'} and {'{date}'} (today, DD-MM-YYYY) are filled in for each email.</p></div>
      <div className="message-field"><label htmlFor="schedule-message">Message template <span className="required">*</span></label><textarea id="schedule-message" maxLength={50000} {...register('message', { validate: v => !!v.trim() || 'Enter a message.' })}/>{errors.message && <p className="field-error">{errors.message.message}</p>}</div>
      <label className="check-row"><input type="checkbox" checked={skipUnchanged} onChange={e => setSkipUnchanged(e.target.checked)}/><span><strong>Skip unchanged PDFs</strong><small>Don't send an employee the same PDF again if the file hasn't been updated since this schedule last sent it.</small></span></label>
      <label className="check-row"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)}/><span><strong>Schedule active</strong><small>Turn off to pause sending without deleting the schedule.</small></span></label>
    </div>
    <div className="composer-actions"><span className="privacy-note"><Info size={15}/>The portal service must be running with sending on at the send times.</span><div><button type="button" className="secondary" onClick={onDone}>Cancel</button><button className="primary" disabled={isSubmitting}>{isSubmitting ? <LoaderCircle className="spin" size={16}/> : <Save size={16}/>}Save schedule</button></div></div>
  </form>;
}

export default function Schedules({ profile }: { profile: Config }) {
  const client = useQueryClient();
  const list = useQuery({ queryKey: ['schedules'], queryFn: ({ signal }) => schedules(signal), refetchInterval: 60000 });
  const [editing, setEditing] = useState<{ schedule?: Schedule; initial: Employee[] } | null>(null);
  const [open, setOpen] = useState<string | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState('');
  const act = async (id: string, action: () => Promise<unknown>) => {
    setBusy(id); setError('');
    try { await action(); await client.invalidateQueries({ queryKey: ['schedules'] }); }
    catch (e) { setError(e instanceof Error ? e.message : 'The schedule could not be updated.'); }
    finally { setBusy(''); }
  };
  const edit = (schedule: Schedule) => act(schedule.id, async () => {
    const found = await resolveEmployeeCodes(schedule.employeeCodes);
    setEditing({ schedule, initial: found.data });
    if (found.issues.length) setError(found.issues.join(' '));
  });
  const toggle = (s: Schedule) => act(s.id, () => saveSchedule({ name: s.name, employeeCodes: s.employeeCodes, times: s.times, days: s.days, cc: s.cc, subject: s.subject, message: s.message, folder: s.folder, skipUnchanged: s.skipUnchanged, enabled: !s.enabled }, s.id));
  if (editing) return <section className="composer"><Editor profile={profile} schedule={editing.schedule} initial={editing.initial} onDone={() => setEditing(null)}/></section>;
  return <section className="composer schedules-panel"><div className="composer-heading"><div className="composer-title"><span className="section-icon"><CalendarClock size={21}/></span><div><h2>Daily schedules</h2><p>Send every employee their PDF automatically, once or several times a day.</p></div></div><button className="primary" type="button" onClick={() => setEditing({ initial: [] })}><Plus size={16}/>New schedule</button></div>
    {!profile.mailEnabled && <div className="banner info"><Info size={17}/><span>Schedules that come due while sending is unavailable are recorded as not sent, with the reason. Current reason: {profile.mailStatus.detail}</span></div>}
    {error && <p className="banner error" role="alert">{error}</p>}
    {list.isPending && <div className="skeleton-list"><i/><i/><i/></div>}
    {list.isError && <p className="banner error" role="alert">{list.error.message}</p>}
    {list.data?.data.length === 0 && <div className="empty-state"><CalendarClock size={32}/><h3>No schedules yet</h3><p>Create one to send the daily PDFs automatically at fixed times.</p></div>}
    <div className="schedule-list">{list.data?.data.map(s => <article className={`schedule-card ${s.enabled ? '' : 'paused'}`} key={s.id}>
      <div className="schedule-card-head"><div><strong>{s.name}</strong><span className={`status ${s.enabled ? 'accepted' : 'uncertain'}`}>{s.enabled ? 'Active' : 'Paused'}</span></div>
        <div className="schedule-actions"><button type="button" className="icon-button" aria-label={s.enabled ? 'Pause' : 'Resume'} disabled={!!busy} onClick={() => toggle(s)}>{s.enabled ? <Pause size={16}/> : <Play size={16}/>}</button><button type="button" className="icon-button" aria-label="Edit" disabled={!!busy} onClick={() => edit(s)}>{busy === s.id ? <LoaderCircle className="spin" size={16}/> : <Pencil size={16}/>}</button><button type="button" className="icon-button" aria-label="Delete" disabled={!!busy} onClick={() => { if (window.confirm(`Delete "${s.name}" and its run log?`)) void act(s.id, () => deleteSchedule(s.id)); }}><Trash2 size={16}/></button></div></div>
      <div className="schedule-meta"><span className="schedule-times">{s.times.map(t => <span className="time-pill" key={t}><Clock3 size={12}/>{t}</span>)}</span><span>{s.days.length === 7 ? 'Every day' : s.days.map(dayLabel).join(', ')}</span><span>{s.employeeCodes.length} employees</span><span className="schedule-folder">{s.folder || profile.pdfFolder}</span><span>{s.nextRun ? <>Next: <strong>{s.nextRun}</strong></> : 'No upcoming run'}</span></div>
      <p className="hint">{s.employeeCodes.join(', ')}</p>
      <button type="button" className="bulk-toggle" onClick={() => setOpen(open === s.id ? null : s.id)}>{open === s.id ? 'Hide runs' : 'Show runs'}</button>
      {open === s.id && <Runs schedule={s}/>}
    </article>)}</div>
    {list.data && <p className="hint history-note">Times use the server's time zone ({list.data.zone}). A run more than 30 minutes late (for example, after downtime) is skipped rather than sent late. Each employee gets a separate email with only their own PDF.</p>}
  </section>;
}
