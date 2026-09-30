import { useState } from 'react';
import { Ban, ChevronLeft, ChevronRight, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import useApi from '../hooks/useApi';
import { api, qs } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { Button, Card, ConfirmModal, ErrorNote, Field, Modal, NoMatches, PageHeader, Spinner } from '../components/ui';
import { addDays, isoDate, startOfWeek } from '../lib/format';

const TYPES = ['Breakfast', 'Lunch', 'Snack', 'Dinner'];
const TAG_SUGGESTIONS = ['Regular', 'Vegetarian', 'Soft food', 'Low sugar', 'No nuts', 'Halal', 'Infant'];
const newMeal = (type, date) => ({ meal_type: type, menu_description: '', scheduled_date: date, dietary_tags: 'Regular' });

function validateMeal(f) {
  const e = {};
  if (!f.meal_type) e.meal_type = 'Meal type is required.';
  if (!f.scheduled_date) e.scheduled_date = 'Scheduled date is required.';
  if (!String(f.menu_description || '').trim()) e.menu_description = 'Description is required.';
  if (!String(f.dietary_tags || '').split(',').some((t) => t.trim())) e.dietary_tags = 'Add at least one dietary tag.';
  return e;
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
  const [fieldErrors, setFieldErrors] = useState({});
  const [toggling, setToggling] = useState(null);
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const today = isoDate();

  const meals = data?.data || [];
  const openForm = (value) => { setForm(value); setFormError(null); setFieldErrors({}); };
  const cell = (date, type) => meals.filter((m) => m.scheduled_date === date && m.meal_type === type);

  const submit = async (e) => {
    e.preventDefault();
    const v = validateMeal(form);
    setFieldErrors(v);
    if (Object.keys(v).length) return;
    setSaving(true); setFormError(null);
    try {
      const body = { meal_type: form.meal_type, menu_description: form.menu_description, scheduled_date: form.scheduled_date, dietary_tags: form.dietary_tags };
      if (form.meal_id) await api(`/meals/${form.meal_id}`, { method: 'PUT', body });
      else await api('/meals', { method: 'POST', body });
      await reload(); setForm(null); toast('Meal saved.');
    } catch (err) { setFormError(err); } finally { setSaving(false); }
  };

  const toggleActive = async () => {
    setSaving(true);
    try {
      await api(`/meals/${toggling.meal_id}/active`, { method: 'PUT', body: { is_active: !toggling.is_active } });
      await reload(); toast(toggling.is_active ? 'Meal removed from the plan.' : 'Meal restored.'); setToggling(null);
    } catch (err) { toast(err.message, 'error'); } finally { setSaving(false); }
  };

  const remove = async () => {
    setSaving(true);
    try { await api(`/meals/${deleting.meal_id}`, { method: 'DELETE' }); setDeleting(null); toast('Meal deleted.'); reload(); }
    catch (err) { toast(err.message, 'error'); } finally { setSaving(false); }
  };

  const label = `${days[0].toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })} – ${days[6].toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}`;

  return (
    <>
      <PageHeader title="Meals" description="Weekly meal plan for the home. Click an empty slot to add a meal."
        actions={<Button onClick={() => openForm(newMeal('Breakfast', today))}><Plus className="h-4 w-4" /> Add meal</Button>} />

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
                <th className="w-24 border-b border-slate-100 p-3" />
                {days.map((d) => {
                  const key = isoDate(d);
                  return (
                    <th key={key} className={`border-b border-slate-100 p-3 text-left text-sm font-medium ${key === today ? 'text-brand' : 'text-navy-900'}`}>
                      {d.toLocaleDateString('en-PH', { weekday: 'short' })}
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
                    return (
                      <td key={date} className={`border-b border-l border-slate-100 p-2 align-top ${date === today ? 'bg-brand-soft/60' : ''}`}>
                        {items.map((m) => (
                          <div key={m.meal_id} className={`group mb-1 rounded-lg p-2 text-xs shadow-card ${m.is_active ? 'bg-white text-navy-900' : 'bg-slate-50 text-slate-400'}`}>
                            <p className={`whitespace-pre-line ${m.is_active ? '' : 'line-through'}`}>{m.menu_description}</p>
                            {m.dietary_tags && <p className="mt-1 text-[11px] text-slate-500">{m.dietary_tags}</p>}
                            {!m.is_active && <p className="mt-0.5 text-[11px] font-medium">Removed</p>}
                            <div className="mt-1 flex gap-1 opacity-60 group-hover:opacity-100">
                              <button type="button" className="rounded p-0.5 hover:bg-slate-100" aria-label="Edit meal" onClick={() => openForm({ ...m })}><Pencil className="h-3 w-3" /></button>
                              <button type="button" className="rounded p-0.5 hover:bg-slate-100" aria-label={m.is_active ? 'Remove meal from plan' : 'Restore meal'} onClick={() => setToggling(m)}>
                                {m.is_active ? <Ban className="h-3 w-3" /> : <RotateCcw className="h-3 w-3" />}
                              </button>
                              {user.role === 'Admin' && <button type="button" className="rounded p-0.5 text-red-600 hover:bg-red-50" aria-label="Delete meal" onClick={() => setDeleting(m)}><Trash2 className="h-3 w-3" /></button>}
                            </div>
                          </div>
                        ))}
                        {items.length === 0 && (
                          <button type="button" className="h-12 w-full rounded-lg border border-dashed border-slate-200 text-xs text-slate-400 hover:border-brand hover:text-brand"
                            onClick={() => openForm(newMeal(type, date))}>
                            Add
                          </button>
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

      <Modal open={Boolean(form)} onClose={() => setForm(null)} title={form?.meal_id ? 'Edit meal' : 'Add meal'}
        footer={<><Button variant="secondary" onClick={() => setForm(null)}>Cancel</Button><Button type="submit" form="meal-form" loading={saving}>Save meal</Button></>}>
        {form && (
          <form id="meal-form" onSubmit={submit} noValidate className="space-y-4">
            <ErrorNote error={formError} />
            <div className="grid grid-cols-2 gap-4">
              <Field label="Scheduled date" error={fieldErrors.scheduled_date}><input className="input" type="date" value={form.scheduled_date} onChange={(e) => setForm({ ...form, scheduled_date: e.target.value })} /></Field>
              <Field label="Meal type" error={fieldErrors.meal_type}><select className="input" value={form.meal_type} onChange={(e) => setForm({ ...form, meal_type: e.target.value })}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
            </div>
            <Field label="Description" error={fieldErrors.menu_description}><textarea className="input" rows={3} maxLength={2000} value={form.menu_description} onChange={(e) => setForm({ ...form, menu_description: e.target.value })} placeholder="e.g. Arroz caldo with egg, banana" /></Field>
            <Field label="Dietary tags" hint="Separate with commas." error={fieldErrors.dietary_tags}>
              <input className="input" list="diet-tags" value={form.dietary_tags || ''} onChange={(e) => setForm({ ...form, dietary_tags: e.target.value })} placeholder="Regular, No nuts" />
            </Field>
            <datalist id="diet-tags">{TAG_SUGGESTIONS.map((t) => <option key={t} value={t} />)}</datalist>
          </form>
        )}
      </Modal>
      <ConfirmModal open={Boolean(deleting)} onClose={() => setDeleting(null)} onConfirm={remove} loading={saving} title="Delete meal?"
        message="Are you sure you want to permanently delete this meal?" />
      <ConfirmModal open={Boolean(toggling)} onClose={() => setToggling(null)} onConfirm={toggleActive} loading={saving}
        title={toggling?.is_active ? 'Remove meal from the plan?' : 'Restore meal?'} confirmLabel={toggling?.is_active ? 'Remove' : 'Restore'}
        message={toggling?.is_active ? 'Are you sure you want to remove this meal? It stays on record and can be restored.' : 'This meal will be put back on the plan.'} />
    </>
  );
}
