import { useState } from 'react';
import { AlertTriangle, KeyRound, Lock, UserPlus } from 'lucide-react';
import useApi from '../../hooks/useApi';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Modal, Notice, Skeleton, Table } from '../ui';
import { formatDate, formatDateTime } from '../../lib/format';
import { ASSIGNMENT_TYPES, CORE_LOCKED } from '../../lib/childAccess';

const enc = encodeURIComponent;

/** A locked section: one line saying why, and what the person can do. */
export function LockedPlaceholder({ title, message = CORE_LOCKED, onRequest, pending }) {
  return (
    <Card className="p-6">
      <div className="flex flex-col items-center text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-navy-900"><Lock className="h-5 w-5 text-white" aria-hidden /></div>
        <p className="mt-3 font-semibold text-navy-900">{title}</p>
        <p className="mt-1 max-w-md text-sm text-slate-600">{message}</p>
        {pending && <p className="mt-2 text-xs text-slate-500">Your access request from {formatDateTime(pending.created_at)} is waiting for an Admin.</p>}
        {onRequest && (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {onRequest && !pending && <Button variant="secondary" onClick={onRequest}><KeyRound className="h-4 w-4" aria-hidden /> Request access</Button>}
          </div>
        )}
      </div>
    </Card>
  );
}

/** "Request access": the reason goes to the Admin and the case worker (the notification carries no names). */
export function RequestAccessModal({ childId, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const send = async () => {
    if (reason.trim().length < 10) { setError({ message: 'Explain why you need access (at least 10 characters).', details: { errors: { reason: 'At least 10 characters.' } } }); return; }
    setBusy(true); setError(null);
    try { const res = await api(`/children/${enc(childId)}/access-requests`, { method: 'POST', body: { reason: reason.trim() } }); onDone(res.message); }
    catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Request access" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={send}>Send request</Button></>}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">An Admin decides: they can assign you, give you a temporary cover with an end date, or say no. The case worker is told too.</p>
        <ErrorNote error={error && !error.details?.errors ? error : null} />
        <Field label="Why do you need access?" required error={error?.details?.errors?.reason}>
          <textarea className="input" rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}


const TYPE_TONE = { primary: 'blue', backup: 'slate', temporary: 'amber' };

/** Admin: add a primary case worker, backup or temporary cover (with dates). */
export function AssignmentModal({ title = 'Assign staff', onClose, onSave, defaultType = 'primary' }) {
  const staff = useApi('/assignments/staff?record_type=child');
  const [f, setF] = useState({ user_id: '', type: defaultType, starts_at: '', ends_at: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const save = async () => {
    setBusy(true); setError(null);
    try { await onSave({ ...f, user_id: Number(f.user_id) || null, starts_at: f.starts_at || undefined, ends_at: f.ends_at || undefined, note: f.note || undefined }); }
    catch (err) { setError(err); } finally { setBusy(false); }
  };
  const errs = error?.details?.errors || {};
  return (
    <Modal open onClose={onClose} title={title} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
      <div className="space-y-3">
        <ErrorNote error={error && !Object.keys(errs).length ? error : null} />
        <Field label="Staff member" required error={errs.user_id} hint="Active Staff with the Child records duty.">
          <select className="input" value={f.user_id} onChange={(e) => setF({ ...f, user_id: e.target.value })}>
            <option value="">Choose…</option>
            {(staff.data?.data || []).map((u) => <option key={u.user_id} value={u.user_id}>{u.full_name}</option>)}
          </select>
        </Field>
        <Field label="Type" required error={errs.type}>
          <select className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
            {Object.entries(ASSIGNMENT_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Starts" hint="Leave empty for now." error={errs.starts_at}><input type="date" className="input" value={f.starts_at} onChange={(e) => setF({ ...f, starts_at: e.target.value })} /></Field>
          <Field label="Ends" required={f.type === 'temporary'} error={errs.ends_at} hint={f.type === 'temporary' ? 'Access ends at the end of this day.' : 'Optional.'}>
            <input type="date" className="input" value={f.ends_at} onChange={(e) => setF({ ...f, ends_at: e.target.value })} />
          </Field>
        </div>
        {f.type === 'primary' && <p className="text-xs text-slate-500">A new primary case worker replaces the current one, whose access ends at once.</p>}
      </div>
    </Modal>
  );
}

function DecideRequest({ request, onClose, onDone }) {
  const [f, setF] = useState({ decision: 'assign', type: 'backup', ends_at: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const save = async () => {
    setBusy(true); setError(null);
    try { await api(`/access-requests/${request.request_id}/decision`, { method: 'POST', body: { ...f, ends_at: f.ends_at || undefined } }); onDone(); }
    catch (err) { setError(err); } finally { setBusy(false); }
  };
  const errs = error?.details?.errors || {};
  return (
    <Modal open onClose={onClose} title={`Access request from ${request.requested_by_name}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save decision</Button></>}>
      <div className="space-y-3">
        <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-navy-900">{request.reason}</p>
        <ErrorNote error={error && !Object.keys(errs).length ? error : null} />
        <fieldset className="space-y-1" aria-label="Decision">
          {[['assign', 'Assign them'], ['temporary_cover', 'Temporary cover with an end date'], ['deny', 'Deny']].map(([k, l]) => (
            <label key={k} className="flex items-center gap-2 text-sm"><input type="radio" name="decision" className="accent-brand" checked={f.decision === k} onChange={() => setF({ ...f, decision: k })} /> {l}</label>
          ))}
        </fieldset>
        {f.decision === 'assign' && (
          <Field label="As"><select className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="backup">Backup</option><option value="primary">Primary case worker</option></select></Field>
        )}
        {f.decision === 'temporary_cover' && (
          <Field label="Cover ends" required error={errs.ends_at}><input type="date" className="input" value={f.ends_at} onChange={(e) => setF({ ...f, ends_at: e.target.value })} /></Field>
        )}
        <Field label={f.decision === 'deny' ? 'Reason' : 'Note (optional)'} required={f.decision === 'deny'} error={errs.note}>
          <input className="input" maxLength={500} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

export function ReviewEmergency({ item, onClose, onDone }) {
  const [f, setF] = useState({ result: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const save = async () => {
    setBusy(true); setError(null);
    try { await api(`/emergency-access/${item.emergency_id}/review`, { method: 'POST', body: f }); onDone(); }
    catch (err) { setError(err); } finally { setBusy(false); }
  };
  const errs = error?.details?.errors || {};
  return (
    <Modal open onClose={onClose} title="Review emergency access" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save review</Button></>}>
      <div className="space-y-3 text-sm">
        <p><span className="font-mono">{item.child_id}</span> · {item.user_name} · {item.reason} · {formatDateTime(item.started_at)}</p>
        {item.note && <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3">{item.note}</p>}
        <ErrorNote error={error && !Object.keys(errs).length ? error : null} />
        <fieldset aria-label="Result" className="space-y-1">
          {['Justified', 'Not justified'].map((k) => <label key={k} className="flex items-center gap-2"><input type="radio" name="result" className="accent-brand" checked={f.result === k} onChange={() => setF({ ...f, result: k })} /> {k}</label>)}
          {errs.result && <p className="text-xs text-red-600">{errs.result}</p>}
        </fieldset>
        <Field label="Note" required error={errs.note} hint={f.result === 'Not justified' ? 'Not justified is flagged in the Audit log.' : undefined}>
          <textarea className="input" rows={2} maxLength={500} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

const END_REASON = { reassigned: 'Replaced', unassigned: 'Ended by Admin', cover_ended: 'Cover ended', account_deactivated: 'Account deactivated', duty_removed: 'Duty removed', ended: 'Ended' };

/** Access tab (Admin and the case worker): assignments with dates, requests, emergency access, access history. */
export function AccessTab({ childId, onChanged }) {
  const { toast } = useApp();
  const { data, loading, error, reload } = useApi(`/children/${enc(childId)}/access`);
  const [adding, setAdding] = useState(false);
  const [deciding, setDeciding] = useState(null);
  const [reviewing, setReviewing] = useState(null);
  const [changing, setChanging] = useState(null);
  if (loading && !data) return <Card className="p-5"><Skeleton rows={5} /></Card>;
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  const d = data.data;
  const manage = d.can_manage;
  const end = async (a) => {
    try { await api(`/assignments/${a.assignment_id}/end`, { method: 'POST' }); toast('Assignment ended. Their access ended at once.'); reload(); onChanged?.(); }
    catch (err) { toast(err.message, 'error'); }
  };
  const change = async (a, endsAt) => {
    try { await api(`/assignments/${a.assignment_id}`, { method: 'PUT', body: { ends_at: endsAt } }); toast('End date changed.'); setChanging(null); reload(); }
    catch (err) { toast(err.message, 'error'); }
  };
  return (
    <div className="space-y-4">
      {d.needs_reassignment.length > 0 && (
        <Notice tone="warning" title="Needs reassignment">{d.needs_reassignment.map((f) => f.reason.replace(/_/g, ' ')).join(', ')} · since {formatDate(d.needs_reassignment[0].flagged_at)}</Notice>
      )}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
          <h2 className="font-semibold text-navy-900">Assignments</h2>
          {manage && <Button size="sm" onClick={() => setAdding(true)}><UserPlus className="h-3.5 w-3.5" aria-hidden /> Assign staff</Button>}
        </div>
        {d.assignments.length === 0 ? <p className="p-4 text-sm text-slate-500">No one is assigned.</p> : (
          <Table label="Assignments">
            <thead className="bg-slate-50"><tr><th className="th">Staff</th><th className="th">Type</th><th className="th">From</th><th className="th">Until</th><th className="th">Assigned by</th><th className="th">Status</th>{manage && <th className="th"><span className="sr-only">Actions</span></th>}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {d.assignments.map((a) => (
                <tr key={a.assignment_id}>
                  <td className="td">{a.user_name}{!a.is_active && <Badge tone="red" className="ml-1">Deactivated</Badge>}</td>
                  <td className="td"><Badge tone={TYPE_TONE[a.assignment_type]}>{a.type_label}</Badge></td>
                  <td className="td whitespace-nowrap text-xs">{formatDateTime(a.starts_at)}</td>
                  <td className="td whitespace-nowrap text-xs">{a.ends_at ? formatDateTime(a.ends_at) : '-'}</td>
                  <td className="td text-xs">{a.assigned_by_name || (a.source === 'default_case_worker' ? 'Automatic (default case worker)' : a.source === 'migration' ? 'Moved from the earlier field' : '-')}</td>
                  <td className="td text-xs">{a.is_current ? <Badge tone="green">Current</Badge> : a.ended_at ? `${END_REASON[a.end_reason] || 'Ended'} ${formatDate(a.ended_at)}` : 'Not started'}</td>
                  {manage && (
                    <td className="td whitespace-nowrap text-right">
                      {!a.ended_at && a.assignment_type !== 'primary' && (changing === a.assignment_id
                        ? <input type="date" aria-label={`New end date for ${a.user_name}`} className="input h-8 w-36" onChange={(e) => e.target.value && change(a, e.target.value)} />
                        : <Button size="sm" variant="ghost" onClick={() => setChanging(a.assignment_id)}>Change end<span className="sr-only"> for {a.user_name}</span></Button>)}
                      {!a.ended_at && <Button size="sm" variant="ghost" onClick={() => end(a)}>End<span className="sr-only"> assignment of {a.user_name}</span></Button>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {d.initial_access && (
          <p className="px-4 pb-4 text-xs text-slate-500">
            Initial access for the registering staff member ({d.initial_access.user_name}): {formatDateTime(d.initial_access.starts_at)} to {formatDateTime(d.initial_access.ended_at || d.initial_access.ends_at)}
            {d.initial_access.end_reason ? ` (${d.initial_access.end_reason.replace(/_/g, ' ')})` : ' (open)'}.
          </p>
        )}
      </Card>

      <Card>
        <h2 className="px-4 pt-4 font-semibold text-navy-900">Access requests</h2>
        {d.requests.length === 0 ? <p className="p-4 text-sm text-slate-500">None.</p> : (
          <Table label="Access requests">
            <thead className="bg-slate-50"><tr><th className="th">When</th><th className="th">Staff</th><th className="th">Reason</th><th className="th">Decision</th>{manage && <th className="th"><span className="sr-only">Actions</span></th>}</tr></thead>
            <tbody className="divide-y divide-slate-100">{d.requests.map((r) => (
              <tr key={r.request_id}>
                <td className="td whitespace-nowrap text-xs">{formatDateTime(r.created_at)}</td><td className="td">{r.requested_by_name}</td>
                <td className="td max-w-xs whitespace-pre-wrap text-sm">{r.reason}</td>
                <td className="td text-sm">{r.status === 'Pending' ? <Badge tone="amber">Pending</Badge> : `${r.status}${r.decision ? ` (${r.decision.replace('_', ' ')})` : ''} by ${r.decided_by_name || '-'}${r.decision_note ? `: ${r.decision_note}` : ''}`}</td>
                {manage && <td className="td text-right">{r.status === 'Pending' && <Button size="sm" onClick={() => setDeciding(r)}>Decide<span className="sr-only"> request from {r.requested_by_name}</span></Button>}</td>}
              </tr>))}</tbody>
          </Table>
        )}
      </Card>

      {/* Emergency access was removed; earlier uses (if any) stay listed as history and can still be reviewed. */}
      {d.emergency.length > 0 && <Card>
        <h2 className="flex items-center gap-2 px-4 pt-4 font-semibold text-navy-900"><AlertTriangle className="h-4 w-4 text-red-600" aria-hidden /> Emergency access (earlier uses)</h2>
        {(
          <Table label="Emergency access">
            <thead className="bg-slate-50"><tr><th className="th">When</th><th className="th">Staff</th><th className="th">Reason</th><th className="th">Review</th>{manage && <th className="th"><span className="sr-only">Actions</span></th>}</tr></thead>
            <tbody className="divide-y divide-slate-100">{d.emergency.map((e) => (
              <tr key={e.emergency_id}>
                <td className="td whitespace-nowrap text-xs">{formatDateTime(e.started_at)}{e.active && <Badge tone="red" className="ml-1">Open</Badge>}</td><td className="td">{e.user_name}</td>
                <td className="td text-sm">{e.reason}{e.note ? `: ${e.note}` : ''}</td>
                <td className="td text-sm">{e.result ? <><Badge tone={e.result === 'Justified' ? 'green' : 'red'}>{e.result}</Badge> {e.review_note}</> : <Badge tone="amber">To review</Badge>}</td>
                {manage && <td className="td text-right">{!e.result && <Button size="sm" onClick={() => setReviewing(e)}>Review<span className="sr-only"> emergency access by {e.user_name}</span></Button>}</td>}
              </tr>))}</tbody>
          </Table>
        )}
      </Card>}

      <Card>
        <h2 className="px-4 pt-4 font-semibold text-navy-900">Access history</h2>
        {d.history.length === 0 && d.unlock_sessions.length === 0 ? <EmptyState title="Nothing yet" /> : (
          <Table label="Access history">
            <thead className="bg-slate-50"><tr><th className="th">When</th><th className="th">Who</th><th className="th">What</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {[...d.history.map((h) => ({ at: h.created_at, who: `${h.user_name || '-'}${h.user_role ? ` (${h.user_role})` : ''}`, what: h.label })),
                ...d.unlock_sessions.map((s) => ({ at: s.started_at, who: s.user_name, what: `Unlocked health and sensitive sections: ${s.purpose}${s.end_reason ? ` (${s.end_reason})` : ''}` }))]
                .sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 100)
                .map((x, i) => <tr key={i}><td className="td whitespace-nowrap text-xs">{formatDateTime(x.at)}</td><td className="td text-sm">{x.who}</td><td className="td text-sm">{x.what}</td></tr>)}
            </tbody>
          </Table>
        )}
      </Card>

      {adding && <AssignmentModal onClose={() => setAdding(false)} onSave={async (body) => {
        await api(`/children/${enc(childId)}/assignments`, { method: 'POST', body });
        setAdding(false); toast('Assignment saved.'); reload(); onChanged?.();
      }} />}
      {deciding && <DecideRequest request={deciding} onClose={() => setDeciding(null)} onDone={() => { setDeciding(null); toast('Decision saved.'); reload(); onChanged?.(); }} />}
      {reviewing && <ReviewEmergency item={reviewing} onClose={() => setReviewing(null)} onDone={() => { setReviewing(null); toast('Review saved.'); reload(); }} />}
    </div>
  );
}
