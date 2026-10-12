import { useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Moon, Pencil, Plus, Trash2, Undo2 } from 'lucide-react';
import useApi from '../hooks/useApi';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { Button, Card, ConfirmModal, EmptyState, ErrorNote, Field, Modal, NoMatches, PageHeader, Spinner } from '../components/ui';
import { addDays, formatTime, isoDate, matches, startOfWeek } from '../lib/format';

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

/** Add shift presets. Night ends the next day (detected from the times, not a checkbox). */
const SHIFT_PRESETS = [
  { key: 'morning', label: 'Morning', start: '07:00', end: '15:00' },
  { key: 'afternoon', label: 'Afternoon', start: '15:00', end: '23:00' },
  { key: 'night', label: 'Night', start: '23:00', end: '07:00' },
];
/** What happens when the person already has a shift at that time (the API's on_conflict values). */
const CONFLICT_OPTIONS = [
  { value: 'skip', label: 'Keep their existing shift', hint: 'This new shift is not created for that person and day.' },
  { value: 'replace', label: 'Replace it with this one', hint: 'The existing shift is removed (Undo brings it back).' },
  { value: 'keep_both', label: 'Keep both', hint: 'Both shifts stay; you confirm the overlap before saving.' },
];
const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const ring = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2';
const chip = (on) => `${ring} rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${on ? 'border-brand bg-brand text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-brand hover:bg-brand-soft'}`;
const linkBtn = `${ring} rounded px-1.5 py-0.5 text-xs font-medium text-brand hover:bg-brand-soft disabled:text-slate-300`;
const mins = (t) => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + m; };

function SectionTitle({ id, children, actions }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 id={id} className="text-xs font-semibold uppercase tracking-wide text-slate-500">{children}</h3>
      {actions && <div className="flex gap-1">{actions}</div>}
    </div>
  );
}

/** Add shift: several staff and several days at once (preview, then one undoable batch). */
function BulkAddModal({ days, staff, areas, initialDate, onClose, onDone }) {
  const [f, setF] = useState({ user_ids: [], dates: initialDate ? [initialDate] : [], start_time: '07:00', end_time: '15:00', area_id: '', note: '', on_conflict: 'skip' });
  const [preset, setPreset] = useState('morning');
  const [more, setMore] = useState(false);
  const r = useBatchRunner('/schedules/bulk', onDone);
  const change = (patch) => { setF((x) => ({ ...x, ...patch })); r.setPreview(null); };
  const toggle = (k, v) => change({ [k]: f[k].includes(v) ? f[k].filter((y) => y !== v) : [...f[k], v] });
  const isoDays = days.map((d) => isoDate(d));
  const weekdays = days.filter((d) => d.getDay() >= 1 && d.getDay() <= 5).map((d) => isoDate(d));

  // Overnight is detected: an end time at or before the start time ends the next day.
  const sameTime = f.start_time === f.end_time;
  const overnight = !sameTime && mins(f.end_time) <= mins(f.start_time);
  const area = areas.find((a) => String(a.area_id) === String(f.area_id));
  const missing = [!f.user_ids.length && 'staff', !f.dates.length && 'days', !area && 'area'].filter(Boolean);
  const timesOk = Boolean(f.start_time && f.end_time) && !sameTime;
  const ready = !missing.length && timesOk;
  const count = f.user_ids.length * f.dates.length;
  const toCreate = r.preview?.planned ? r.preview.create : count;
  const body = { user_ids: f.user_ids, dates: f.dates, start_time: f.start_time, end_time: f.end_time, ends_next_day: overnight,
    area_id: Number(f.area_id) || null, note: f.note, on_conflict: f.on_conflict };

  const months = [...new Set(days.map((d) => d.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })))].join(' – ');
  const summary = missing.length ? `Choose: ${missing.join(', ')}`
    : !timesOk ? 'Start and end times must differ'
      : `${count} shift${count === 1 ? '' : 's'} · ${formatTime(f.start_time)}–${formatTime(f.end_time)}${overnight ? ' (next day)' : ''} · ${area.name}`;

  const footer = (
    <>
      <p className={`mr-auto text-sm ${ready ? 'text-navy-900' : 'text-slate-500'}`} aria-live="polite">{summary}</p>
      <Button variant="secondary" className={ring} onClick={onClose}>Cancel</Button>
      <Button variant="secondary" className={ring} disabled={!ready} loading={r.busy && !r.preview} onClick={() => r.run(body, false)}>Preview</Button>
      <Button className={ring} disabled={!ready || (r.preview?.planned && toCreate === 0)} loading={r.busy && Boolean(r.preview)} onClick={() => r.run(body, true)}>
        {!ready ? 'Create' : r.preview?.needsConfirm ? `Create ${toCreate} anyway` : `Create ${toCreate}`}
      </Button>
    </>
  );

  return (
    <Modal open onClose={onClose} size="wide" title="Add shift" footer={footer} initialFocus="first">
      <div className="space-y-4">
        {r.error && <ErrorNote error={r.error} />}
        <div className="grid gap-5 md:grid-cols-2">
          {/* Left: who */}
          <section aria-labelledby="add-who">
            <SectionTitle id="add-who" actions={<>
              <button type="button" className={linkBtn} disabled={!staff.length || f.user_ids.length === staff.length} onClick={() => change({ user_ids: staff.map((p) => p.user_id) })}>Select all</button>
              <button type="button" className={linkBtn} disabled={!f.user_ids.length} onClick={() => change({ user_ids: [] })}>Clear</button>
            </>}>Who · {f.user_ids.length} selected</SectionTitle>
            {staff.length === 0 ? <p className="text-sm text-slate-500">No active Staff accounts. Create them under User accounts.</p> : (
              <ul className="space-y-1 md:max-h-[19rem] md:overflow-y-auto md:pr-1" aria-label="Staff">
                {staff.map((p) => {
                  const on = f.user_ids.includes(p.user_id);
                  return (
                    <li key={p.user_id}>
                      <button type="button" role="checkbox" aria-checked={on} onClick={() => toggle('user_ids', p.user_id)}
                        className={`${ring} flex w-full items-center gap-3 rounded-xl border px-3 py-1.5 text-left text-sm transition-colors ${on ? 'border-brand bg-brand-soft' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
                        <span aria-hidden className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${on ? 'bg-brand text-white' : 'bg-slate-100 text-slate-600'}`}>
                          {on ? <Check className="h-4 w-4" /> : initials(p.full_name)}
                        </span>
                        <span className={`min-w-0 truncate ${on ? 'font-medium text-navy-900' : 'text-slate-700'}`}>{p.full_name}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Right: days, shift, area */}
          <div className="space-y-4">
            <section aria-labelledby="add-days">
              <SectionTitle id="add-days" actions={<>
                <button type="button" className={linkBtn} disabled={!weekdays.length} onClick={() => change({ dates: weekdays })}>Mon–Fri</button>
                <button type="button" className={linkBtn} onClick={() => change({ dates: isoDays })}>All</button>
                <button type="button" className={linkBtn} disabled={!f.dates.length} onClick={() => change({ dates: [] })}>Clear</button>
              </>}>Days · {months}</SectionTitle>
              <div className="grid grid-cols-7 gap-1" role="group" aria-labelledby="add-days">
                {days.map((d) => {
                  const iso = isoDate(d);
                  const on = f.dates.includes(iso);
                  return (
                    <button key={iso} type="button" aria-pressed={on} aria-label={d.toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric' })} onClick={() => toggle('dates', iso)}
                      className={`${ring} flex flex-col items-center rounded-lg border py-1.5 text-xs transition-colors ${on ? 'border-brand bg-brand text-white' : 'border-slate-300 bg-white text-slate-600 hover:border-brand hover:bg-brand-soft'}`}>
                      <span className="font-medium">{d.toLocaleDateString('en-PH', { weekday: 'short' })}</span>
                      <span className={`text-base font-semibold leading-tight ${on ? 'text-white' : 'text-navy-900'}`}>{d.getDate()}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section aria-labelledby="add-shift">
              <SectionTitle id="add-shift">Shift</SectionTitle>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4" role="radiogroup" aria-labelledby="add-shift">
                {SHIFT_PRESETS.map((p) => (
                  <button key={p.key} type="button" role="radio" aria-checked={preset === p.key} className={chip(preset === p.key)}
                    onClick={() => { setPreset(p.key); change({ start_time: p.start, end_time: p.end }); }}>
                    <span className="block">{p.label}</span>
                    <span className={`block text-[11px] font-normal ${preset === p.key ? 'text-white/90' : 'text-slate-500'}`}>{p.start}–{p.end}</span>
                  </button>
                ))}
                <button type="button" role="radio" aria-checked={preset === 'custom'} className={chip(preset === 'custom')} onClick={() => setPreset('custom')}>
                  <span className="block">Custom</span><span className={`block text-[11px] font-normal ${preset === 'custom' ? 'text-white/90' : 'text-slate-500'}`}>Set times</span>
                </button>
              </div>
              {preset === 'custom' && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Field label="Start"><input className="input" type="time" value={f.start_time} onChange={(e) => change({ start_time: e.target.value })} /></Field>
                  <Field label="End"><input className="input" type="time" value={f.end_time} onChange={(e) => change({ end_time: e.target.value })} /></Field>
                </div>
              )}
              {overnight && <p className="mt-1.5 text-xs text-slate-600"><Moon className="mr-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden />Overnight: ends the next day.</p>}
              {sameTime && <p className="mt-1.5 text-xs text-red-700" role="alert">Start and end times can&apos;t be the same.</p>}
            </section>

            <section aria-labelledby="add-area">
              <SectionTitle id="add-area">Area</SectionTitle>
              {areas.length === 0 ? <p className="text-sm text-slate-500">No active areas. Add them in Settings → Schedule areas.</p> : (
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-labelledby="add-area">
                  {areas.map((a) => {
                    const on = String(a.area_id) === String(f.area_id);
                    return <button key={a.area_id} type="button" role="radio" aria-checked={on} className={chip(on)} onClick={() => change({ area_id: String(a.area_id) })}>{a.name}</button>;
                  })}
                </div>
              )}
            </section>
          </div>
        </div>

        {/* More options */}
        <div className="rounded-xl border border-slate-200">
          <button type="button" aria-expanded={more} aria-controls="add-more" onClick={() => setMore(!more)}
            className={`${ring} flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm font-medium text-navy-900 hover:bg-slate-50`}>
            <span>More options <span className="font-normal text-slate-500">· note, {CONFLICT_OPTIONS.find((o) => o.value === f.on_conflict).label.toLowerCase()}</span></span>
            <ChevronDown className={`h-4 w-4 transition-transform ${more ? 'rotate-180' : ''}`} aria-hidden />
          </button>
          {more && (
            <div id="add-more" className="grid gap-3 border-t border-slate-100 p-3 md:grid-cols-2">
              <Field label="Note (optional)"><input className="input" maxLength={300} value={f.note} onChange={(e) => change({ note: e.target.value })} /></Field>
              <fieldset>
                <legend className="mb-1 text-sm font-medium text-navy-800">If a staff member already has a shift at that time</legend>
                <div className="space-y-1">
                  {CONFLICT_OPTIONS.map((o) => (
                    <label key={o.value} className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1 text-sm hover:bg-slate-50">
                      <input type="radio" name="on_conflict" className="mt-0.5 h-4 w-4 accent-brand" checked={f.on_conflict === o.value} onChange={() => change({ on_conflict: o.value })} />
                      <span><span className="font-medium text-navy-900">{o.label}</span><span className="block text-xs text-slate-500">{o.hint}</span></span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          )}
        </div>

        {r.preview && !r.preview.planned && <Warnings warnings={r.preview.warnings} />}
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
                        <p className="text-xs font-semibold text-navy-900">{s.full_name}</p>
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

/** Staff schedules (Admin): the week view. */
export default function Schedules() {
  return (
    <>
      <PageHeader title="Staff schedules" description="Plan who is on duty each day. Staff see their own shifts under My schedule." />
      <WeekView />
    </>
  );
}
