import { useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, ChevronLeft, ChevronRight, Copy, FileHeart, GraduationCap, HeartPulse, Pencil, Plus, Trash2, Undo2 } from 'lucide-react';
import useApi from '../hooks/useApi';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { Button, Card, ConfirmModal, EmptyState, ErrorNote, Field, Modal, NoMatches, PageHeader, Spinner } from '../components/ui';
import { addDays, formatTime, isoDate, matches, startOfWeek } from '../lib/format';
import RecordAccess from '../components/schedules/RecordAccess';

const dayLabel = (d) => d.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' });
let rowSeq = 0;
const blankRow = (date) => ({ key: `new-${(rowSeq += 1)}`, schedule_id: null, user_id: '', shift_date: date, start_time: '07:00', end_time: '15:00', ends_next_day: false, area_id: '', note: '' });
const toRow = (s) => ({ key: String(s.schedule_id), schedule_id: s.schedule_id, user_id: String(s.user_id), shift_date: s.shift_date, start_time: s.start_time.slice(0, 5),
  end_time: s.end_time.slice(0, 5), ends_next_day: s.ends_next_day, area_id: s.area_id ? String(s.area_id) : '', note: s.note || '' });
const payload = (r) => ({ ...r, user_id: Number(r.user_id) || null, area_id: Number(r.area_id) || null });

/** Warnings from the server (overlap, very long shift), confirmed with a second click. */
function Warnings({ warnings }) {
  if (!warnings?.length) return null;
  return (
    <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
      <p className="flex items-center gap-1.5 font-medium"><AlertTriangle className="h-4 w-4" aria-hidden /> Check before saving</p>
      <ul className="list-disc pl-5 text-xs">{warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul>
    </div>
  );
}

/** Staff, date, times, "ends the next day", area and note for one shift. */
function RowFields({ row, onChange, staff, areas, error, compact }) {
  const set = (k) => (e) => onChange({ ...row, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  return (
    <div className={`grid gap-2 ${compact ? 'sm:grid-cols-3 lg:grid-cols-[1.4fr_0.8fr_0.8fr_auto_1.1fr_1.2fr]' : 'sm:grid-cols-2'} ${error ? 'rounded-lg bg-red-50 p-2 ring-1 ring-red-300' : ''}`}>
      <Field label="Staff member"><select className="input" value={row.user_id} onChange={set('user_id')}><option value="">Select</option>{staff.map((p) => <option key={p.user_id} value={p.user_id}>{p.full_name}</option>)}</select></Field>
      {!compact && <Field label="Date"><input className="input" type="date" value={row.shift_date} onChange={set('shift_date')} /></Field>}
      <Field label="Start"><input className="input" type="time" value={row.start_time} onChange={set('start_time')} /></Field>
      <Field label="End"><input className="input" type="time" value={row.end_time} onChange={set('end_time')} /></Field>
      <label className="flex items-end gap-1.5 pb-2 text-xs"><input type="checkbox" className="h-4 w-4 accent-brand" checked={row.ends_next_day} onChange={set('ends_next_day')} /> Ends the next day</label>
      <Field label="Area"><select className="input" value={row.area_id} onChange={set('area_id')}><option value="">Select</option>{areas.map((a) => <option key={a.area_id} value={a.area_id}>{a.name}</option>)}</select></Field>
      <Field label="Note (optional)"><input className="input" maxLength={300} value={row.note} onChange={set('note')} /></Field>
      {error && <p className="text-xs text-red-700 sm:col-span-full" role="alert">{error}</p>}
    </div>
  );
}

/** Pencil: edit one shift. */
function ShiftModal({ shift, staff, areas, onClose, onSaved }) {
  const [row, setRow] = useState(shift);
  const [error, setError] = useState(null);
  const [warnings, setWarnings] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async (confirm = false) => {
    setBusy(true); setError(null);
    try {
      const body = { ...payload(row), confirm };
      if (row.schedule_id) await api(`/schedules/${row.schedule_id}`, { method: 'PUT', body }); else await api('/schedules', { method: 'POST', body });
      onSaved('Shift saved.');
    } catch (err) { if (err.details?.needs_confirm) setWarnings(err.details.warnings); else setError(err); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={row.schedule_id ? 'Edit shift' : 'Add shift'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button>
        {warnings ? <Button loading={busy} onClick={() => save(true)}>Save anyway</Button> : <Button loading={busy} onClick={() => save(false)}>Save shift</Button>}</>}>
      <div className="space-y-3"><ErrorNote error={error} /><Warnings warnings={warnings} /><RowFields row={row} onChange={(r) => { setRow(r); setWarnings(null); }} staff={staff} areas={areas} /></div>
    </Modal>
  );
}

/**
 * Edit day: every shift of the day as rows. Change, add or remove rows, or apply the same time and area
 * to all, then Save day once (one transaction). Invalid rows are highlighted and nothing is saved.
 */
function DayEditor({ date, shifts, staff, areas, onClose, onSaved, onCopy }) {
  const initial = useMemo(() => (shifts.length ? shifts.map(toRow) : [blankRow(date)]), [shifts, date]);
  const [rows, setRows] = useState(initial);
  const [removed, setRemoved] = useState([]);
  const [rowErrors, setRowErrors] = useState({});
  const [warnings, setWarnings] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [same, setSame] = useState({ start_time: '07:00', end_time: '15:00', ends_next_day: false, area_id: '' });
  const dirty = removed.length > 0 || JSON.stringify(rows) !== JSON.stringify(initial);
  const close = () => { if (!dirty || window.confirm('Discard your unsaved changes to this day?')) onClose(); };
  const update = (i, r) => { setRows((x) => x.map((y, j) => (j === i ? r : y))); setWarnings(null); setRowErrors((e) => ({ ...e, [i]: undefined })); };
  const remove = (i) => { const r = rows[i]; if (r.schedule_id) setRemoved((x) => [...x, r.schedule_id]); setRows((x) => x.filter((_, j) => j !== i)); setRowErrors({}); setWarnings(null); };
  const save = async (confirm = false) => {
    setBusy(true); setError(null); setRowErrors({});
    try {
      const res = await api(`/schedules/day/${date}`, { method: 'PUT', body: { rows: rows.map(payload), removed, confirm } });
      onSaved(`Day saved: ${res.data.added} added, ${res.data.changed} changed, ${res.data.removed} removed.`);
    } catch (err) {
      if (err.details?.row_errors) setRowErrors(err.details.row_errors);
      if (err.details?.needs_confirm) setWarnings(err.details.warnings); else setError(err);
    } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={close} size="xl" title={`Edit day: ${dayLabel(new Date(`${date}T00:00:00`))}`}
      footer={<>
        <Button variant="ghost" onClick={() => { if (!dirty || window.confirm('Discard your unsaved changes and copy the saved day?')) onCopy(date); }}><Copy className="h-4 w-4" /> Copy day to...</Button>
        <Button variant="secondary" disabled={!dirty} onClick={() => { setRows(initial); setRemoved([]); setRowErrors({}); setWarnings(null); }}>Discard changes</Button>
        {warnings ? <Button loading={busy} onClick={() => save(true)}>Save day anyway</Button> : <Button loading={busy} onClick={() => save(false)}>Save day</Button>}
      </>}>
      <div className="space-y-3">
        <ErrorNote error={error} />
        <Warnings warnings={warnings} />
        <fieldset className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3">
          <legend className="sr-only">Apply the same time and area to all shifts of this day</legend>
          <Field label="Start"><input className="input w-28" type="time" value={same.start_time} onChange={(e) => setSame({ ...same, start_time: e.target.value })} /></Field>
          <Field label="End"><input className="input w-28" type="time" value={same.end_time} onChange={(e) => setSame({ ...same, end_time: e.target.value })} /></Field>
          <label className="flex items-center gap-1.5 pb-2 text-xs"><input type="checkbox" className="h-4 w-4 accent-brand" checked={same.ends_next_day} onChange={(e) => setSame({ ...same, ends_next_day: e.target.checked })} /> Next day</label>
          <Field label="Area"><select className="input w-40" value={same.area_id} onChange={(e) => setSame({ ...same, area_id: e.target.value })}><option value="">Select</option>{areas.map((a) => <option key={a.area_id} value={a.area_id}>{a.name}</option>)}</select></Field>
          <Button size="sm" variant="secondary" disabled={!same.area_id || !rows.length} onClick={() => { setRows((x) => x.map((r) => ({ ...r, ...same }))); setWarnings(null); }}>Apply the same time and area to all shifts of this day</Button>
        </fieldset>
        {rows.map((r, i) => (
          <div key={r.key} className="flex items-start gap-2">
            <div className="flex-1"><RowFields compact row={r} onChange={(x) => update(i, x)} staff={staff} areas={areas} error={rowErrors[i]} /></div>
            <button type="button" className="mt-6 rounded p-1.5 text-red-600 hover:bg-red-50" aria-label={`Remove row ${i + 1}`} onClick={() => remove(i)}><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
        <Button size="sm" variant="secondary" onClick={() => setRows((x) => [...x, blankRow(date)])}><Plus className="h-4 w-4" /> Add row</Button>
      </div>
    </Modal>
  );
}

/** Preview of a bulk action, with conflicts highlighted. */
function PreviewList({ preview }) {
  if (!preview?.planned) return null;
  return (
    <div className="space-y-2">
      <p className="text-sm text-navy-900">{preview.create} to create · {preview.skip} skipped · {preview.replace} replaced</p>
      <ul className="max-h-60 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 text-xs">
        {preview.planned.map((p, i) => (
          <li key={i} className={`px-3 py-1.5 ${p.conflicts.length ? 'bg-amber-50' : ''}`}>
            {p.shift_date} · {p.name} · {formatTime(p.start_time)}–{formatTime(p.end_time)}{p.ends_next_day ? ' (+1 day)' : ''} · {p.area}
            {p.conflicts.length > 0 && <span className="block text-amber-800">Conflicts with: {p.conflicts.join('; ')}</span>}
          </li>
        ))}
      </ul>
      <Warnings warnings={preview.warnings} />
    </div>
  );
}

/** Shared runner for bulk add and copy: Preview, then apply (confirming warnings when needed). */
function useBatchRunner(endpoint, onDone) {
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async (body, apply) => {
    setBusy(true); setError(null);
    try {
      const res = await api(endpoint, { method: 'POST', body: { ...body, preview: !apply, confirm: apply && Boolean(preview?.needsConfirm) } });
      if (apply) onDone(res.data); else setPreview(res.data);
    } catch (err) {
      if (err.details?.needs_confirm) setPreview((p) => ({ ...p, warnings: err.details.warnings, needsConfirm: true })); else setError(err);
    } finally { setBusy(false); }
  };
  return { preview, setPreview, error, busy, run };
}

/** Add shift: several staff and several days at once (preview, then one undoable batch). */
function BulkAddModal({ days, staff, areas, initialDate, onClose, onDone }) {
  const [f, setF] = useState({ user_ids: [], dates: initialDate ? [initialDate] : [], start_time: '07:00', end_time: '15:00', ends_next_day: false, area_id: '', note: '', on_conflict: 'skip' });
  const r = useBatchRunner('/schedules/bulk', onDone);
  const toggle = (k, v) => { setF((x) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((y) => y !== v) : [...x[k], v] })); r.setPreview(null); };
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }); r.setPreview(null); };
  const body = { ...f, area_id: Number(f.area_id) || null };
  return (
    <Modal open onClose={onClose} size="lg" title="Add shift"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="secondary" loading={r.busy && !r.preview} onClick={() => r.run(body, false)}>Preview</Button>
        <Button disabled={!r.preview} loading={r.busy && Boolean(r.preview)} onClick={() => r.run(body, true)}>{r.preview?.needsConfirm ? 'Create anyway' : 'Create shifts'}</Button></>}>
      <div className="space-y-4">
        <ErrorNote error={r.error} />
        <fieldset><legend className="mb-1 text-sm font-medium text-navy-800">Staff (one or more)</legend>
          <div className="grid max-h-40 gap-1 overflow-y-auto rounded-lg border border-slate-200 p-2 sm:grid-cols-2">
            {staff.map((p) => <label key={p.user_id} className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand" checked={f.user_ids.includes(p.user_id)} onChange={() => toggle('user_ids', p.user_id)} /> {p.full_name}</label>)}
          </div>
        </fieldset>
        <fieldset><legend className="mb-1 text-sm font-medium text-navy-800">Days (one or more)</legend>
          <div className="flex flex-wrap gap-1.5">
            {days.map((d) => { const iso = isoDate(d); return (
              <button key={iso} type="button" aria-pressed={f.dates.includes(iso)} onClick={() => toggle('dates', iso)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${f.dates.includes(iso) ? 'bg-navy-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{dayLabel(d)}</button>); })}
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Start"><input className="input" type="time" value={f.start_time} onChange={set('start_time')} /></Field>
          <Field label="End"><input className="input" type="time" value={f.end_time} onChange={set('end_time')} /></Field>
          <label className="flex items-end gap-1.5 pb-2 text-xs"><input type="checkbox" className="h-4 w-4 accent-brand" checked={f.ends_next_day} onChange={set('ends_next_day')} /> Ends the next day</label>
          <Field label="Area"><select className="input" value={f.area_id} onChange={set('area_id')}><option value="">Select</option>{areas.map((a) => <option key={a.area_id} value={a.area_id}>{a.name}</option>)}</select></Field>
        </div>
        <Field label="Note (optional)"><input className="input" maxLength={300} value={f.note} onChange={set('note')} /></Field>
        <Field label="If someone already has a shift at that time">
          <select className="input" value={f.on_conflict} onChange={set('on_conflict')}><option value="skip">Skip it (keep the existing shift)</option><option value="replace">Replace the existing shift</option></select>
        </Field>
        <PreviewList preview={r.preview} />
      </div>
    </Modal>
  );
}

/** Copy a day to other days, or the week to next week (preview, Skip or Replace, then one undoable batch). */
function CopyModal({ mode, from, weekStart, days, onClose, onDone }) {
  const [toDates, setToDates] = useState([]);
  const [onConflict, setOnConflict] = useState('skip');
  const r = useBatchRunner('/schedules/copy', onDone);
  const body = { mode, from, to_dates: toDates, week_start: weekStart, on_conflict: onConflict };
  return (
    <Modal open onClose={onClose} size="lg" title={mode === 'day' ? `Copy ${dayLabel(new Date(`${from}T00:00:00`))} to...` : 'Copy this week to next week'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="secondary" loading={r.busy && !r.preview} disabled={mode === 'day' && !toDates.length} onClick={() => r.run(body, false)}>Preview</Button>
        <Button disabled={!r.preview} loading={r.busy && Boolean(r.preview)} onClick={() => r.run(body, true)}>{r.preview?.needsConfirm ? 'Copy anyway' : 'Copy'}</Button></>}>
      <div className="space-y-4">
        <ErrorNote error={r.error} />
        {mode === 'day' && (
          <fieldset><legend className="mb-1 text-sm font-medium text-navy-800">Copy to</legend>
            <div className="flex flex-wrap gap-1.5">
              {[...days, ...days.map((d) => addDays(d, 7))].map((d) => { const iso = isoDate(d); if (iso === from) return null; return (
                <button key={iso} type="button" aria-pressed={toDates.includes(iso)} onClick={() => { setToDates((x) => (x.includes(iso) ? x.filter((y) => y !== iso) : [...x, iso])); r.setPreview(null); }}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${toDates.includes(iso) ? 'bg-navy-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{dayLabel(d)}</button>); })}
            </div>
          </fieldset>
        )}
        <Field label="If someone already has a shift at that time">
          <select className="input" value={onConflict} onChange={(e) => { setOnConflict(e.target.value); r.setPreview(null); }}><option value="skip">Skip</option><option value="replace">Replace</option></select>
        </Field>
        <PreviewList preview={r.preview} />
      </div>
    </Modal>
  );
}

const AREA_ICONS = [['health', HeartPulse, 'Has assigned health records'], ['adoption', FileHeart, 'Has assigned adoption applications'], ['transition', GraduationCap, 'Has assigned transition reviews']];

function WeekView() {
  const { query, toast } = useApp();
  const [weekStart, setWeekStart] = useState(startOfWeek());
  const days = [...Array(7)].map((_, i) => addDays(weekStart, i));
  const from = isoDate(days[0]);
  const to = isoDate(days[6]);
  const { data, loading, error, reload } = useApi(`/schedules?from=${from}&to=${to}`);
  const staffApi = useApi('/users?role=Staff');
  const areasApi = useApi('/schedule-areas');
  const staff = (staffApi.data?.data || []).filter((u) => u.is_active && u.role === 'Staff');
  const areas = (areasApi.data?.data || []).filter((a) => a.is_active);
  const [single, setSingle] = useState(null);
  const [dayEdit, setDayEdit] = useState(null);
  const [bulk, setBulk] = useState(null);
  const [copy, setCopy] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [lastBatch, setLastBatch] = useState(null);
  const [busy, setBusy] = useState(false);
  const shifts = (data?.data || []).filter((s) => matches(query, s.full_name, s.area_label));

  const saved = (msg) => { setSingle(null); setDayEdit(null); toast(msg); reload(); };
  const batchDone = (res) => { setBulk(null); setCopy(null); toast(res.summary); setLastBatch(res.batch_id ? res : null); reload(); };
  const undo = async () => {
    setBusy(true);
    try { const res = await api(`/schedules/batches/${lastBatch.batch_id}/undo`, { method: 'POST' }); toast(`Undone: ${res.data.removed} removed, ${res.data.restored} restored.`); setLastBatch(null); reload(); }
    catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true);
    try { await api(`/schedules/${deleting.schedule_id}`, { method: 'DELETE' }); setDeleting(null); toast('Shift deleted.'); reload(); }
    catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" aria-label="Previous week" onClick={() => setWeekStart(addDays(weekStart, -7))}><ChevronLeft className="h-4 w-4" /></Button>
        <Button variant="secondary" size="sm" onClick={() => setWeekStart(startOfWeek())}>This week</Button>
        <Button variant="secondary" size="sm" aria-label="Next week" onClick={() => setWeekStart(addDays(weekStart, 7))}><ChevronRight className="h-4 w-4" /></Button>
        <span className="ml-2 text-sm font-medium text-navy-900">Week of {days[0].toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setCopy({ mode: 'week' })}><Copy className="h-4 w-4" /> Copy week to next week</Button>
          <Button onClick={() => setBulk({ date: null })}><Plus className="h-4 w-4" /> Add shift</Button>
        </div>
      </div>
      {lastBatch && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900" role="status">
          <span className="flex-1">{lastBatch.summary}</span>
          <Button size="sm" variant="secondary" loading={busy} onClick={undo}><Undo2 className="h-4 w-4" /> Undo</Button>
          <button type="button" className="text-xs underline" onClick={() => setLastBatch(null)}>Dismiss</button>
        </div>
      )}
      {error && <ErrorNote error={error} onRetry={reload} />}
      {query && data && shifts.length === 0 && <Card className="mb-4"><NoMatches /></Card>}
      {loading && !data ? <Spinner /> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
          {days.map((d) => {
            const date = isoDate(d);
            const list = shifts.filter((s) => s.shift_date === date);
            return (
              <Card key={date} className={`flex flex-col p-3 ${date === isoDate() ? 'ring-2 ring-brand' : ''}`}>
                <div className="mb-2 flex items-center justify-between gap-1">
                  <button type="button" className="text-left text-sm font-semibold text-navy-900 hover:text-brand" onClick={() => setDayEdit(date)} aria-label={`Edit day ${dayLabel(d)}`}>{dayLabel(d)}</button>
                  <div className="flex items-center">
                    <button type="button" className="rounded px-1.5 py-0.5 text-xs text-brand hover:bg-slate-100" onClick={() => setDayEdit(date)}>Edit day</button>
                    <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-brand" aria-label={`Add shift on ${date}`} onClick={() => setBulk({ date })}><Plus className="h-4 w-4" /></button>
                  </div>
                </div>
                {list.length === 0 ? <p className="text-xs text-slate-400">No shifts</p> : (
                  <ul className="space-y-2">
                    {list.map((s) => (
                      <li key={s.schedule_id} className="group rounded-lg bg-page p-2">
                        <p className="flex items-center gap-1 text-xs font-semibold text-navy-900">{s.full_name}
                          {s.assigned_areas && AREA_ICONS.filter(([k]) => s.assigned_areas[k]).map(([k, Icon, tip]) => (
                            <span key={k} title={tip} className="text-slate-400"><Icon className="h-3 w-3" aria-label={tip} /></span>
                          ))}
                        </p>
                        <p className="text-xs text-slate-500">{formatTime(s.start_time)}–{formatTime(s.end_time)}{s.ends_next_day ? ' (next day)' : ''}</p>
                        <p className="text-xs text-slate-600">{s.area_label}</p>
                        {s.note && <p className="text-[11px] text-slate-500">{s.note}</p>}
                        {(s.staff_inactive || s.not_staff || s.area_unmapped) && (
                          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-amber-700"><AlertTriangle className="h-3 w-3" aria-hidden />
                            {s.staff_inactive ? 'Account deactivated' : s.not_staff ? 'Not a Staff account' : 'Area not in the list'}</p>
                        )}
                        <div className="mt-1 flex gap-1 opacity-60 group-hover:opacity-100 focus-within:opacity-100">
                          <button type="button" className="rounded p-0.5 hover:bg-white" aria-label={`Edit ${s.full_name}'s shift`} onClick={() => setSingle(toRow(s))}><Pencil className="h-3 w-3" /></button>
                          <button type="button" className="rounded p-0.5 text-red-600 hover:bg-white" aria-label={`Delete ${s.full_name}'s shift`} onClick={() => setDeleting(s)}><Trash2 className="h-3 w-3" /></button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      )}
      {!loading && staff.length === 0 && staffApi.data && (
        <Card className="mt-4"><EmptyState icon={CalendarClock} title="No active staff accounts" description="Create Staff accounts under User accounts before assigning shifts." /></Card>
      )}
      {single && <ShiftModal shift={single} staff={staff} areas={areas} onClose={() => setSingle(null)} onSaved={saved} />}
      {dayEdit && <DayEditor date={dayEdit} shifts={(data?.data || []).filter((s) => s.shift_date === dayEdit)} staff={staff} areas={areas}
        onClose={() => setDayEdit(null)} onSaved={saved} onCopy={(dt) => { setDayEdit(null); setCopy({ mode: 'day', from: dt }); }} />}
      {bulk && <BulkAddModal days={days} staff={staff} areas={areas} initialDate={bulk.date} onClose={() => setBulk(null)} onDone={batchDone} />}
      {copy && <CopyModal mode={copy.mode} from={copy.from} weekStart={from} days={days} onClose={() => setCopy(null)} onDone={batchDone} />}
      <ConfirmModal open={Boolean(deleting)} onClose={() => setDeleting(null)} onConfirm={remove} loading={busy} title="Delete shift?" message={`${deleting?.full_name}'s shift will be removed.`} />
    </>
  );
}

/** Staff schedules (Admin): the week view, and the Record access overview. */
export default function Schedules() {
  const [tab, setTab] = useState('week');
  return (
    <>
      <PageHeader title="Staff schedules" description="Plan who is on duty each day, and see who is assigned to which records. Staff see their own shifts under My schedule." />
      <div className="mb-4 inline-flex gap-1 rounded-lg bg-white p-1 ring-1 ring-slate-200" role="tablist" aria-label="Staff schedules">
        {[['week', 'Week'], ['access', 'Record access']].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === k ? 'bg-navy-900 text-white' : 'text-slate-600 hover:text-navy-900'}`}>{l}</button>
        ))}
      </div>
      {tab === 'week' ? <WeekView /> : <RecordAccess />}
    </>
  );
}
