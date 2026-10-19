import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FileUp, Scale } from 'lucide-react';
import useApi from '../../hooks/useApi';
import { api, qs } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Modal, Notice, Spinner, Table } from '../ui';
import { formatDate, formatDateTime, formatMoney } from '../../lib/format';

const TONE = { Matched: 'green', 'Amount differs': 'amber', Unreported: 'red', 'Duplicate line': 'slate', Converted: 'blue', Dismissed: 'slate' };
const month = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

function ImportModal({ period, accounts, onClose, onDone }) {
  const [v, setV] = useState({ period, method_id: accounts[0]?.method_id || '', note: '' });
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const pick = (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    if (f.size > 1024 * 1024) { setError(new Error('The CSV file must be 1 MB or smaller.')); return; }
    const reader = new FileReader();
    reader.onload = () => { setFile({ name: f.name, csv: String(reader.result) }); setError(null); };
    reader.readAsText(f);
  };
  const save = async () => {
    setBusy(true); setError(null);
    try { const r = await api('/reconciliation/imports', { method: 'POST', body: { period: v.period, method_id: Number(v.method_id), csv: file?.csv, file_name: file?.name, note: v.note.trim() || undefined } }); onDone(r.data); }
    catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Import a statement" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!file || !v.method_id} onClick={save}>Import</Button></>}>
      <div className="space-y-3">
        <ErrorNote error={error} />
        {error?.details?.line_errors && <ul className="max-h-40 list-disc overflow-auto pl-5 text-xs text-red-700">{error.details.line_errors.map((l) => <li key={l}>{l}</li>)}</ul>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Month" required><input className="input" type="month" value={v.period} max={month()} onChange={(e) => setV({ ...v, period: e.target.value })} /></Field>
          <Field label="Account" required><select className="input" value={v.method_id} onChange={(e) => setV({ ...v, method_id: e.target.value })}>{accounts.map((a) => <option key={a.method_id} value={a.method_id}>{a.name}</option>)}</select></Field>
        </div>
        <Field label="Statement (CSV)" required hint="Exported from the home's bank or e-wallet. Needs Date, Reference and Amount columns. Up to 1 MB.">
          <input type="file" accept=".csv,text/csv" onChange={pick} className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-navy-900" />
        </Field>
        {file && <p className="text-xs text-slate-600">{file.name}</p>}
        <Field label="Note" hint="Optional"><input className="input" maxLength={500} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
        <p className="text-xs text-slate-500">Importing only compares. It never changes a verified donation.</p>
      </div>
    </Modal>
  );
}

function LineModal({ line, kind, purposes, onClose, onDone }) {
  const [v, setV] = useState({ as: 'anonymous', walk_in_name: '', purpose: purposes[0] || 'General support', note: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api(`/reconciliation/lines/${line.line_id}/${kind}`, { method: 'POST', body: kind === 'convert' ? { as: v.as, walk_in_name: v.walk_in_name.trim(), purpose: v.purpose } : { note: v.note.trim() } });
      onDone(r.data);
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} size="sm" title={kind === 'convert' ? 'Record this deposit as a donation' : 'Not a donation'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>{kind === 'convert' ? 'Record donation' : 'Dismiss'}</Button></>}>
      <div className="space-y-3 text-sm">
        <ErrorNote error={error} />
        <p className="text-navy-900"><strong>{formatMoney(line.amount)}</strong> on {formatDate(line.txn_date)} · ref. <span className="font-mono">{line.reference_raw}</span></p>
        {kind === 'convert' ? (
          <>
            <fieldset className="flex gap-4"><legend className="sr-only">Record as</legend>
              {[['anonymous', 'Anonymous donation'], ['walk_in', 'Walk-in donor (name known)']].map(([k, l]) => <label key={k} className="flex items-center gap-2"><input type="radio" className="h-4 w-4 accent-brand" checked={v.as === k} onChange={() => setV({ ...v, as: k })} /> {l}</label>)}
            </fieldset>
            {v.as === 'walk_in' && <Field label="Donor's name" required><input className="input" maxLength={100} value={v.walk_in_name} onChange={(e) => setV({ ...v, walk_in_name: e.target.value })} /></Field>}
            <Field label="Purpose"><select className="input" value={v.purpose} onChange={(e) => setV({ ...v, purpose: e.target.value })}>{purposes.map((p) => <option key={p}>{p}</option>)}</select></Field>
            <p className="text-xs text-slate-500">Above the dual-control amount, a second person confirms it before it counts.</p>
          </>
        ) : (
          <Field label="Why it is not a donation" required hint="For example a refund or the home's own transfer"><textarea className="input" rows={2} maxLength={500} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
        )}
      </div>
    </Modal>
  );
}

/** Donations > Reconciliation: the home's monthly statement against the donor reports. */
export default function Reconciliation({ onChanged }) {
  const { toast } = useApp();
  const [period, setPeriod] = useState(month());
  const [methodId, setMethodId] = useState('');
  const { data, loading, error, reload } = useApi(`/reconciliation${qs({ period, method_id: methodId })}`);
  const opts = useApi('/donations/options');
  const purposes = opts.data?.data?.purposes || ['General support'];
  const [importing, setImporting] = useState(false);
  const [lineAction, setLineAction] = useState(null);
  const r = data?.data;
  const lines = r?.lines || [];
  const unreported = lines.filter((l) => l.match_status === 'Unreported');
  const other = lines.filter((l) => l.match_status !== 'Unreported');

  return (
    <>
      <p className="mb-3 text-sm text-slate-600">Import the home's monthly statement for each QR account. CareSphere lists what matched, what donors reported that is not in the statement, and deposits nobody reported (which you can record as walk-in or anonymous donations).</p>
      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Month" className="w-44"><input className="input h-10" type="month" max={month()} value={period} onChange={(e) => setPeriod(e.target.value || month())} /></Field>
          <Field label="Account" className="w-44"><select className="input h-10" value={methodId} onChange={(e) => setMethodId(e.target.value)}><option value="">All</option>{(r?.accounts || []).map((a) => <option key={a.method_id} value={a.method_id}>{a.name}</option>)}</select></Field>
          <Button className="ml-auto" onClick={() => setImporting(true)} disabled={!r?.accounts?.length}><FileUp className="h-4 w-4" aria-hidden /> Import statement</Button>
        </div>
      </Card>
      {loading && !data ? <Spinner /> : error ? <ErrorNote error={error} onRetry={reload} /> : !r.imports.length ? (
        <Card><EmptyState icon={Scale} title="No statement imported for this month" description="Import the CSV statement from the home's bank or e-wallet account." /></Card>
      ) : (
        <div className="space-y-5">
          <Card>
            <h2 className="px-4 pt-4 font-semibold text-navy-900">Deposits nobody reported <Badge tone={unreported.length ? 'red' : 'green'}>{unreported.length}</Badge></h2>
            {unreported.length === 0 ? <p className="px-4 pb-4 pt-1 text-sm text-slate-500">Every deposit in the statement matched a report or was reviewed.</p> : (
              <Table>
                <thead className="bg-slate-50"><tr><th className="th">Date</th><th className="th">Reference</th><th className="th">Amount</th><th className="th"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {unreported.map((l) => (
                    <tr key={l.line_id}>
                      <td className="td whitespace-nowrap">{formatDate(l.txn_date)}</td><td className="td font-mono text-sm">{l.reference_raw}</td><td className="td tabular-nums">{formatMoney(l.amount)}</td>
                      <td className="td text-right"><div className="flex justify-end gap-1.5"><Button size="sm" onClick={() => setLineAction({ line: l, kind: 'convert' })}>Record donation</Button><Button size="sm" variant="ghost" onClick={() => setLineAction({ line: l, kind: 'dismiss' })}>Not a donation</Button></div></td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
          <Card>
            <h2 className="px-4 pt-4 font-semibold text-navy-900">Reported but not in the statement <Badge tone={r.reported_not_in_statement.length ? 'amber' : 'green'}>{r.reported_not_in_statement.length}</Badge></h2>
            {r.reported_not_in_statement.length === 0 ? <p className="px-4 pb-4 pt-1 text-sm text-slate-500">Every report for this month is in an imported statement.</p> : (
              <Table>
                <thead className="bg-slate-50"><tr><th className="th">Donation</th><th className="th">Account</th><th className="th">Reference</th><th className="th">Reported</th><th className="th">Verified</th><th className="th">Status</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {r.reported_not_in_statement.map((m) => (
                    <tr key={m.donation_id}>
                      <td className="td"><Link to={`/donations/${m.donation_id}`} className="font-mono text-sm font-medium text-brand hover:underline">{m.donation_no}</Link><p className="text-xs text-slate-500">{formatDateTime(m.sent_at)}</p></td>
                      <td className="td text-sm">{m.method}</td><td className="td font-mono text-sm">{m.reference_raw}</td>
                      <td className="td tabular-nums">{formatMoney(m.reported_amount)}</td><td className="td tabular-nums">{m.verified_amount === null ? '-' : formatMoney(m.verified_amount)}</td>
                      <td className="td"><Badge tone={m.claim_status === 'Verified' ? 'red' : 'amber'}>{m.claim_status === 'Verified' ? 'Verified: check it' : m.claim_status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
          <Card>
            <h2 className="px-4 pt-4 font-semibold text-navy-900">Statement lines</h2>
            <Table>
              <thead className="bg-slate-50"><tr><th className="th">Date</th><th className="th">Reference</th><th className="th">Amount</th><th className="th">Result</th><th className="th">Donation</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {other.map((l) => (
                  <tr key={l.line_id}>
                    <td className="td whitespace-nowrap">{formatDate(l.txn_date)}</td><td className="td font-mono text-sm">{l.reference_raw}</td><td className="td tabular-nums">{formatMoney(l.amount)}</td>
                    <td className="td"><Badge tone={TONE[l.match_status]}>{l.match_status}</Badge>{l.review_note && <p className="mt-1 text-xs text-slate-500">{l.review_note}{l.reviewed_by_name ? ` (${l.reviewed_by_name})` : ''}</p>}</td>
                    <td className="td">{l.donation_id ? <Link to={`/donations/${l.donation_id}`} className="font-mono text-sm text-brand hover:underline">{l.donation_no}</Link> : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
          <Card className="p-4">
            <h2 className="font-semibold text-navy-900">Import log</h2>
            <ul className="mt-2 space-y-1 text-sm text-slate-700">
              {r.imports.map((i) => <li key={i.import_id}>{formatDateTime(i.imported_at)} · {i.method} · {i.line_count} line{i.line_count === 1 ? '' : 's'}{i.file_name ? ` · ${i.file_name}` : ''} · by {i.imported_by_name}{i.note ? ` · ${i.note}` : ''}</li>)}
            </ul>
          </Card>
        </div>
      )}
      {importing && <ImportModal period={period} accounts={r?.accounts || []} onClose={() => setImporting(false)} onDone={(x) => { setImporting(false); toast(`Imported: ${x.summary.Matched} matched, ${x.summary['Amount differs']} amount differs, ${x.summary.Unreported} unreported.`, 'success'); reload(); }} />}
      {lineAction && <LineModal {...lineAction} purposes={purposes} onClose={() => setLineAction(null)} onDone={(x) => { setLineAction(null); toast(lineAction.kind === 'convert' ? (x?.dual_control ? 'Recorded. A second person must confirm it before it counts.' : 'Recorded as a donation.') : 'Dismissed.', 'success'); reload(); onChanged?.(); }} />}
      {r && !r.accounts?.length && <Notice tone="info" className="mt-4">No QR accounts are set up yet (Settings &gt; Payment QR).</Notice>}
    </>
  );
}
