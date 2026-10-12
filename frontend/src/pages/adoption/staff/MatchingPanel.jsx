import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, HelpCircle, Link2, Lock, XCircle } from 'lucide-react';
import { api } from '../../../api/client';
import { useApp } from '../../../context/AppContext';
import { formatDate, formatDateTime } from '../../../lib/format';
import { Badge, Button, Card, ErrorNote, Field, Modal, Spinner } from '../../../components/ui';
import { headersFor } from './common';

const RESULT = {
  match: [CheckCircle2, 'Match', 'text-emerald-700'],
  mismatch: [XCircle, 'Mismatch', 'text-red-700'],
  not_stated: [HelpCircle, 'Not stated', 'text-slate-500'],
};
const STATUS_TONE = { Proposed: 'blue', 'Under review': 'amber', Approved: 'green', 'NACC confirmed': 'green', Placed: 'slate', Withdrawn: 'slate' };
const FLOW = ['Proposed', 'Under review', 'Approved', 'NACC confirmed'];

/** Compatibility review: each item with an icon and a word. Mismatches are warnings, never an automatic rejection. */
export function CompatibilityList({ items }) {
  return (
    <ul className="divide-y divide-slate-100 text-sm">
      {items.map((c) => {
        const [Icon, word, cls] = RESULT[c.result] || RESULT.not_stated;
        return (
          <li key={c.key} className="flex flex-wrap items-start justify-between gap-2 py-1.5">
            <span className="min-w-0"><span className="font-medium text-navy-900">{c.label}</span><span className="block text-xs text-slate-600">{c.detail}</span></span>
            <span className={`inline-flex shrink-0 items-center gap-1 text-xs font-semibold ${cls}`}><Icon className="h-4 w-4" aria-hidden /> {word}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Blocks({ blocks, title }) {
  if (!blocks?.length) return null;
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900" role="status">
      <p className="flex items-center gap-1.5 font-semibold"><Lock className="h-4 w-4" aria-hidden /> {title}</p>
      <ul className="mt-1 list-disc pl-5">{blocks.map((b) => <li key={b.message || b}>{b.message || b}</li>)}</ul>
    </div>
  );
}

/** Propose a match: choose a ready child, see the hard blocks and the compatibility review, write the recommendation. */
function ProposeDialog({ app, children, onClose, onDone }) {
  const { toast } = useApp();
  const [childId, setChildId] = useState('');
  const [preview, setPreview] = useState(null);
  const [rec, setRec] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!childId) { setPreview(null); return; }
    let alive = true;
    api(`/adoptions/${app.application_id}/matching/preview?child_id=${encodeURIComponent(childId)}`, { headers: headersFor(app.application_id) })
      .then((r) => alive && setPreview(r.data)).catch((e) => alive && setError(e));
    return () => { alive = false; };
  }, [childId, app.application_id]);
  const mismatches = (preview?.compatibility || []).filter((c) => c.result === 'mismatch');
  const blocked = (preview?.child_blocks || []).length > 0;
  const ok = childId && preview && !blocked && rec.trim().length >= 20 && (!mismatches.length || reason.trim().length >= 10);
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await api(`/adoptions/${app.application_id}/matches`, { method: 'POST', headers: headersFor(app.application_id), body: { child_id: childId, recommendation: rec.trim(), mismatch_reason: reason.trim() || undefined } });
      toast('Match proposed. The administrator and assigned staff were notified.'); onDone();
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Propose a match" size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!ok} onClick={submit}>Propose match</Button></>}>
      <div className="space-y-4">
        <ErrorNote error={error} />
        <Field label="Child" required hint="Only children marked Available for adoption are listed. Children not ready show why.">
          <select className="input" value={childId} onChange={(e) => { setChildId(e.target.value); setError(null); }}>
            <option value="">Select...</option>
            {children.map((c) => <option key={c.child_id} value={c.child_id}>{c.full_name} ({c.child_id}, {c.age} yrs){c.ready ? '' : ' – not ready'}</option>)}
          </select>
        </Field>
        {childId && !preview && <Spinner />}
        {preview && (
          <>
            <Blocks blocks={preview.child_blocks} title="This child can't be matched yet" />
            {!blocked && (
              <div>
                <p className="mb-1 text-sm font-medium text-navy-900">Compatibility review</p>
                <CompatibilityList items={preview.compatibility} />
              </div>
            )}
          </>
        )}
        <Field label="Recommendation (the child's best interest)" required hint="At least 20 characters. Recorded with the match.">
          <textarea className="input" rows={3} maxLength={5000} value={rec} onChange={(e) => setRec(e.target.value)} />
        </Field>
        {mismatches.length > 0 && (
          <Field label={`Reason to continue despite ${mismatches.length === 1 ? 'the mismatch' : `${mismatches.length} mismatches`}`} required hint="At least 10 characters. Recorded and logged.">
            <textarea className="input" rows={2} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
      </div>
    </Modal>
  );
}

/** One step dialog: NACC (date + reference), approve (optional note), withdraw (reason). */
function StepDialog({ app, match, kind, onClose, onDone }) {
  const { toast } = useApp();
  const [v, setV] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const cfg = {
    approve: { title: 'Approve this match', path: 'approve', ok: true, label: 'Approve', toast: 'Match approved. The application is now "Child matched".' },
    nacc: { title: "Record NACC's referral or confirmation", path: 'nacc', ok: v.nacc_date && (v.nacc_reference || '').trim(), label: 'Record', toast: 'NACC confirmation recorded.' },
    withdraw: { title: ['Approved', 'NACC confirmed'].includes(match.status) ? 'Unmatch' : 'Withdraw this match', path: 'withdraw', ok: (v.reason || '').trim().length >= 10, label: 'Withdraw', toast: 'Match withdrawn. The child is available again.' },
  }[kind];
  const submit = async () => {
    setBusy(true); setError(null);
    try { await api(`/adoptions/${app.application_id}/matches/${match.match_id}/${cfg.path}`, { method: 'POST', headers: headersFor(app.application_id), body: v }); toast(cfg.toast); onDone(); }
    catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={cfg.title} size="md"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant={kind === 'withdraw' ? 'danger' : 'primary'} loading={busy} disabled={!cfg.ok} onClick={submit}>{cfg.label}</Button></>}>
      <div className="space-y-3 text-sm">
        <ErrorNote error={error} />
        {kind === 'approve' && <><p className="text-slate-600">The eligibility checks run again. The application moves to "Child matched" and the child's placement to Matched. CareSphere records the home's decision; NACC's referral or confirmation is recorded next.</p>
          <Field label="Note (optional)"><textarea className="input" rows={2} maxLength={2000} value={v.note || ''} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field></>}
        {kind === 'nacc' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Date" required><input className="input" type="date" max={new Date().toISOString().slice(0, 10)} value={v.nacc_date || ''} onChange={(e) => setV({ ...v, nacc_date: e.target.value })} /></Field>
            <Field label="NACC reference number" required><input className="input font-mono" maxLength={120} value={v.nacc_reference || ''} onChange={(e) => setV({ ...v, nacc_reference: e.target.value })} /></Field>
          </div>
        )}
        {kind === 'withdraw' && <>
          <p className="text-slate-600">{['Approved', 'NACC confirmed'].includes(match.status) ? 'The application records "Placement ended" and the child becomes available again.' : 'The child becomes available again.'} The history is kept.</p>
          <Field label="Reason" required hint="At least 10 characters."><textarea className="input" rows={2} maxLength={2000} value={v.reason || ''} onChange={(e) => setV({ ...v, reason: e.target.value })} /></Field></>}
      </div>
    </Modal>
  );
}

function MatchCard({ app, m, canApprove, onAction, busy }) {
  const active = FLOW.includes(m.status);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium text-navy-900">{m.child.full_name} <span className="font-mono text-xs text-slate-500">{m.child_id}</span>{m.child.age != null && <span className="text-xs text-slate-500"> · {m.child.age} yrs</span>}</p>
          <p className="text-xs text-slate-500">Proposed by {m.proposed_by_name || 'staff'} on {formatDateTime(m.proposed_at)}{m.approved_at ? ` · approved by ${m.approved_by_name || 'Admin'} on ${formatDate(m.approved_at)}` : ''}{m.nacc_date ? ` · NACC ${formatDate(m.nacc_date)}, ref ${m.nacc_reference}` : ''}</p>
        </div>
        <Badge tone={STATUS_TONE[m.status] || 'slate'}>{m.status}</Badge>
      </div>
      {active && (
        <ol className="flex flex-wrap gap-1 text-xs" aria-label="Match steps">
          {[...FLOW, 'Trial custody'].map((s, i) => {
            const idx = FLOW.indexOf(m.status);
            const state = i < idx ? 'done' : i === idx ? 'current' : 'next';
            return <li key={s} className={`rounded-full px-2 py-0.5 ${state === 'done' ? 'bg-emerald-50 text-emerald-800' : state === 'current' ? 'bg-navy-900 text-white' : 'bg-slate-100 text-slate-500'}`} aria-current={state === 'current' ? 'step' : undefined}>{s}</li>;
          })}
        </ol>
      )}
      <div><p className="text-xs font-medium uppercase tracking-wide text-slate-500">Recommendation</p><p className="whitespace-pre-line text-sm text-navy-900">{m.recommendation}</p></div>
      <div><p className="text-xs font-medium uppercase tracking-wide text-slate-500">Compatibility review</p><CompatibilityList items={m.compatibility} /></div>
      {m.mismatch_reason && <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900"><AlertTriangle className="mr-1 inline h-4 w-4" aria-hidden />Reason recorded for continuing despite the mismatch: {m.mismatch_reason}</p>}
      {m.end_reason && <p className="text-sm text-slate-600">Ended {formatDate(m.ended_at)}: {m.end_reason}</p>}
      {active && (
        <div className="flex flex-wrap gap-2">
          {m.status === 'Proposed' && <Button size="sm" loading={busy} onClick={() => onAction('review', m)}>Start review</Button>}
          {m.status === 'Under review' && canApprove && <Button size="sm" onClick={() => onAction('approve', m)}>Approve</Button>}
          {m.status === 'Under review' && !canApprove && <p className="text-xs text-slate-500">Waiting for an administrator to approve.</p>}
          {m.status === 'Approved' && canApprove && <Button size="sm" onClick={() => onAction('nacc', m)}>Record NACC referral or confirmation</Button>}
          {m.status === 'NACC confirmed' && <p className="text-xs text-slate-600">Next: record "Trial custody" through Update status.</p>}
          {(!['Approved', 'NACC confirmed'].includes(m.status) || canApprove) && <Button size="sm" variant="secondary" onClick={() => onAction('withdraw', m)}>{['Approved', 'NACC confirmed'].includes(m.status) ? 'Unmatch' : 'Withdraw'}</Button>}
        </div>
      )}
      {m.events.length > 0 && (
        <details className="text-xs"><summary className="cursor-pointer text-brand">History ({m.events.length})</summary>
          <ul className="mt-1 space-y-0.5 text-slate-600">{m.events.map((e, i) => <li key={i}>{formatDateTime(e.at)}: {e.event.replace(/_/g, ' ')}{e.to_status ? ` → ${e.to_status}` : ''}{e.by ? ` (${e.by})` : ''}{e.detail ? ` · ${e.detail}` : ''}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

/** Regular adoption: eligibility, the active match and its steps, proposing, and earlier matches. */
export function MatchingSection({ app, data, onChanged }) {
  const { toast } = useApp();
  const [dialog, setDialog] = useState(null); // { kind, match }
  const [busy, setBusy] = useState(false);
  const d = data.matching;
  const active = d.matches.find((m) => m.match_id === d.active_match_id);
  const past = d.matches.filter((m) => m.match_id !== d.active_match_id);
  const onAction = async (kind, m) => {
    if (kind === 'review') {
      setBusy(true);
      try { await api(`/adoptions/${app.application_id}/matches/${m.match_id}/review`, { method: 'POST', headers: headersFor(app.application_id) }); toast('Review started.'); onChanged(); }
      catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
      return;
    }
    setDialog({ kind, match: m });
  };
  const ready = d.children.filter((c) => c.ready).length;
  return (
    <Card className="space-y-3 p-4">
      <h3 className="font-semibold text-navy-900">Matching</h3>
      <p className="text-xs text-slate-500">CareSphere records the home's matching steps and NACC's decisions; it doesn't make them. Preferences guide the review and never decide a match alone.</p>
      {active ? <MatchCard app={app} m={active} canApprove={d.can_approve} onAction={onAction} busy={busy} /> : (
        <>
          <Blocks blocks={d.blocks} title="Matching can't start yet" />
          {!d.blocks.length && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-slate-700">{ready} child{ready === 1 ? ' is' : 'ren are'} ready to be matched{d.children.length > ready ? ` (${d.children.length - ready} more available but not ready)` : ''}.</span>
              <Button size="sm" disabled={!d.children.length} onClick={() => setDialog({ kind: 'propose' })}>Propose a match</Button>
            </div>
          )}
        </>
      )}
      {past.length > 0 && (
        <details className="rounded-lg border border-slate-200 p-3 text-sm"><summary className="cursor-pointer font-medium text-navy-900">Earlier matches ({past.length})</summary>
          <div className="mt-2 space-y-4 divide-y divide-slate-100">{past.map((m) => <div key={m.match_id} className="pt-3"><MatchCard app={app} m={m} canApprove={false} onAction={() => {}} /></div>)}</div>
        </details>
      )}
      {dialog?.kind === 'propose' && <ProposeDialog app={app} children={d.children} onClose={() => setDialog(null)} onDone={() => { setDialog(null); onChanged(); }} />}
      {dialog && dialog.kind !== 'propose' && <StepDialog app={app} match={dialog.match} kind={dialog.kind} onClose={() => setDialog(null)} onDone={() => { setDialog(null); onChanged(); }} />}
    </Card>
  );
}

/** Relative, Stepparent, Own non-marital child and Adult adoption: the child is known; link and verify. */
export function LinkSection({ app, data, onChanged }) {
  const { toast } = useApp();
  const l = data.link;
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ child_id: l.child_id || '', note: '' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await api(`/adoptions/${app.application_id}/link`, { method: 'POST', headers: headersFor(app.application_id), body: { child_id: v.child_id.trim() || undefined, note: v.note.trim() } }); toast('Recorded.'); setOpen(false); onChanged(); }
    catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Card className="space-y-3 p-4">
      <h3 className="flex items-center gap-2 font-semibold text-navy-900"><Link2 className="h-4 w-4 text-brand" aria-hidden /> Link and verify the child and relationship</h3>
      <p className="text-xs text-slate-500">In this category the child is already known, so there is no matching. Verify who the child is and the relationship from the documents.</p>
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
        <div><dt className="text-slate-500">Child</dt><dd className="text-navy-900">{l.adoptee_name || <span className="text-slate-400">Not answered</span>}</dd></div>
        <div><dt className="text-slate-500">Date of birth</dt><dd className="text-navy-900">{l.adoptee_dob ? formatDate(l.adoptee_dob) : <span className="text-slate-400">Not answered</span>}</dd></div>
        <div><dt className="text-slate-500">Relationship</dt><dd className="text-navy-900">{l.adoptee_relationship || <span className="text-slate-400">Not answered</span>}</dd></div>
      </dl>
      {l.verified_at ? (
        <p className="rounded-lg bg-emerald-50 p-2 text-sm text-emerald-900"><CheckCircle2 className="mr-1 inline h-4 w-4" aria-hidden />Verified by {l.verified_by_name || 'staff'} on {formatDate(l.verified_at)}{l.child_id ? ` · linked to child record ${l.child_id}` : ''}. {l.note}</p>
      ) : <p className="text-sm text-amber-800"><AlertTriangle className="mr-1 inline h-4 w-4" aria-hidden />Not verified yet.</p>}
      {!open ? <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>{l.verified_at ? 'Record again' : 'Record verification'}</Button> : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Child record ID (only if the child is in the home's care)"><input className="input font-mono" maxLength={50} value={v.child_id} onChange={(e) => setV({ ...v, child_id: e.target.value })} /></Field>
          <Field label="How it was verified" required hint="At least 10 characters, for example which documents were checked."><input className="input" maxLength={2000} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
          <div className="flex gap-2 sm:col-span-2"><Button size="sm" loading={busy} disabled={v.note.trim().length < 10} onClick={save}>Save</Button><Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button></div>
        </div>
      )}
    </Card>
  );
}
