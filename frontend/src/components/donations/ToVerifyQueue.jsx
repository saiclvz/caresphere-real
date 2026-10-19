import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Clock, Paperclip } from 'lucide-react';
import useApi from '../../hooks/useApi';
import { qs } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Spinner, Table } from '../ui';
import { ClaimMessageModal, VerifyClaimModal } from './ClaimActions';
import { formatDateTime, formatMoney } from '../../lib/format';

const QUEUES = [['open', 'Waiting'], ['stale', 'Stale'], ['approval', 'Awaiting approval'], ['details', 'Details requested'], ['not_matched', 'Not matched'], ['verified', 'Verified'], ['all', 'All']];
const TONE = { Reported: 'amber', 'Details requested': 'amber', 'Awaiting approval': 'blue', Verified: 'green', 'Not matched': 'red', Withdrawn: 'slate' };

/** Donations > To verify: donor reports, oldest first. Reported amounts are not counted until verified. */
export default function ToVerifyQueue({ onChanged }) {
  const { toast } = useApp();
  const [params, setParams] = useSearchParams();
  const queue = params.get('queue') || 'open';
  const [method, setMethod] = useState('');
  const [q, setQ] = useState('');
  const { data, loading, error, reload } = useApi(`/donations/to-verify${qs({ view: queue, method, q: q.trim() })}`);
  const [verifying, setVerifying] = useState(null);
  const [message, setMessage] = useState(null);
  const d = data?.data;
  const rows = d?.rows || [];
  const setQueue = (k) => setParams((p) => { const n = new URLSearchParams(p); n.set('view', 'verify'); if (k === 'open') n.delete('queue'); else n.set('queue', k); return n; }, { replace: true });
  const done = (text) => { toast(text, 'success'); setVerifying(null); setMessage(null); reload(); onChanged?.(); };

  return (
    <>
      <p className="mb-3 text-sm text-slate-600">Donors report gifts they sent to the home's QR accounts. A report is <strong>not counted</strong> until someone checks the home's own account and verifies the reference, amount and date. Reports waiting longer than the stale limit are flagged, never verified or removed automatically.</p>
      <div className="mb-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Report status">
        {QUEUES.map(([k, l]) => {
          const n = k === 'open' ? d?.counts.open : k === 'stale' ? d?.counts.stale : k === 'approval' ? d?.counts.approval : null;
          return (
            <button key={k} type="button" role="tab" aria-selected={queue === k} onClick={() => setQueue(k)}
              className={`inline-flex h-8 items-center gap-1 rounded-full border px-3 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${queue === k ? 'border-brand bg-brand text-white' : 'border-slate-300 bg-white text-navy-900 hover:border-brand hover:bg-brand-50'}`}>
              {l}{n ? <span className={`rounded-full px-1.5 text-xs ${queue === k ? 'bg-white/20' : k === 'stale' ? 'bg-amber-100 text-amber-900' : 'bg-slate-100'}`}>{n}</span> : null}
            </button>
          );
        })}
      </div>
      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-end gap-2" role="search" aria-label="Filter reports">
          <Field label="Account" className="w-44">
            <select className="input h-10" value={method} onChange={(e) => setMethod(e.target.value)}><option value="">All</option>{(d?.accounts || []).map((a) => <option key={a.method_id} value={a.method_id}>{a.name}</option>)}</select>
          </Field>
          <Field label="Donation no. or reference" className="w-64"><input className="input h-10" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
        </div>
      </Card>
      <Card>
        {loading && !data ? <Spinner /> : error ? <div className="p-5"><ErrorNote error={error} onRetry={reload} /></div> : rows.length === 0 ? (
          <EmptyState icon={CheckCircle2} title="Nothing here" description={queue === 'open' ? 'No donor reports are waiting to be verified.' : 'No reports in this list.'} />
        ) : (
          <Table>
            <thead className="bg-slate-50"><tr>
              <th className="th">Reported</th><th className="th">Donor</th><th className="th">Account</th><th className="th">Reported amount</th><th className="th">Reference and time sent</th><th className="th">Status</th><th className="th"><span className="sr-only">Actions</span></th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.donation_id} className="align-top">
                  <td className="td whitespace-nowrap"><Link to={`/donations/${r.donation_id}`} className="font-mono text-sm font-medium text-brand hover:underline">{r.donation_no}</Link>
                    <p className="text-xs text-slate-500">{formatDateTime(r.reported_at)}</p>
                    {r.stale && <p className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-amber-800"><Clock className="h-3 w-3" aria-hidden /> Stale</p>}</td>
                  <td className="td text-sm">{r.donor}{r.sender_hint && <p className="text-xs text-slate-500">Sender: {r.sender_hint}</p>}</td>
                  <td className="td text-sm">{r.method}</td>
                  <td className="td whitespace-nowrap tabular-nums text-navy-900">{formatMoney(r.amount)}<p className="text-xs text-slate-500">not counted yet</p></td>
                  <td className="td text-sm"><span className="font-mono">{r.reference}</span><p className="text-xs text-slate-500">{formatDateTime(r.sent_at)}</p>
                    {r.proofs > 0 && <p className="inline-flex items-center gap-1 text-xs text-slate-500"><Paperclip className="h-3 w-3" aria-hidden /> {r.proofs} proof file{r.proofs === 1 ? '' : 's'} (never proof of payment)</p>}</td>
                  <td className="td"><Badge tone={TONE[r.claim_status]}>{r.status_label}</Badge>{r.approval_kind && <p className="mt-1 text-xs text-slate-500">{r.approval_kind === 'amount_difference' ? 'Amount differs: Admin approves' : 'Second verifier needed'}</p>}</td>
                  <td className="td text-right">
                    <div className="flex flex-col items-end gap-1.5">
                      {['Reported', 'Details requested'].includes(r.claim_status) && <Button size="sm" onClick={() => setVerifying(r)}>Verify</Button>}
                      {['Reported', 'Details requested'].includes(r.claim_status) && <Button size="sm" variant="ghost" onClick={() => setMessage({ claim: r, kind: 'details' })}>Request details</Button>}
                      {r.claim_status === 'Awaiting approval' && <Link to={`/donations/${r.donation_id}`} className="text-sm font-medium text-brand hover:underline">Review approval</Link>}
                      {r.claim_status === 'Not matched' && <Button size="sm" variant="ghost" onClick={() => setMessage({ claim: r, kind: 'reopen' })}>Reopen</Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {rows.some((r) => r.donor_masked) && <p className="mt-2 flex items-center gap-1 text-xs text-slate-500"><AlertTriangle className="h-3 w-3" aria-hidden /> Donor names are masked: they need the Donor directory duty.</p>}
      {verifying && (
        <VerifyClaimModal claim={verifying} onClose={() => setVerifying(null)}
          onDone={(r) => done(r?.status === 'Awaiting approval' ? 'Recorded. It is waiting for approval before it counts.' : 'Verified. It now counts in the totals.')}
          onNotMatched={() => { setMessage({ claim: verifying, kind: 'not_matched' }); setVerifying(null); }}
          onRequestDetails={() => { setMessage({ claim: verifying, kind: 'details' }); setVerifying(null); }} />
      )}
      {message && <ClaimMessageModal claim={message.claim} kind={message.kind} onClose={() => setMessage(null)} onDone={() => done({ not_matched: 'Marked Not matched. The donor was notified.', details: 'Request sent to the donor.', reopen: 'Reopened.', note: 'Note added.' }[message.kind])} />}
    </>
  );
}
