import { useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import useApi from '../hooks/useApi';
import { api, qs } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { Button, Card, ConfirmModal, ErrorNote, Modal, NoMatches, PageHeader, Spinner } from '../components/ui';
import { addDays, isoDate, startOfWeek } from '../lib/format';

const TYPES = ['Breakfast', 'Lunch', 'Snack', 'Dinner'];
/** Tag chips offered in the form. Tags already used on this week's meals are added after these. */
const DEFAULT_TAGS = ['Regular', 'Vegetarian', 'No pork', 'Halal', 'Nut-free', 'Soft / pureed', 'Diabetic-friendly'];
const MAX_TAGS = 10; // the API accepts up to 10 tags of 30 characters each
const MAX_TAG_LENGTH = 30;

const ring = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2';
const chip = (on) => `${ring} rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${on ? 'border-brand bg-brand text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-brand hover:bg-brand-soft'}`;
const linkBtn = `${ring} rounded px-1.5 py-0.5 text-xs font-medium text-brand hover:bg-brand-soft disabled:text-slate-300`;
const splitTags = (s) => String(s || '').split(',').map((t) => t.trim()).filter(Boolean);
const dayName = (d) => d.toLocaleDateString('en-PH', { weekday: 'short' });
const longDay = (d) => d.toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Add or edit a meal. Adding: one or more days of the week being viewed, one request per day with the
 * existing payload (meal_type, menu_description, scheduled_date, dietary_tags as "A, B"). Editing: one day.
 */
function MealModal({ initial, days, knownTags, onClose, onSaved }) {
  const editing = Boolean(initial.meal_id);
  const [f, setF] = useState({
    meal_type: initial.meal_type || 'Breakfast',
    dates: initial.scheduled_date ? [initial.scheduled_date] : [],
    menu_description: initial.menu_description || '',
    tags: initial.dietary_tags ? splitTags(initial.dietary_tags) : ['Regular'],
  });
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const isoDays = days.map((d) => isoDate(d));
  const tagOptions = [...new Set([...DEFAULT_TAGS, ...knownTags, ...f.tags])];

  const set = (patch) => { setF((x) => ({ ...x, ...patch })); setError(null); };
  const toggleDay = (iso) => set({ dates: editing ? [iso] : f.dates.includes(iso) ? f.dates.filter((d) => d !== iso) : [...f.dates, iso].sort() });
  const toggleTag = (t) => set({ tags: f.tags.includes(t) ? f.tags.filter((x) => x !== t) : [...f.tags, t] });
  const addCustom = () => {
    const t = custom.replace(/,/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TAG_LENGTH);
    if (!t) return;
    const same = tagOptions.find((o) => o.toLowerCase() === t.toLowerCase()) || t;
    if (!f.tags.includes(same)) set({ tags: [...f.tags, same] });
    setCustom('');
  };

  const description = f.menu_description.trim();
  const missing = [!f.dates.length && 'day', !description && 'description', !f.tags.length && 'dietary tag'].filter(Boolean);
  const tooManyTags = f.tags.length > MAX_TAGS;
  const valid = !missing.length && !tooManyTags;
  const n = f.dates.length;
  const summary = missing.length ? `Still needed: ${missing.join(', ')}`
    : tooManyTags ? `Use up to ${MAX_TAGS} dietary tags`
      : `${editing ? '' : `${plural(n, 'meal')} · `}${f.meal_type} · ${description}`;

  const save = async () => {
    if (!valid || busy) return;
    setBusy(true); setError(null);
    const body = (date) => ({ meal_type: f.meal_type, menu_description: description, scheduled_date: date, dietary_tags: f.tags.join(', ') });
    try {
      if (editing) {
        await api(`/meals/${initial.meal_id}`, { method: 'PUT', body: body(f.dates[0]) });
        onSaved('Meal saved.');
        return;
      }
      // One request per day. Days that saved are taken off the selection, so trying again doesn't add them twice.
      const done = [];
      for (const date of f.dates) {
        try {
          await api('/meals', { method: 'POST', body: body(date) });
          done.push(date);
        } catch (err) {
          const day = days.find((d) => isoDate(d) === date);
          setF((x) => ({ ...x, dates: x.dates.filter((d) => !done.includes(d)) }));
          setError(new Error(`${done.length ? `${plural(done.length, 'meal')} saved. ` : ''}Could not save ${day ? longDay(day) : date}: ${err.message}${done.length ? ' The days not saved are still selected; try again.' : ''}`));
          if (done.length) onSaved(null, true);
          return;
        }
      }
      onSaved(`${plural(done.length, 'meal')} saved.`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const footer = (
    <>
      <p className={`mr-auto min-w-0 max-w-full truncate text-sm ${valid ? 'text-navy-900' : 'text-slate-500'}`} aria-live="polite">{summary}</p>
      <Button variant="secondary" className={ring} onClick={onClose}>Cancel</Button>
      <Button className={ring} disabled={!valid} loading={busy} onClick={save}>{editing ? 'Save meal' : n ? `Save ${plural(n, 'meal')}` : 'Save meals'}</Button>
    </>
  );

  return (
    <Modal open onClose={onClose} title={editing ? 'Edit meal' : 'Add meal'} footer={footer}>
      <form className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); save(); }}>
        {error && <ErrorNote error={error} />}

        <section aria-labelledby="meal-type">
          <h3 id="meal-type" className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Meal</h3>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4" role="radiogroup" aria-labelledby="meal-type">
            {TYPES.map((t) => <button key={t} type="button" role="radio" aria-checked={f.meal_type === t} className={chip(f.meal_type === t)} onClick={() => set({ meal_type: t })}>{t}</button>)}
          </div>
        </section>

        <section aria-labelledby="meal-days">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 id="meal-days" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {editing ? 'Day' : 'Days'} · {[...new Set(days.map((d) => d.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })))].join(' – ')}
            </h3>
            {!editing && (
              <div className="flex gap-1">
                <button type="button" className={linkBtn} disabled={f.dates.length === 7} onClick={() => set({ dates: isoDays })}>Every day</button>
                <button type="button" className={linkBtn} disabled={!f.dates.length} onClick={() => set({ dates: [] })}>Clear</button>
              </div>
            )}
          </div>
          <div className="grid grid-cols-7 gap-1" role={editing ? 'radiogroup' : 'group'} aria-labelledby="meal-days">
            {days.map((d) => {
              const iso = isoDate(d);
              const on = f.dates.includes(iso);
              const state = editing ? { role: 'radio', 'aria-checked': on } : { 'aria-pressed': on };
              return (
                <button key={iso} type="button" {...state} aria-label={longDay(d)} onClick={() => toggleDay(iso)}
                  className={`${ring} flex flex-col items-center rounded-lg border py-1.5 text-xs transition-colors ${on ? 'border-brand bg-brand text-white' : 'border-slate-300 bg-white text-slate-600 hover:border-brand hover:bg-brand-soft'}`}>
                  <span className="font-medium">{dayName(d)}</span>
                  <span className={`text-base font-semibold leading-tight ${on ? 'text-white' : 'text-navy-900'}`}>{d.getDate()}</span>
                </button>
              );
            })}
          </div>
        </section>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Description</span>
          <input className="input" maxLength={2000} value={f.menu_description} onChange={(e) => set({ menu_description: e.target.value })} placeholder="e.g. Arroz caldo with egg, banana" />
        </label>

        <section aria-labelledby="meal-tags">
          <h3 id="meal-tags" className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Dietary tags</h3>
          <div className="flex flex-wrap gap-1.5">
            {tagOptions.map((t) => <button key={t} type="button" aria-pressed={f.tags.includes(t)} className={chip(f.tags.includes(t))} onClick={() => toggleTag(t)}>{t}</button>)}
          </div>
          <div className="mt-2 flex gap-2">
            <input className="input h-9" maxLength={MAX_TAG_LENGTH} value={custom} placeholder="Add another tag..." aria-label="Add another tag"
              onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }} />
            <Button variant="secondary" size="sm" className={ring} disabled={!custom.trim()} onClick={addCustom}>Add</Button>
          </div>
          {tooManyTags && <p className="mt-1 text-xs text-red-600">Use up to {MAX_TAGS} dietary tags.</p>}
        </section>
        {/* Lets Enter in the description save the form. */}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}

/** One meal in the grid: description, tags as labels, and Edit / Delete (Delete for Admin only, as before). */
function MealCard({ meal, canDelete, onEdit, onDelete }) {
  const what = `${meal.meal_type}: ${meal.menu_description}`;
  return (
    <div className="mb-1 rounded-lg bg-white p-2 text-xs text-navy-900 shadow-card">
      <p className="whitespace-pre-line break-words">{meal.menu_description}</p>
      {meal.dietary_tags && (
        <div className="mt-1 flex flex-wrap gap-1">
          {splitTags(meal.dietary_tags).map((t) => <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">{t}</span>)}
        </div>
      )}
      <div className="mt-1.5 flex gap-3 border-t border-slate-100 pt-1">
        <button type="button" className={`${ring} rounded text-[11px] font-medium text-brand hover:underline`} onClick={onEdit} aria-label={`Edit ${what}`}>Edit</button>
        {canDelete && <button type="button" className={`${ring} rounded text-[11px] font-medium text-red-600 hover:underline`} onClick={onDelete} aria-label={`Delete ${what}`}>Delete</button>}
      </div>
    </div>
  );
}

export default function Meals() {
  const { user } = useAuth();
  const { query, toast } = useApp();
  const [weekStart, setWeekStart] = useState(startOfWeek());
  const days = [...Array(7)].map((_, i) => addDays(weekStart, i));
  const from = isoDate(days[0]);
  const to = isoDate(days[6]);
  const { data, loading, error, reload } = useApi(`/meals${qs({ from, to, q: query })}`);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const today = isoDate();
  const canDelete = user.role === 'Admin'; // unchanged: the API allows DELETE for Admin only

  const meals = data?.data || [];
  const knownTags = [...new Set(meals.flatMap((m) => splitTags(m.dietary_tags)))];
  const cell = (date, type) => meals.filter((m) => m.scheduled_date === date && m.meal_type === type);

  const saved = (msg, keepOpen = false) => {
    reload();
    if (keepOpen) return;
    setForm(null);
    if (msg) toast(msg);
  };

  const remove = async () => {
    setSaving(true);
    try { await api(`/meals/${deleting.meal_id}`, { method: 'DELETE' }); setDeleting(null); toast('Meal removed. It is kept in the archive.'); reload(); }
    catch (err) { toast(err.message, 'error'); } finally { setSaving(false); }
  };

  const label = `${days[0].toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })} – ${days[6].toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}`;

  return (
    <>
      <PageHeader title="Meals" description="Weekly meal plan for the home. Click an empty slot to add a meal for that day."
        actions={<Button onClick={() => setForm({ meal_type: 'Breakfast' })}><Plus className="h-4 w-4" /> Add meal</Button>} />

      <div className="mb-4 flex items-center gap-2">
        <Button variant="secondary" size="sm" aria-label="Previous week" onClick={() => setWeekStart(addDays(weekStart, -7))}><ChevronLeft className="h-4 w-4" /></Button>
        <Button variant="secondary" size="sm" onClick={() => setWeekStart(startOfWeek())}>This week</Button>
        <Button variant="secondary" size="sm" aria-label="Next week" onClick={() => setWeekStart(addDays(weekStart, 7))}><ChevronRight className="h-4 w-4" /></Button>
        <span className="ml-2 text-sm font-medium text-navy-900">{label}</span>
      </div>

      {error && <ErrorNote error={error} onRetry={reload} />}
      {query && data && meals.length === 0 && <Card className="mb-4"><NoMatches /></Card>}
      {loading && !data ? <Spinner /> : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[900px] table-fixed border-collapse">
            <thead>
              <tr>
                <th scope="col" className="w-24 border-b border-slate-100 p-3"><span className="sr-only">Meal</span></th>
                {days.map((d) => {
                  const key = isoDate(d);
                  return (
                    <th key={key} className={`border-b border-slate-100 p-3 text-left text-sm font-medium ${key === today ? 'text-brand' : 'text-navy-900'}`}>
                      {dayName(d)}
                      <span className="block text-xs font-normal text-slate-500">{d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}</span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {TYPES.map((type) => (
                <tr key={type}>
                  <th scope="row" className="border-b border-slate-100 p-3 text-left align-top text-xs font-semibold text-slate-500">{type}</th>
                  {days.map((d) => {
                    const date = isoDate(d);
                    const items = cell(date, type);
                    const add = () => setForm({ meal_type: type, scheduled_date: date });
                    return (
                      <td key={date} className={`border-b border-l border-slate-100 p-2 align-top ${date === today ? 'bg-brand-soft/60' : ''}`}>
                        {items.map((m) => <MealCard key={m.meal_id} meal={m} canDelete={canDelete} onEdit={() => setForm({ ...m })} onDelete={() => setDeleting(m)} />)}
                        {items.length === 0 ? (
                          <button type="button" aria-label={`Add ${type} on ${longDay(d)}`} onClick={add}
                            className={`${ring} h-12 w-full rounded-lg border border-dashed border-slate-200 text-xs text-slate-400 hover:border-brand hover:text-brand`}>Add</button>
                        ) : (
                          <button type="button" aria-label={`Add another ${type} on ${longDay(d)}`} onClick={add}
                            className={`${ring} w-full rounded py-0.5 text-[11px] text-slate-400 hover:text-brand`}>+ Add</button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {form && <MealModal initial={form} days={days} knownTags={knownTags} onClose={() => setForm(null)} onSaved={saved} />}
      <ConfirmModal open={Boolean(deleting)} onClose={() => setDeleting(null)} onConfirm={remove} loading={saving} title="Remove this meal?" confirmLabel="Yes, remove"
        message={deleting ? `${deleting.meal_type} on ${longDay(new Date(`${deleting.scheduled_date}T00:00:00`))}: ${deleting.menu_description}. It leaves the meal plan and is kept in the archive.` : ''} />
    </>
  );
}
