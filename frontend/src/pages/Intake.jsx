import { useNavigate, useSearchParams } from 'react-router-dom';
import { ClipboardList, Clock, Plus } from 'lucide-react';
import useApi from '../hooks/useApi';
import { qs } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Badge, Button, Card, EmptyState, ErrorNote, PageHeader, Spinner, Table, FilterChips } from '../components/ui';
import { formatDateTime } from '../lib/format';
import { hasDuty } from '../lib/duties';
import { ADMISSION_TONE } from './AdmissionPage';

/**
 * Children > Intake: admissions that are not (or not yet) admitted children. The Children page lists admitted
 * children only. Admin sees every admission (default: waiting for an Admin decision); Staff with the Admission duty
 * see the admissions they started. Lifecycle: Referral Received -> Intake and Assessment -> Pending Admin Approval
 * -> Admitted; or Declined / Not Admitted.
 */
const FILTERS = [
  ['Pending Approval', 'Pending Admin Approval'],
  ['Needs Correction', 'Returned for correction'],
  ['Referral Received', 'Referral Received'],
  ['Intake and Assessment', 'Intake and Assessment'],
  ['stale', 'Unfinished (stale)'],
  ['closed', 'Declined / Not Admitted'],
  ['Admitted', 'Admitted'],
  ['all', 'All'],
];
const OPEN_STAGES = ['Draft', 'Referral Received', 'Intake and Assessment', 'Needs Correction'];

export default function Intake() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user.role === 'Admin';
  const canAdmit = user.role === 'Staff' && hasDuty(user, 'admission'); // Staff submit; Admin reviews and decides
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || (isAdmin ? 'Pending Approval' : 'all');
  const query = status === 'stale' ? { status: 'all', stale: 1 } : { status };
  const { data, loading, error, reload } = useApi(`/admissions${qs(query)}`);
  const rows = data?.data || [];
  const counts = data?.meta?.counts || {};
  const staleDays = data?.meta?.stale_days;
  const setStatus = (k) => setParams((p) => { const n = new URLSearchParams(p); n.set('status', k); return n; }, { replace: true });

  return (
    <>
      <PageHeader title="Intake"
        description={isAdmin ? 'Admissions not yet admitted: referral, intake and assessment, and those waiting for an Admin decision. Admitted children are on the Children page.'
          : 'The admissions you started. Once an Admin approves one, the child appears on the Children page.'}
        actions={canAdmit && <Button onClick={() => navigate('/admissions/new')}><Plus className="h-4 w-4" aria-hidden /> New Admission</Button>} />

      <FilterChips className="mb-4" label="Admission status" value={status} onChange={setStatus}
        options={FILTERS.map(([k, l]) => ({ key: k, label: l, count: (k === 'Pending Approval' || k === 'Needs Correction') && counts[k] ? counts[k] : undefined }))} />

      <Card>
        {loading && !data ? <Spinner /> : error ? <div className="p-5"><ErrorNote error={error} onRetry={reload} /></div> : rows.length === 0 ? (
          <EmptyState icon={ClipboardList} title={status === 'Pending Approval' ? 'No admissions are waiting for review' : 'No admissions in this view'}
            description={status === 'stale' && staleDays ? `Unfinished admissions with no changes for ${staleDays} days appear here. They are never deleted.` : undefined} />
        ) : (
          <Table label="Admissions">
            <thead className="bg-slate-50"><tr>
              <th className="th">Case number</th><th className="th">Child name</th>{isAdmin && <th className="th">Created by</th>}
              <th className="th">Last change</th><th className="th">Date submitted</th><th className="th">Stage</th><th className="th"><span className="sr-only">Action</span></th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const action = isAdmin && r.admission_status === 'Pending Approval' ? 'Review Admission' : OPEN_STAGES.includes(r.admission_status) && !isAdmin ? 'Continue' : 'Open';
                // Staff open their admission while it is open; afterwards the child (if assigned) is on the Children page.
                const canOpen = isAdmin || [...OPEN_STAGES, 'Pending Approval'].includes(r.admission_status);
                return (
                  <tr key={r.child_id}>
                    <td className="td whitespace-nowrap font-mono text-sm">{r.child_id}</td>
                    <td className="td">{r.name}{r.decision_note && <p className="max-w-sm text-xs text-slate-500">{r.admission_status === 'Needs Correction' ? 'To correct' : 'Reason'}: {r.decision_note}</p>}</td>
                    {isAdmin && <td className="td text-sm">{r.created_by_name}</td>}
                    <td className="td whitespace-nowrap text-sm">{formatDateTime(r.updated_at || r.created_at)}{r.stale && <span className="mt-0.5 flex items-center gap-1 text-xs text-amber-800"><Clock className="h-3 w-3" aria-hidden /> Stale</span>}</td>
                    <td className="td whitespace-nowrap text-sm">{r.submitted_at ? formatDateTime(r.submitted_at) : <span className="text-slate-400">Not submitted</span>}</td>
                    <td className="td"><Badge tone={ADMISSION_TONE[r.stage] || 'slate'}>{r.stage_label}</Badge></td>
                    <td className="td text-right">{canOpen && <Button size="sm" variant={action === 'Review Admission' ? 'primary' : 'secondary'} onClick={() => navigate(`/admissions/${encodeURIComponent(r.child_id)}`)}>{action}<span className="sr-only"> admission {r.child_id}</span></Button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
