import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileHeart } from 'lucide-react';
import useApi from '../hooks/useApi';
import { qs } from '../api/client';
import { useApp } from '../context/AppContext';
import { Badge, Card, EmptyState, ErrorNote, NoMatches, PageHeader, Spinner, Table } from '../components/ui';
import ConfidentialityBanner from '../components/adoption/ConfidentialityBanner';
import { formatDate } from '../lib/format';
import AssignedFilter from '../components/AssignedFilter';

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

function Inner() {
  const { query } = useApp();
  const navigate = useNavigate();
  const [phase, setPhase] = useState('');
  const [status, setStatus] = useState('');
  const [assigned, setAssigned] = useState('');
  const config = useApi('/adoptions/form-config');
  const cfg = config.data?.data;
  const statuses = !cfg ? [] : cfg.statuses.filter((s) => s !== 'Draft' && (!phase ? true
    : phase === 'ended' ? ['Declined', 'Withdrawn', 'Closed'].includes(s)
      : cfg.stages[s]?.phase === phase && s !== 'Closed'));
  const { data, loading, error, reload } = useApi(`/adoptions${qs({ phase: phase || undefined, status: status || undefined, assigned: assigned || undefined, q: query })}`);
  const rows = data?.data || [];

  return (
    <>
      <PageHeader title="Adoption applications" description="Applications follow the administrative adoption process under RA 11642. The home records RACCO, NACC and civil registry outcomes." />
      <ConfidentialityBanner />
      {rows.some((r) => r.masked) && <p className="mb-3 text-xs text-slate-500">Names are masked until you unlock a record assigned to you. Search works by reference number.</p>}
      <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="Filter by phase">
        {PHASE_TABS.map((t) => (
          <button key={t.key || 'all'} type="button" role="tab" aria-selected={phase === t.key} onClick={() => { setPhase(t.key); setStatus(''); }}
            className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${phase === t.key ? 'bg-navy-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
      <div className="max-w-xs">
        <label className="sr-only" htmlFor="status-filter">Status</label>
        <select id="status-filter" className="input h-10" value={status} onChange={(e) => setStatus(e.target.value)}>
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
              <th className="th">Reference</th><th className="th">Applicant</th><th className="th">Submitted</th>
              <th className="th">Assigned staff</th><th className="th">Matched child</th><th className="th">Stage</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((a) => (
                <tr key={a.application_id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/adoptions/${a.application_id}`)}>
                  <td className="td whitespace-nowrap">
                    <button type="button" className="font-mono font-medium text-navy-900 hover:text-brand" onClick={(e) => { e.stopPropagation(); navigate(`/adoptions/${a.application_id}`); }}>{a.reference_no}</button>
                    <p className="text-xs text-slate-500">{TYPE_LABELS[a.application_type] || a.application_type}{a.is_legacy ? ' · earlier form' : ''}</p>
                  </td>
                  <td className="td"><p className="font-medium text-navy-900">{a.legal_name || '-'}</p>{!a.masked && <p className="text-xs text-slate-500">{a.email}</p>}</td>
                  <td className="td whitespace-nowrap">{formatDate(a.submitted_at)}</td>
                  <td className="td text-sm">{a.assigned_to_me ? <Badge tone="blue">You</Badge> : a.assigned_staff_name || <span className="text-slate-400">Unassigned</span>}
                    {a.assignment_flag && <p className="text-xs text-amber-700">Account deactivated</p>}</td>
                  <td className="td">{a.masked ? <span className="text-xs text-slate-400">Locked</span> : a.matched_child_id ? <>{a.child_full_name}<p className="text-xs text-slate-500">{a.matched_child_id}</p></> : <span className="text-slate-400">-</span>}</td>
                  <td className="td">
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={statusTone(a.status)}>{a.status}</Badge>
                      {a.open_requests > 0 && <Badge tone="amber">{a.open_requests} requested</Badge>}
                      <DeadlineChip label="Trial ends" d={a.deadlines?.trial_end} />
                      <DeadlineChip label="NACC" d={a.deadlines?.nacc_deadline} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

const TYPE_LABELS = { Regular: 'Regular', Stepparent: 'Stepparent', Relative: 'Relative', Relative_own_child: 'Own non-marital child', Adult: 'Adult' };

export default function Adoptions() {
  return <Inner />;
}
