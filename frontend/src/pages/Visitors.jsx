import { useState } from 'react';
import { LogOut, Pencil, Trash2, UserPlus, Users } from 'lucide-react';
import useApi from '../hooks/useApi';
import { api, qs } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { Badge, Button, Card, ConfirmModal, EmptyState, ErrorNote, Field, Modal, NoMatches, PageHeader, Spinner, Table } from '../components/ui';
import { formatDateTime, isoDate } from '../lib/format';

const pad = (n) => String(n).padStart(2, '0');
const nowLocal = () => { const d = new Date(); return `${isoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const toInput = (v) => (v ? String(v).replace(' ', 'T').slice(0, 16) : '');

function validate(f, { requireOut = false } = {}) {
  const e = {};
  if (!f.visitor_name?.trim()) e.visitor_name = 'Visitor name is required.';
  if (!f.contact_number?.trim()) e.contact_number = 'Contact number is required.';
  else if (!/^[+\d][\d\s-]{6,19}$/.test(f.contact_number.trim())) e.contact_number = 'Enter a valid contact number.';
  if (!f.purpose?.trim()) e.purpose = 'Purpose of visit is required.';
  if (!f.check_in_time) e.check_in_time = 'Time in is required.';
  else if (f.check_in_time > nowLocal()) e.check_in_time = 'Time in cannot be in the future.';
  if (requireOut && !f.check_out_time) e.check_out_time = 'Time out is required.';
  if (f.check_out_time) {
    if (f.check_out_time > nowLocal()) e.check_out_time = 'Time out cannot be in the future.';
    else if (f.check_in_time && f.check_out_time < f.check_in_time) e.check_out_time = 'Time out cannot be earlier than time in.';
  }
  return e;
}

function VisitorForm({ initial, onClose, onSaved }) {
  const editing = Boolean(initial);
  const [form, setForm] = useState(editing
    ? { visitor_name: initial.visitor_name, contact_number: initial.contact_number || '', purpose: initial.purpose,
      check_in_time: toInput(initial.check_in_time), check_out_time: toInput(initial.check_out_time) }
    : { visitor_name: '', contact_number: '', purpose: '', check_in_time: nowLocal(), check_out_time: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => { setForm({ ...form, [k]: e.target.value }); setErrors((x) => ({ ...x, [k]: undefined })); };

  const submit = async (e) => {
    e.preventDefault();
    const v = validate(form);
    setErrors(v);
    if (Object.keys(v).length) return;
    setSaving(true); setError(null);
    try {
      const res = editing
        ? await api(`/visitors/${initial.visitor_id}`, { method: 'PUT', body: { ...form, check_out_time: form.check_out_time || null } })
        : await api('/visitors', { method: 'POST', body: { visitor_name: form.visitor_name, contact_number: form.contact_number, purpose: form.purpose, check_in_time: form.check_in_time } });
      onSaved(res.data, !editing);
    } catch (err) { setError(err); } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={editing ? 'Edit visitor record' : 'Check in a visitor'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="visitor-form" loading={saving}>{editing ? 'Save changes' : 'Check in'}</Button></>}>
      <form id="visitor-form" onSubmit={submit} noValidate className="space-y-4">
        <ErrorNote error={error} />
        <Field label="Name" error={errors.visitor_name}><input className="input" maxLength={100} value={form.visitor_name} onChange={set('visitor_name')} /></Field>
        <Field label="Contact number" error={errors.contact_number}><input className="input" inputMode="tel" value={form.contact_number} onChange={set('contact_number')} placeholder="09XX XXX XXXX" /></Field>
        <Field label="Purpose of visit" error={errors.purpose}><textarea className="input" rows={2} maxLength={1000} value={form.purpose} onChange={set('purpose')} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Time in" error={errors.check_in_time}><input className="input" type="datetime-local" max={nowLocal()} value={form.check_in_time} onChange={set('check_in_time')} /></Field>
          {editing && <Field label="Time out" hint="Leave empty if still on site." error={errors.check_out_time}><input className="input" type="datetime-local" max={nowLocal()} value={form.check_out_time} onChange={set('check_out_time')} /></Field>}
        </div>
      </form>
    </Modal>
  );
}

function CheckOutModal({ visitor, onClose, onSaved }) {
  const [time, setTime] = useState(nowLocal());
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const v = validate({ ...visitor, contact_number: visitor.contact_number || '0000000', check_in_time: toInput(visitor.check_in_time), check_out_time: time }, { requireOut: true });
    if (v.check_out_time) { setError(new Error(v.check_out_time)); return; }
    setSaving(true); setError(null);
    try { onSaved((await api(`/visitors/${visitor.visitor_id}/check-out`, { method: 'PUT', body: { check_out_time: time } })).data); }
    catch (err) { setError(err); } finally { setSaving(false); }
  };
  return (
    <Modal open onClose={onClose} title={`Check out ${visitor.visitor_name}`} size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={saving} onClick={save}>Check out</Button></>}>
      <ErrorNote error={error} />
      <p className="mb-3 text-sm text-slate-600">Checked in {formatDateTime(visitor.check_in_time)}.</p>
      <Field label="Time out"><input className="input" type="datetime-local" max={nowLocal()} value={time} onChange={(e) => setTime(e.target.value)} /></Field>
    </Modal>
  );
}

export default function Visitors() {
  const { user } = useAuth();
  const { query, toast } = useApp();
  const isAdmin = user.role === 'Admin';
  const [date, setDate] = useState(isoDate());
  const [openOnly, setOpenOnly] = useState(false);
  const { data, loading, error, reload } = useApi(`/visitors${qs({ date: date || undefined, open: openOnly ? 1 : undefined, q: query })}`);
  const [form, setForm] = useState(null); // 'new' | visitor
  const [checkingOut, setCheckingOut] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  const rows = data?.data || [];

  const remove = async () => {
    setBusy(true);
    try { await api(`/visitors/${deleting.visitor_id}`, { method: 'DELETE' }); setDeleting(null); await reload(); toast('Visitor record deleted.'); }
    catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title="Visitors" description="Log each visitor's name, contact number, purpose and time in, then record their time out when they leave."
        actions={<Button onClick={() => setForm('new')}><UserPlus className="h-4 w-4" /> Check in visitor</Button>} />
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <Field label="Date"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Button variant="ghost" size="sm" onClick={() => setDate('')}>All dates</Button>
        <label className="mb-2 inline-flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" className="h-4 w-4 accent-brand" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} /> Still on site only
        </label>
      </div>
      <Card>
        {loading && !data ? <Spinner /> : error ? <div className="p-5"><ErrorNote error={error} onRetry={reload} /></div> : rows.length === 0 ? (
          query ? <NoMatches /> : <EmptyState icon={Users} title="No visitors for this view" />
        ) : (
          <Table>
            <thead className="bg-slate-50"><tr>
              <th className="th">Visitor</th><th className="th">Contact</th><th className="th">Purpose</th>
              <th className="th">Time in</th><th className="th">Time out</th><th className="th"><span className="sr-only">Actions</span></th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((v) => (
                <tr key={v.visitor_id}>
                  <td className="td"><p className="font-medium text-navy-900">{v.visitor_name}</p>{v.logged_by_name && <p className="text-xs text-slate-500">Logged by {v.logged_by_name}</p>}</td>
                  <td className="td whitespace-nowrap">{v.contact_number || <span className="text-slate-400">-</span>}</td>
                  <td className="td max-w-xs">{v.purpose}</td>
                  <td className="td whitespace-nowrap">{formatDateTime(v.check_in_time)}</td>
                  <td className="td whitespace-nowrap">{v.check_out_time ? formatDateTime(v.check_out_time) : <Badge tone="green">On site</Badge>}</td>
                  <td className="td whitespace-nowrap text-right">
                    {!v.check_out_time && <Button size="sm" onClick={() => setCheckingOut(v)}><LogOut className="h-3.5 w-3.5" /> Time out</Button>}{' '}
                    <Button size="sm" variant="ghost" aria-label="Edit" onClick={() => setForm(v)}><Pencil className="h-3.5 w-3.5" /></Button>
                    {isAdmin && <Button size="sm" variant="ghost" aria-label="Delete" onClick={() => setDeleting(v)}><Trash2 className="h-3.5 w-3.5 text-red-600" /></Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {form && <VisitorForm initial={form === 'new' ? null : form} onClose={() => setForm(null)}
        onSaved={async (v, created) => { setForm(null); await reload(); toast(created ? `${v.visitor_name} checked in.` : 'Changes saved.'); }} />}
      {checkingOut && <CheckOutModal visitor={checkingOut} onClose={() => setCheckingOut(null)}
        onSaved={async (v) => { setCheckingOut(null); await reload(); toast(`${v.visitor_name} checked out.`); }} />}
      <ConfirmModal open={!!deleting} onClose={() => setDeleting(null)} loading={busy} onConfirm={remove} title="Delete visitor record?"
        message={deleting ? `Are you sure you want to delete the visit record for ${deleting.visitor_name}?` : ''} />
    </>
  );
}
