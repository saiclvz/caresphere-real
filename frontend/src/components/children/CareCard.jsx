import { useState } from 'react';
import { CheckCircle2, HeartPulse, Pencil } from 'lucide-react';
import useApi from '../../hooks/useApi';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { Badge, Button, Card, ErrorNote, Field, Skeleton } from '../ui';
import { formatDate, formatDateTime } from '../../lib/format';

export const CARE_FIELDS = [
  ['allergies', 'Allergies'], ['dietary', 'Dietary restrictions'], ['daily_medications', 'Daily medications and schedule'],
  ['emergency_contact', 'Emergency contact'], ['routine_notes', 'Daily routine notes'], ['special_needs', 'Special care needs'],
];

/** The Care card fields (read-only view), also used by emergency access. */
export function CareCardFields({ card }) {
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      {CARE_FIELDS.map(([k, label]) => (
        <div key={k}>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
          <dd className="mt-0.5 whitespace-pre-wrap text-sm text-navy-900">{card?.[k] || <span className="text-slate-400">Not recorded</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Care card: the minimum needed for daily care. Shown to Staff with the Children duty (or only on shift, per
 * Settings); edited only by the assigned case worker and Admin. Every view is logged on the server.
 */
export default function CareCard({ childId }) {
  const { toast } = useApp();
  const { data, loading, error, reload, setData } = useApi(`/children/${encodeURIComponent(childId)}/care-card`);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const card = data?.data;

  if (loading && !data) return <Card className="p-5"><Skeleton rows={3} /></Card>;
  if (error) {
    return (
      <Card className="p-5">
        <h2 className="mb-2 flex items-center gap-2 font-semibold text-navy-900"><HeartPulse className="h-4 w-4 text-red-600" aria-hidden /> Care card</h2>
        {error.status === 403 ? <p className="text-sm text-slate-600">The Care card is shown to staff on shift. Your access does not include it right now.</p> : <ErrorNote error={error} onRetry={reload} />}
      </Card>
    );
  }
  const start = () => { setForm(Object.fromEntries(CARE_FIELDS.map(([k]) => [k, card[k] || '']))); setSaveError(null); setEditing(true); };
  const save = async (e) => {
    e.preventDefault();
    setSaving(true); setSaveError(null);
    try { const res = await api(`/children/${encodeURIComponent(childId)}/care-card`, { method: 'PUT', body: form }); setData(res); setEditing(false); toast('Care card saved.'); }
    catch (err) { setSaveError(err); } finally { setSaving(false); }
  };
  const review = async () => {
    try { const res = await api(`/children/${encodeURIComponent(childId)}/care-card/review`, { method: 'POST' }); setData(res); toast('Marked as reviewed.'); }
    catch (err) { toast(err.message, 'error'); }
  };

  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold text-navy-900"><HeartPulse className="h-4 w-4 text-red-600" aria-hidden /> Care card</h2>
        <div className="flex flex-wrap items-center gap-2">
          {card.review_due && <Badge tone="amber">Review due</Badge>}
          {card.can_edit && !editing && <>
            <Button size="sm" variant="ghost" onClick={review}><CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Reviewed, no changes</Button>
            <Button size="sm" variant="secondary" onClick={start}><Pencil className="h-3.5 w-3.5" aria-hidden /> Edit</Button>
          </>}
        </div>
      </div>
      <p className="mb-3 text-xs text-slate-500">
        The minimum needed for daily care. {card.last_reviewed_at ? `Last reviewed on ${formatDate(card.last_reviewed_at)}${card.last_reviewed_by_name ? ` by ${card.last_reviewed_by_name}` : ''}.` : 'Not reviewed yet.'}
        {' '}Review every {card.review_days} days.
      </p>
      {editing ? (
        <form onSubmit={save} className="space-y-3">
          <ErrorNote error={saveError} />
          {CARE_FIELDS.map(([k, label]) => (
            <Field key={k} label={label} error={saveError?.details?.errors?.[k]}>
              <textarea className="input" rows={2} maxLength={2000} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </Field>
          ))}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
            <Button type="submit" loading={saving}>Save Care card</Button>
          </div>
        </form>
      ) : <CareCardFields card={card} />}
      {card.updated_at && <p className="mt-3 text-xs text-slate-500">Last changed {formatDateTime(card.updated_at)}{card.updated_by_name ? ` by ${card.updated_by_name}` : ''}</p>}
    </Card>
  );
}
