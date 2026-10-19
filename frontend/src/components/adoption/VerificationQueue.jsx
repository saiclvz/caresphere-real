import { useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import useApi from '../../hooks/useApi';
import { formatDateTime } from '../../lib/format';
import { Badge, Card } from '../ui';
import { StatusIcon, statusLabel } from './VerificationList';

/**
 * IDs and clearances waiting for a person: manual verification, flags and problems to confirm. Admin sees
 * all; Staff only the applications assigned to them (names masked). Open the application to review.
 */
export default function VerificationQueue() {
  const navigate = useNavigate();
  const { data, error } = useApi('/adoption-verification-queue');
  const rows = data?.data || [];
  if (error || !rows.length) return null;
  return (
    <Card className="mb-4 p-4">
      <div className="mb-2 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-brand" aria-hidden="true" />
        <h2 className="font-semibold text-navy-900">ID verification queue</h2>
        <Badge tone="amber">{rows.length}</Badge>
      </div>
      <p className="mb-2 text-xs text-slate-500">Government IDs and clearances that need manual verification or review. Open an application to verify, reject, request a correction or flag it.</p>
      <ul className="divide-y divide-slate-100 text-sm">
        {rows.slice(0, 20).map((r) => (
          <li key={r.verification_id}>
            <button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 py-2 text-left hover:bg-slate-50" onClick={() => navigate(`/adoptions/${r.application_id}`)}>
              <span className="min-w-0">
                <span className="font-mono font-medium text-navy-900">{r.reference_no}</span>
                <span className="text-slate-600"> · {r.applicant || 'Applicant'} · {r.kind === 'government_id' ? `Government ID (${r.item_type})` : r.item_type}</span>
                <span className="block text-xs text-slate-500">Waiting since {formatDateTime(r.waiting_since)}{r.assigned_staff_name ? ` · ${r.assigned_staff_name}` : ''}</span>
              </span>
              {(() => { const t = ['Manual verification required', 'Pending verification', 'Flagged for review', 'Unable to verify'].includes(r.status) ? 'amber' : 'red'; return <Badge tone={t}><StatusIcon tone={t} />{statusLabel(r)}</Badge>; })()}
            </button>
          </li>
        ))}
      </ul>
      {rows.length > 20 && <p className="mt-1 text-xs text-slate-500">{rows.length - 20} more not shown.</p>}
    </Card>
  );
}
