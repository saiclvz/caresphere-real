import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, FileHeart, GraduationCap, HeartPulse, ShieldCheck } from 'lucide-react';
import useApi from '../../hooks/useApi';
import { api, qs } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { Badge, Button, Card, ErrorNote, Field, Spinner, Table } from '../ui';

const AREAS = [
  { key: 'health', label: 'Health', icon: HeartPulse, what: 'children (case worker)' },
  { key: 'adoption', label: 'Adoption', icon: FileHeart, what: 'adoption applications' },
  { key: 'transition', label: 'Transition', icon: GraduationCap, what: 'transition reviews' },
];

/** Select records, choose a staff member (or nobody), Assign. Uses the same assignment logic as the record pages. */
function AssignBar({ area, selected, staff, onDone }) {
  const { toast } = useApp();
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const assign = async () => {
    setBusy(true);
    try {
      await api('/record-access/assign', { method: 'POST', body: { area, ids: selected, staff_user_id: to === 'none' ? null : Number(to) } });
      toast(`${selected.length} record${selected.length === 1 ? '' : 's'} updated. Assigned staff were notified.`); setTo(''); onDone();
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  if (!selected.length) return null;
  return (
    <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 bg-slate-50 px-4 py-2">
      <span className="pb-2 text-sm text-slate-600">{selected.length} selected</span>
      <Field label="Assign to"><select className="input h-9 w-52" value={to} onChange={(e) => setTo(e.target.value)}>
        <option value="">Choose...</option><option value="none">Nobody (unassign)</option>{staff.map((s) => <option key={s.user_id} value={s.user_id}>{s.full_name}</option>)}
      </select></Field>
      <Button size="sm" disabled={!to} loading={busy} onClick={assign}>Save</Button>
    </div>
  );
}

/** A list of records (reference or case numbers only) with checkboxes for bulk assignment. */
function RecordList({ area, items, staff, onChanged, empty }) {
  const [selected, setSelected] = useState([]);
  const toggle = (id) => setSelected((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  if (!items.length) return <p className="px-4 py-3 text-sm text-slate-500">{empty}</p>;
  return (
    <>
      <ul className="divide-y divide-slate-100">
        {items.map((r) => (
          <li key={`${area}-${r.id}`} className="flex items-center gap-3 px-4 py-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-brand" checked={selected.includes(String(r.id))} onChange={() => toggle(String(r.id))} aria-label={`Select ${r.ref}`} />
            <Link to={r.link} className="font-mono text-brand hover:underline">{r.ref}</Link>
            {r.status && <span className="text-xs text-slate-500">{r.status}</span>}
            {r.needs_reassignment && <Badge tone="amber">Needs reassignment</Badge>}
          </li>
        ))}
      </ul>
      <AssignBar area={area} selected={selected} staff={staff} onDone={() => { setSelected([]); onChanged(); }} />
    </>
  );
}

/**
 * Record access (Admin): who is assigned to which health, adoption and transition records, with
 * unassigned lists and bulk assignment. Reference and case numbers only. Staff still need the purpose
 * step and QR token to open any sensitive data; this page doesn't change that. Viewing it is logged.
 */
export default function RecordAccess() {
  const [area, setArea] = useState('');
  const [userId, setUserId] = useState('');
  const [open, setOpen] = useState(null);
  const { data, loading, error, reload } = useApi(`/record-access${qs({ area: area || undefined, user_id: userId || undefined })}`);
  const d = data?.data;
  const shown = AREAS.filter((a) => !area || a.key === area);
  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 text-xs text-slate-500"><ShieldCheck className="h-4 w-4 shrink-0 text-brand" aria-hidden />
        Assigning a record lets that staff member start the unlock flow (purpose step, QR token, 3-minute access). It doesn't open any data by itself.</p>
      <Card className="flex flex-wrap items-end gap-3 p-4">
        <Field label="Area"><select className="input h-10 w-44" value={area} onChange={(e) => setArea(e.target.value)}><option value="">All areas</option>{AREAS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}</select></Field>
        <Field label="Staff member"><select className="input h-10 w-56" value={userId} onChange={(e) => setUserId(e.target.value)}><option value="">Everyone</option>{(d?.all_staff || []).map((s) => <option key={s.user_id} value={s.user_id}>{s.full_name}</option>)}</select></Field>
      </Card>
      {loading && !data ? <Spinner /> : error ? <ErrorNote error={error} onRetry={reload} /> : (
        <>
          <Card>
            <Table>
              <thead className="bg-slate-50"><tr>
                <th className="th"><span className="sr-only">Expand</span></th><th className="th">Staff member</th>
                {shown.map((a) => <th key={a.key} className="th">{a.label}</th>)}<th className="th">Active sessions now</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {d.staff.map((s) => (
                  <Fragment key={s.user_id}>
                    <tr>
                      <td className="td w-8"><button type="button" aria-expanded={open === s.user_id} aria-label={`Show ${s.full_name}'s records`} onClick={() => setOpen(open === s.user_id ? null : s.user_id)} className="rounded p-1 hover:bg-slate-100">
                        {open === s.user_id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button></td>
                      <td className="td font-medium text-navy-900">{s.full_name}</td>
                      {shown.map((a) => <td key={a.key} className="td">{s.counts[a.key]}</td>)}
                      <td className="td">{s.active_sessions ? <Badge tone="amber">{s.active_sessions}</Badge> : 0}</td>
                    </tr>
                    {open === s.user_id && (
                      <tr><td colSpan={shown.length + 3} className="bg-slate-50/60 p-0">
                        {shown.map((a) => (
                          <div key={a.key} className="border-t border-slate-100">
                            <p className="flex items-center gap-1.5 px-4 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500"><a.icon className="h-3.5 w-3.5" aria-hidden /> {a.label}</p>
                            <RecordList area={a.key} items={s.records.filter((r) => r.area === a.key)} staff={d.all_staff} onChanged={reload} empty={`No ${a.what} assigned.`} />
                          </div>
                        ))}
                      </td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </Table>
            {d.staff.length === 0 && <p className="p-4 text-sm text-slate-500">No active Staff accounts.</p>}
          </Card>
          <div className="grid gap-4 lg:grid-cols-3">
            {shown.map((a) => (
              <Card key={a.key}>
                <h2 className="flex items-center gap-2 px-4 pt-4 font-semibold text-navy-900"><a.icon className="h-4 w-4 text-brand" aria-hidden /> Unassigned: {a.label}
                  <Badge tone={(d.unassigned[a.key] || []).length ? 'amber' : 'green'}>{(d.unassigned[a.key] || []).length}</Badge></h2>
                <RecordList area={a.key} items={d.unassigned[a.key] || []} staff={d.all_staff} onChanged={reload} empty="Everything has someone assigned." />
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
