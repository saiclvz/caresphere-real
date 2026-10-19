import { useState } from 'react';
import { Coins } from 'lucide-react';
import useApi from '../../hooks/useApi';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useApp } from '../../context/AppContext';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Spinner, Table } from '../ui';
import { formatDate, formatDateTime, formatMoney, isoDate } from '../../lib/format';

/** Donations > Cash count: the cash counted each day against the cash donations recorded; an Admin signs it off. */
export default function CashCounts() {
  const { user } = useAuth();
  const { toast } = useApp();
  const { data, loading, error, reload } = useApi('/cash-counts');
  const [v, setV] = useState({ date: isoDate(), counted_cash: '', note: '' });
  const [errors, setErrors] = useState({});
  const [saveError, setSaveError] = useState(null);
  const [busy, setBusy] = useState(null);
  const d = data?.data;
  const submit = async (e) => {
    e.preventDefault();
    setBusy('save'); setSaveError(null); setErrors({});
    try {
      const r = await api('/cash-counts', { method: 'POST', body: { date: v.date, counted_cash: v.counted_cash.trim().replace(/,/g, ''), note: v.note.trim() || undefined } });
      toast(r.data.difference ? `Saved. Difference ${formatMoney(r.data.difference)}: an administrator will review it.` : 'Saved. The count matches the recorded cash.', 'success');
      setV({ ...v, counted_cash: '', note: '' }); reload();
    } catch (err) { if (err.details?.errors) setErrors(err.details.errors); setSaveError(err); } finally { setBusy(null); }
  };
  const signOff = async (c) => {
    setBusy(c.count_id);
    try { await api(`/cash-counts/${c.count_id}/sign-off`, { method: 'POST' }); toast('Signed off.', 'success'); reload(); }
    catch (err) { toast(err.message, 'error'); } finally { setBusy(null); }
  };
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  return (
    <div className="space-y-5">
      <Card className="p-4">
        <h2 className="font-semibold text-navy-900">Count the cash</h2>
        <p className="mt-1 text-sm text-slate-600">Today's cash donations recorded: <strong>{d.today.cash_donations}</strong>, totalling <strong>{formatMoney(d.today.expected_cash)}</strong>{d.today.counted ? ' · already counted today (saving again replaces it until signed off)' : ''}.</p>
        <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-2" noValidate>
          <Field label="Day" className="w-40" error={errors.date}><input className="input h-10" type="date" max={isoDate()} value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></Field>
          <Field label="Cash counted (PHP)" className="w-44" required error={errors.counted_cash}><input className="input h-10" inputMode="decimal" value={v.counted_cash} onChange={(e) => setV({ ...v, counted_cash: e.target.value })} /></Field>
          <Field label="Note" className="min-w-[14rem] flex-1" error={errors.note} hint="Required when the count differs"><input className="input h-10" maxLength={500} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
          <Button type="submit" loading={busy === 'save'}>Save count</Button>
        </form>
        {saveError && !Object.keys(errors).length && <div className="mt-2"><ErrorNote error={saveError} /></div>}
      </Card>
      <Card>
        {!d.rows.length ? <EmptyState icon={Coins} title="No cash counts yet" description="Counts from the last 60 days appear here." /> : (
          <Table>
            <thead className="bg-slate-50"><tr><th className="th">Day</th><th className="th">Recorded</th><th className="th">Counted</th><th className="th">Difference</th><th className="th">Counted by</th><th className="th">Sign-off</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {d.rows.map((c) => (
                <tr key={c.count_id} className="align-top">
                  <td className="td whitespace-nowrap">{formatDate(c.count_date)}</td>
                  <td className="td tabular-nums">{formatMoney(c.expected_cash)}</td>
                  <td className="td tabular-nums">{formatMoney(c.counted_cash)}</td>
                  <td className="td tabular-nums">{c.difference ? <Badge tone="red">{formatMoney(c.difference)}</Badge> : <Badge tone="green">None</Badge>}{c.note && <p className="mt-1 max-w-[16rem] text-xs text-slate-500">{c.note}</p>}</td>
                  <td className="td text-sm">{c.counted_by_name}<p className="text-xs text-slate-500">{formatDateTime(c.counted_at)}</p></td>
                  <td className="td text-sm">{c.signed_off_at ? <>{c.signed_off_by_name}<p className="text-xs text-slate-500">{formatDateTime(c.signed_off_at)}</p></> : c.can_sign && user.role === 'Admin' ? <Button size="sm" loading={busy === c.count_id} onClick={() => signOff(c)}>Sign off</Button> : <Badge tone="amber">Waiting for an Admin</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
