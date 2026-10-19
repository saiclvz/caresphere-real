import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Eye } from 'lucide-react';
import useApi from '../hooks/useApi';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Badge, Button, Card, ErrorNote, Skeleton, Table, TAB_ROW, tabClass } from '../components/ui';
import { inKindTotal, typeMethod } from '../lib/donations';
import { formatDate, formatDateTime, formatMoney } from '../lib/format';
import { AmountCell, StatusBadge } from './Donations';
import NotFound from './NotFound';

const TABS = [['overview', 'Overview'], ['donations', 'Donations'], ['documents', 'Documents'], ['utilization', 'Utilization'], ['communication', 'Communication'], ['audit', 'Audit history']];
const Stat = ({ label, value, sub }) => <div className="rounded-xl border border-slate-200/70 bg-white p-4 shadow-card"><p className="text-xs font-medium text-slate-500">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums text-navy-900">{value}</p>{sub && <p className="text-xs text-slate-500">{sub}</p>}</div>;

/** Donor profile (Admin and Donor directory duty). Contact details are masked until Reveal, which is logged. */
export default function DonorProfile() {
  const { id } = useParams();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'overview';
  const { data, loading, error, reload } = useApi(`/donor-records/${id}`);
  const [revealed, setRevealed] = useState(null);
  const [revealError, setRevealError] = useState(null);
  const [busy, setBusy] = useState(false);
  if (error?.status === 404) return <NotFound />;
  if (error && !data) return <ErrorNote error={error} onRetry={reload} />;
  if (loading && !data) return <Skeleton rows={8} />;
  const r = data.data;
  const o = r.overview;
  const reveal = async () => {
    setBusy(true); setRevealError(null);
    try { setRevealed((await api(`/donor-records/${id}/reveal`, { method: 'POST' })).data); } catch (err) { setRevealError(err); } finally { setBusy(false); }
  };
  const tabs = TABS.filter(([k]) => k !== 'audit' || user.role === 'Admin');
  return (
    <>
      <Link to="/donors" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-navy-900"><ArrowLeft className="h-4 w-4" aria-hidden /> Donors</Link>
      <div className="mb-4 mt-1 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-semibold text-navy-900">{r.display_name}</h1><span className="font-mono text-sm text-slate-500">{r.donor_code}</span>
            <Badge tone="slate">{r.donor_type}</Badge>{r.has_account && <Badge tone="blue">Donor account</Badge>}{r.possible_duplicate && <Badge tone="amber"><AlertTriangle className="mr-1 inline h-3 w-3" aria-hidden />Possible duplicate</Badge>}</div>
          <p className="mt-1 text-sm text-slate-600">
            Contact: {revealed ? [revealed.contact, revealed.email].filter(Boolean).join(' · ') || 'none recorded' : [r.contact, r.email].filter(Boolean).join(' · ') || 'none recorded'}
            {!revealed && (r.contact || r.email) && <Button size="sm" variant="ghost" className="ml-2" loading={busy} onClick={reveal}><Eye className="h-3.5 w-3.5" aria-hidden /> Reveal</Button>}
          </p>
          {revealed && <p className="text-xs text-slate-500">Revealed. This was recorded in the audit log.</p>}
          <ErrorNote error={revealError} />
        </div>
      </div>
      <div role="tablist" aria-label="Donor sections" className={TAB_ROW}>
        {tabs.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setParams({ tab: k }, { replace: true })}
          className={tabClass(tab === k)}>{l}</button>)}
      </div>
      <div role="tabpanel">
        {tab === 'overview' && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Total donated (cash)" value={formatMoney(o.cash_total)} sub={`${o.cash_count} cash donation${o.cash_count === 1 ? '' : 's'}`} />
            <Stat label="In-kind (estimated)" value={inKindTotal(o.in_kind_count, o.in_kind_value, formatMoney)} sub={o.in_kind_no_value ? `${o.in_kind_count} gift(s), ${o.in_kind_no_value} with no value yet` : `${o.in_kind_count} gift(s)`} />
            <Stat label="Donations" value={o.donation_count} sub="verified or accepted" />
            <Stat label="First and last donation" value={o.last_donation_at ? formatDate(o.last_donation_at) : '-'} sub={o.first_donation_at ? `first ${formatDate(o.first_donation_at)}` : null} />
            <p className="col-span-full text-xs text-slate-500">Totals leave out voided donations, and gifts given anonymously (they never appear on a donor's profile).</p>
          </div>
        )}
        {tab === 'donations' && (
          <Card>{r.donations.length === 0 ? <p className="p-4 text-sm text-slate-500">No donations.</p> : (
            <Table label="Donations"><thead className="bg-slate-50"><tr><th className="th">Donation</th><th className="th">Type</th><th className="th text-right">Amount or value</th><th className="th">Purpose</th><th className="th">Status</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{r.donations.map((d) => (
                <tr key={d.donation_id}><td className="td"><Link to={`/donations/${d.donation_id}`} className="font-mono text-brand hover:underline">{d.donation_no}</Link><p className="text-xs text-slate-500">{formatDateTime(d.created_at)}</p></td>
                  <td className="td">{typeMethod(d)}</td><td className="td text-right"><AmountCell d={d} /></td><td className="td">{d.purpose || '-'}</td>
                  <td className="td"><StatusBadge status={d.status} />{d.status === 'Voided' && <p className="text-xs text-red-700">{d.void_reason}</p>}</td></tr>))}</tbody>
            </Table>)}</Card>
        )}
        {tab === 'documents' && (
          <Card className="space-y-3 p-4">
            <h3 className="font-semibold text-navy-900">Acknowledgments issued</h3>
            {r.documents.acknowledgments.length === 0 ? <p className="text-sm text-slate-500">None.</p> : <ul className="text-sm">{r.documents.acknowledgments.map((k) => <li key={`${k.donation_id}-${k.version}`}><Link to={`/donations/${k.donation_id}?tab=documents`} className="font-mono text-brand hover:underline">{k.donation_no}</Link> · version {k.version} · {formatDateTime(k.issued_at)}</li>)}</ul>}
            <h3 className="font-semibold text-navy-900">Files</h3>
            {r.documents.files.length === 0 ? <p className="text-sm text-slate-500">None.</p> : <ul className="text-sm">{r.documents.files.map((x) => <li key={x.document_id}><Link to={`/donations/${x.donation_id}?tab=documents`} className="font-mono text-brand hover:underline">{x.donation_no}</Link> · {x.label} · {formatDate(x.uploaded_at)}</li>)}</ul>}
          </Card>
        )}
        {tab === 'utilization' && (
          <Card className="p-4">{r.utilization.length === 0 ? <p className="text-sm text-slate-500">Nothing recorded yet.</p> : (
            <ul className="divide-y divide-slate-100 text-sm">{r.utilization.map((u, i) => <li key={i} className="py-2"><Link to={`/donations/${u.donation_id}?tab=utilization`} className="font-mono text-brand hover:underline">{u.donation_no}</Link> · {u.kind === 'utilization' ? formatMoney(u.amount) : `${u.item_name} x${u.quantity}`} · {u.program} · {formatDate(u.used_on)}</li>)}</ul>)}</Card>
        )}
        {tab === 'communication' && (
          <Card className="p-4">
            <p className="text-sm text-slate-600">{r.communication.acknowledgments} acknowledgment(s) issued.{!r.has_account && ' Walk-in donors have no portal account, so nothing is sent to them in the app.'}</p>
            {r.communication.notifications.length > 0 && <ul className="mt-2 divide-y divide-slate-100 text-sm">{r.communication.notifications.map((n, i) => <li key={i} className="py-1.5">{n.title} <span className="text-xs text-slate-500">· {formatDateTime(n.created_at)}{n.is_read ? ' · read' : ''}</span></li>)}</ul>}
          </Card>
        )}
        {tab === 'audit' && (
          <Card>{(r.audit || []).length === 0 ? <p className="p-4 text-sm text-slate-500">No entries.</p> : (
            <Table label="Audit history"><thead className="bg-slate-50"><tr><th className="th">When</th><th className="th">Who</th><th className="th">Action</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{r.audit.map((x, i) => <tr key={i}><td className="td whitespace-nowrap text-xs">{formatDateTime(x.created_at)}</td><td className="td text-sm">{x.user_name}</td><td className="td font-mono text-xs">{x.action_performed}</td></tr>)}</tbody>
            </Table>)}</Card>
        )}
      </div>
    </>
  );
}
