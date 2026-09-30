import { useState } from 'react';
import { CalendarClock, ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import useApi from '../hooks/useApi';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { Button, Card, ConfirmModal, EmptyState, ErrorNote, Field, Modal, NoMatches, PageHeader, Spinner } from '../components/ui';
import { addDays, formatTime, isoDate, matches, startOfWeek } from '../lib/format';

export default function Schedules() {
  const { query, toast } = useApp();
  const [weekStart, setWeekStart] = useState(startOfWeek());
  const days = [...Array(7)].map((_, i) => addDays(weekStart, i));
  const from = isoDate(days[0]);
  const to = isoDate(days[6]);
  const { data, loading, error, reload } = useApi(`/schedules?from=${from}&to=${to}`);
  const staff = useApi('/users');
  const [form, setForm] = useState(null);
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const people = (staff.data?.data || []).filter((u) => u.is_active && u.role !== 'Donor');
  const shifts = (data?.data || []).filter((s) => matches(query, s.full_name, s.assignment));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true); setFormError(null);
    try {
      const body = { ...form, user_id: Number(form.user_id) };
      if (form.schedule_id) await api(`/schedules/${form.schedule_id}`, { method: 'PUT', body });
      else await api('/schedules', { method: 'POST', body });
      setForm(null); toast('Shift saved.'); reload();
    } catch (err) { setFormError(err); } finally { setSaving(false); }
  };

  const remove = async () => {
    setSaving(true);
    try { await api(`/schedules/${deleting.schedule_id}`, { method: 'DELETE' }); setDeleting(null); toast('Shift deleted.'); reload(); }
    catch (err) { toast(err.message, 'error'); } finally { setSaving(false); }
  };

  const openNew = (date = isoDate()) => { setForm({ user_id: '', shift_date: date, start_time: '07:00', end_time: '15:00', assignment: '' }); setFormError(null); };

  return (
    <>
      <PageHeader title="Staff schedules" description="Plan who is on duty each day. Staff see their own shifts under My schedule."
        actions={<Button onClick={() => openNew()}><Plus className="h-4 w-4" /> Add shift</Button>} />

      <div className="mb-4 flex items-center gap-2">
        <Button variant="secondary" size="sm" aria-label="Previous week" onClick={() => setWeekStart(addDays(weekStart, -7))}><ChevronLeft className="h-4 w-4" /></Button>
        <Button variant="secondary" size="sm" onClick={() => setWeekStart(startOfWeek())}>This week</Button>
        <Button variant="secondary" size="sm" aria-label="Next week" onClick={() => setWeekStart(addDays(weekStart, 7))}><ChevronRight className="h-4 w-4" /></Button>
        <span className="ml-2 text-sm font-medium text-navy-900">Week of {days[0].toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
      </div>

      {error && <ErrorNote error={error} onRetry={reload} />}
      {query && data && shifts.length === 0 && <Card className="mb-4"><NoMatches /></Card>}
      {loading && !data ? <Spinner /> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
          {days.map((d) => {
            const date = isoDate(d);
            const list = shifts.filter((s) => s.shift_date === date);
            return (
              <Card key={date} className={`flex flex-col p-3 ${date === isoDate() ? 'ring-2 ring-brand' : ''}`}>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-semibold text-navy-900">{d.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' })}</p>
                  <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-brand" aria-label={`Add shift on ${date}`} onClick={() => openNew(date)}><Plus className="h-4 w-4" /></button>
                </div>
                {list.length === 0 ? <p className="text-xs text-slate-400">No shifts</p> : (
                  <ul className="space-y-2">
                    {list.map((s) => (
                      <li key={s.schedule_id} className="group rounded-lg bg-page p-2">
                        <p className="text-xs font-semibold text-navy-900">{s.full_name}</p>
                        <p className="text-xs text-slate-500">{formatTime(s.start_time)}–{formatTime(s.end_time)}</p>
                        <p className="text-xs text-slate-600">{s.assignment}</p>
                        <div className="mt-1 flex gap-1 opacity-60 group-hover:opacity-100">
                          <button type="button" className="rounded p-0.5 hover:bg-white" aria-label="Edit shift"
                            onClick={() => { setForm({ ...s, start_time: s.start_time.slice(0, 5), end_time: s.end_time.slice(0, 5) }); setFormError(null); }}><Pencil className="h-3 w-3" /></button>
                          <button type="button" className="rounded p-0.5 text-red-600 hover:bg-white" aria-label="Delete shift" onClick={() => setDeleting(s)}><Trash2 className="h-3 w-3" /></button>
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
      {!loading && people.length === 0 && staff.data && (
        <Card className="mt-4"><EmptyState icon={CalendarClock} title="No staff accounts yet" description="Create staff accounts under User accounts before assigning shifts." /></Card>
      )}

      <Modal open={Boolean(form)} onClose={() => setForm(null)} title={form?.schedule_id ? 'Edit shift' : 'Add shift'}
        footer={<><Button variant="secondary" onClick={() => setForm(null)}>Cancel</Button><Button type="submit" form="shift-form" loading={saving}>Save shift</Button></>}>
        {form && (
          <form id="shift-form" onSubmit={submit} className="space-y-4">
            <ErrorNote error={formError} />
            <Field label="Staff member">
              <select className="input" required value={form.user_id} onChange={(e) => setForm({ ...form, user_id: e.target.value })}>
                <option value="">Select a person</option>
                {people.map((p) => <option key={p.user_id} value={p.user_id}>{p.full_name} ({p.role})</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Date"><input className="input" type="date" required value={form.shift_date} onChange={(e) => setForm({ ...form, shift_date: e.target.value })} /></Field>
              <Field label="Start"><input className="input" type="time" required value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} /></Field>
              <Field label="End"><input className="input" type="time" required value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} /></Field>
            </div>
            <Field label="Assignment"><input className="input" required maxLength={150} value={form.assignment} onChange={(e) => setForm({ ...form, assignment: e.target.value })} placeholder="e.g. Nursery, Kitchen, Front desk" /></Field>
          </form>
        )}
      </Modal>
      <ConfirmModal open={Boolean(deleting)} onClose={() => setDeleting(null)} onConfirm={remove} loading={saving} title="Delete shift?" message={`${deleting?.full_name}'s shift will be removed.`} />
    </>
  );
}
