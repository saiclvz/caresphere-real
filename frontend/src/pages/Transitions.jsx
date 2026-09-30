import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { GraduationCap, Pencil } from 'lucide-react';
import useApi from '../hooks/useApi';
import { api, qs } from '../api/client';
import { useApp } from '../context/AppContext';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Modal, NoMatches, PageHeader, Spinner, Table } from '../components/ui';
import { formatDate, formatDateTime } from '../lib/format';

const STATUSES = ['For Review', 'In Progress', 'Completed'];
const TONE = { 'For Review': 'amber', 'In Progress': 'blue', Completed: 'green' };

export default function Transitions() {
  const { query, toast } = useApp();
  const [status, setStatus] = useState('');
  const { data, loading, error, reload, setData } = useApi(`/transition-reviews${qs({ status, q: query })}`);
  const [editing, setEditing] = useState(null);
  const rows = data?.data || [];

  return (
    <>
      <PageHeader title="Transition Review (18+)"
        description="Children are added here automatically when they turn 18. Records stay active; nothing is discharged or deleted by this review." />
      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Filter by status">
        {['', ...STATUSES].map((s) => (
          <button key={s || 'all'} type="button" role="tab" aria-selected={status === s} onClick={() => setStatus(s)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${status === s ? 'bg-navy-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}>
            {s || 'All'}
          </button>
        ))}
      </div>
      <Card>
        {loading && !data ? <Spinner /> : error ? <div className="p-5"><ErrorNote error={error} onRetry={reload} /></div> : rows.length === 0 ? (
          query ? <NoMatches /> : <EmptyState icon={GraduationCap} title="No one is due for transition review" description="Children appear here automatically on their 18th birthday." />
        ) : (
          <Table>
            <thead className="bg-slate-50"><tr>
              <th className="th">Young person</th><th className="th">Age</th><th className="th">Flagged</th>
              <th className="th">Goals</th><th className="th">Status</th><th className="th"><span className="sr-only">Actions</span></th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.review_id}>
                  <td className="td"><Link to={`/children/${r.child_id}`} className="font-medium text-navy-900 hover:text-brand">{r.full_name}</Link>
                    <p className="text-xs text-slate-500">{r.child_id} · {r.child_status}</p></td>
                  <td className="td">{r.age}</td>
                  <td className="td whitespace-nowrap">{formatDate(r.flagged_at)}</td>
                  <td className="td text-xs text-slate-600">
                    {[['Housing', r.housing_goal], ['Vocational', r.vocational_goal], ['Education', r.education_goal]]
                      .filter(([, v]) => v).map(([l]) => l).join(', ') || <span className="text-slate-400">None set</span>}
                  </td>
                  <td className="td"><Badge tone={TONE[r.review_status]}>{r.review_status}</Badge>
                    {r.updated_by_name && <p className="mt-1 text-xs text-slate-500">{r.updated_by_name}, {formatDateTime(r.updated_at)}</p>}</td>
                  <td className="td text-right"><Button size="sm" variant="secondary" onClick={() => setEditing(r)}><Pencil className="h-3.5 w-3.5" /> Update</Button></td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <ReviewModal review={editing} onClose={() => setEditing(null)}
        onSaved={(row) => {
          setData({ ...data, data: rows.map((r) => (r.review_id === row.review_id ? row : r)).filter((r) => !status || r.review_status === status) });
          setEditing(null); toast('Transition review saved.');
        }} />
    </>
  );
}

function ReviewModal({ review, onClose, onSaved }) {
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (review) setForm({ review_status: review.review_status, notes: review.notes || '', housing_goal: review.housing_goal || '',
      vocational_goal: review.vocational_goal || '', education_goal: review.education_goal || '' });
    setError(null);
  }, [review]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async () => {
    setSaving(true); setError(null);
    try { onSaved((await api(`/transition-reviews/${review.review_id}`, { method: 'PUT', body: form })).data); }
    catch (err) { setError(err); } finally { setSaving(false); }
  };
  return (
    <Modal open={!!review} onClose={onClose} title={review ? `Transition plan: ${review.full_name}` : ''}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={saving} onClick={save}>Save</Button></>}>
      <div className="space-y-4">
        <ErrorNote error={error} />
        <Field label="Status"><select className="input" value={form.review_status || ''} onChange={set('review_status')}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></Field>
        <Field label="Housing goal"><textarea className="input" rows={2} value={form.housing_goal || ''} onChange={set('housing_goal')} /></Field>
        <Field label="Vocational goal"><textarea className="input" rows={2} value={form.vocational_goal || ''} onChange={set('vocational_goal')} /></Field>
        <Field label="Education goal"><textarea className="input" rows={2} value={form.education_goal || ''} onChange={set('education_goal')} /></Field>
        <Field label="Review notes"><textarea className="input" rows={4} value={form.notes || ''} onChange={set('notes')} /></Field>
        <p className="text-xs text-slate-500">Completing the review does not discharge the young person. Use the child's record to change status with full discharge documentation.</p>
      </div>
    </Modal>
  );
}
