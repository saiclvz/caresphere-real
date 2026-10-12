import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileHeart, Plus } from 'lucide-react';
import useApi from '../hooks/useApi';
import { api, qs } from '../api/client';
import { useApp } from '../context/AppContext';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Modal, NoMatches, PageHeader, Spinner, Table } from '../components/ui';
import ConfidentialityBanner from '../components/adoption/ConfidentialityBanner';
import { formatDate } from '../lib/format';
import AssignedFilter from '../components/AssignedFilter';
import VerificationQueue from '../components/adoption/VerificationQueue';

export const PHASE_TABS = [
  { key: '', label: 'All' }, { key: 'preparation', label: 'Preparation' }, { key: 'matching', label: 'Matching' },
  { key: 'petition', label: 'Petition' }, { key: 'finalization', label: 'Finalization' }, { key: 'ended', label: 'Closed or ended' },
];
/** Badge colour for a status. */
export function statusTone(status) {
  if (['Declined'].includes(status)) return 'red';
  if (['Withdrawn', 'Closed', 'Placement ended'].includes(status)) return 'slate';
  if (status === 'Documents requested') return 'amber';
  if (['Order of Adoption issued', 'Civil registry updated'].includes(status)) return 'green';
  return 'blue';
}

/** A deadline chip: red when overdue, amber within 14 days. */
export function DeadlineChip({ label, d }) {
  if (!d) return null;
  const overdue = d.days_left < 0;
  return <Badge tone={overdue ? 'red' : d.days_left <= 14 ? 'amber' : 'slate'}>{label}: {overdue ? `${-d.days_left} day(s) overdue` : `${d.days_left} day(s) left`}</Badge>;
}

/** Walk-in case: an applicant who already has an account (no new person is created). */
function NewCaseDialog({ onClose, onCreated }) {
  const { toast } = useApp();
  const [q, setQ] = useState('');
  const found = useApi(q.trim().length >= 2 ? `/adoption-applicants${qs({ q: q.trim() })}` : null);
  const [pick, setPick] = useState(null);
  const [type, setType] = useState('Regular');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const create = async () => {
    setBusy(true); setError(null);
    try {
      const res = await api('/adoptions/staff-case', { method: 'POST', body: { applicant_user_id: pick.user_id, application_type: type } });
      toast(`Case ${res.data.reference_no} opened.`); onCreated(res.data.application_id);
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  const rows = found.data?.data || [];
  return (
    <Modal open onClose={onClose} title="Open a case for a walk-in applicant"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!pick || pick.active_reference} onClick={create}>Open case</Button></>}>
      <div className="space-y-3">
        <ErrorNote error={error} />
        <p className="text-sm text-slate-600">The applicant needs an account first (Register). You'll choose the existing child and enter the application in the Case workflow tab.</p>
        <Field label="Find the applicant's account" hint="Name or email, at least 2 characters.">
          <input className="input" value={q} onChange={(e) => { setQ(e.target.value); setPick(null); }} />
        </Field>
        {q.trim().length >= 2 && (found.loading && !found.data ? <Spinner /> : rows.length === 0 ? <p className="text-sm text-slate-500">No applicant account found.</p> : (
          <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200" role="listbox" aria-label="Applicant accounts">
            {rows.map((r) => (
              <li key={r.user_id}>
                <button type="button" role="option" aria-selected={pick?.user_id === r.user_id} onClick={() => setPick(r)}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm ${pick?.user_id === r.user_id ? 'bg-brand-50' : 'hover:bg-slate-50'}`}>
                  <span><span className="font-medium text-navy-900">{r.name}</span><span className="block text-xs text-slate-500">{r.email}</span></span>
                  {r.active_reference && <Badge tone="amber">Active case {r.active_reference}</Badge>}
                </button>
              </li>
            ))}
          </ul>
        ))}
        {pick?.active_reference && <p className="text-sm text-amber-800">This applicant already has an active case. Open it from the list instead.</p>}
        <Field label="Adoption type" required>
          <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
            {Object.entries(TYPE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
      </div>
    </Modal>
  );
}

function Inner() {
  const { query } = useApp();
  const navigate = useNavigate();
  const [phase, setPhase] = useState('');
  const [status, setStatus] = useState('');
  const [assigned, setAssigned] = useState('');
  const [bucket, setBucket] = useState('');
  const [creating, setCreating] = useState(false);
  const config = useApi('/adoptions/form-config');
  const cfg = config.data?.data;
  const statuses = !cfg ? [] : cfg.statuses.filter((s) => s !== 'Draft' && (!phase ? true
    : phase === 'ended' ? ['Declined', 'Withdrawn', 'Closed'].includes(s)
      : cfg.stages[s]?.phase === phase && s !== 'Closed'));
  const { data, loading, error, reload } = useApi(`/adoptions${qs({ phase: phase || undefined, status: status || undefined, assigned: assigned || undefined, bucket: bucket || undefined, q: query })}`);
  const rows = data?.data || [];
  const summary = data?.meta?.summary || [];

  return (
    <>
      <PageHeader title="Adoption applications" description="Applications follow the administrative adoption process under RA 11642. The home records RACCO, NACC and civil registry outcomes."
        actions={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" aria-hidden /> New case (walk-in)</Button>} />
      <ConfidentialityBanner />
      <VerificationQueue />
      {summary.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5 xl:grid-cols-10" role="group" aria-label="Filter by stage">
          {summary.map((c) => {
            const active = c.key === 'total' ? !bucket : bucket === c.key;
            return (
              <button key={c.key} type="button" aria-pressed={active} onClick={() => { setBucket(c.key === 'total' ? '' : c.key); setStatus(''); setPhase(''); }}
                className={`rounded-xl border p-3 text-left shadow-card transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${active ? 'border-brand bg-brand-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
                <span className="block text-2xl font-semibold text-navy-900">{c.count}</span>
                <span className="block text-xs text-slate-600">{c.label}</span>
              </button>
            );
          })}
        </div>
      )}
      {rows.some((r) => r.masked) && <p className="mb-3 text-xs text-slate-500">Names are masked until you unlock a record assigned to you. Search works by case number.</p>}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="max-w-xs">
          <label className="sr-only" htmlFor="phase-filter">Phase</label>
          <select id="phase-filter" className="input h-10" value={phase} onChange={(e) => { setPhase(e.target.value); setStatus(''); setBucket(''); }}>
            {PHASE_TABS.map((t) => <option key={t.key || 'all'} value={t.key}>{t.key ? t.label : 'All phases'}</option>)}
          </select>
        </div>
        <div className="max-w-xs">
          <label className="sr-only" htmlFor="status-filter">Status</label>
          <select id="status-filter" className="input h-10" value={status} onChange={(e) => { setStatus(e.target.value); setBucket(''); }}>
            <option value="">All statuses{phase ? ' in this phase' : ''}</option>
            {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <AssignedFilter value={assigned} onChange={setAssigned} />
      </div>
      <Card>
        {loading && !data ? <Spinner /> : error ? <div className="p-5"><ErrorNote error={error} onRetry={reload} /></div> : rows.length === 0 ? (
          query ? <NoMatches /> : <EmptyState icon={FileHeart} title="No applications in this view" />
        ) : (
          <Table>
            <thead className="bg-slate-50"><tr>
              <th className="th">Case number</th><th className="th">Applicant</th><th className="th">Child</th><th className="th">Adoption type</th>
              <th className="th">Current stage</th><th className="th">Assigned staff</th><th className="th">Days in stage</th><th className="th">Status</th>
              <th className="th">Last updated</th><th className="th"><span className="sr-only">Action</span></th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((a) => (
                <tr key={a.application_id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/adoptions/${a.application_id}`)}>
                  <td className="td whitespace-nowrap font-mono font-medium text-navy-900">{a.reference_no}{a.is_legacy ? <p className="font-sans text-xs font-normal text-slate-500">earlier form</p> : null}</td>
                  <td className="td"><p className="font-medium text-navy-900">{a.legal_name || '-'}</p>{!a.masked && <p className="text-xs text-slate-500">{a.email}</p>}</td>
                  <td className="td">{a.masked ? <span className="text-xs text-slate-400">{a.has_child ? 'Locked' : '-'}</span> : a.child_name ? <>{a.child_name}<p className="text-xs text-slate-500">{a.child_id}</p></> : <span className="text-slate-400">-</span>}</td>
                  <td className="td whitespace-nowrap">{TYPE_LABELS[a.application_type] || a.application_type}</td>
                  <td className="td">{a.current_stage}</td>
                  <td className="td text-sm">{a.assigned_to_me ? <Badge tone="blue">You</Badge> : a.assigned_staff_name || <span className="text-slate-400">Unassigned</span>}
                    {a.assignment_flag && <p className="text-xs text-amber-700">Account deactivated</p>}</td>
                  <td className="td whitespace-nowrap">{a.days_in_stage != null ? `${a.days_in_stage} day${a.days_in_stage === 1 ? '' : 's'}` : '-'}</td>
                  <td className="td">
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={statusTone(a.status)}>{a.status}</Badge>
                      {a.open_requests > 0 && <Badge tone="amber">{a.open_requests} requested</Badge>}
                      <DeadlineChip label="Trial ends" d={a.deadlines?.trial_end} />
                      <DeadlineChip label="NACC" d={a.deadlines?.nacc_deadline} />
                    </div>
                  </td>
                  <td className="td whitespace-nowrap text-sm">{formatDate(a.last_updated)}</td>
                  <td className="td text-right"><button type="button" className="text-sm font-medium text-brand hover:underline" onClick={(e) => { e.stopPropagation(); navigate(`/adoptions/${a.application_id}`); }}>Open<span className="sr-only"> {a.reference_no}</span></button></td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {creating && <NewCaseDialog onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); navigate(`/adoptions/${id}?tab=workflow`); }} />}
    </>
  );
}

const TYPE_LABELS = { Regular: 'Regular', Stepparent: 'Stepparent', Relative: 'Relative', Relative_own_child: 'Own non-marital child', Adult: 'Adult' };

export default function Adoptions() {
  return <Inner />;
}
