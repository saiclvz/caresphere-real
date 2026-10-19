import { useState } from 'react';
import { api } from '../../api/client';
import { Button, ErrorNote, Field, Modal, Notice } from '../ui';
import { formatDateTime, formatMoney, isoDate } from '../../lib/format';

/**
 * Verify a donor report: the verifier types what the HOME'S OWN account record shows (never copied from the report).
 * The server compares it; a reference or date mismatch blocks verifying; an amount difference needs a reason and an
 * Admin's approval; above the threshold a second verifier approves.
 */
export function VerifyClaimModal({ claim, onClose, onDone, onNotMatched, onRequestDetails }) {
  const [v, setV] = useState({ reference: '', amount: '', received_on: isoDate(), reason: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [mismatch, setMismatch] = useState(null);
  const [needReason, setNeedReason] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => { setV({ ...v, [k]: e.target.value }); setErrors({ ...errors, [k]: undefined }); setMismatch(null); };
  const save = async () => {
    setBusy(true); setError(null); setMismatch(null);
    try {
      const r = await api(`/donations/${claim.donation_id}/verify`, { method: 'POST', body: { reference: v.reference.trim(), amount: v.amount.trim().replace(/,/g, ''), received_on: v.received_on, reason: v.reason.trim() || undefined } });
      onDone(r.data);
    } catch (err) {
      if (err.details?.mismatch) setMismatch(err.details.mismatch);
      else {
        if (err.details?.amount_differs) setNeedReason(true);
        if (err.details?.errors) setErrors(err.details.errors);
        setError(err);
      }
    } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`Verify ${claim.donation_no}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Verify</Button></>}>
      <div className="space-y-4">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">The donor reported</p>
          <p className="mt-1 text-navy-900"><strong>{formatMoney(claim.amount ?? claim.reported_amount)}</strong> via {claim.method} · sent {formatDateTime(claim.sent_at)}</p>
          <p className="text-navy-900">Reference <span className="font-mono">{claim.reference}</span>{claim.sender_hint ? ` · from ${claim.sender_hint}` : ''}</p>
        </div>
        <Notice tone="info">Open the home's {claim.method} account (statement or app history) and type what it shows. Don't copy from the donor's report or proof.</Notice>
        <ErrorNote error={error} />
        {mismatch && (
          <Notice tone="warning" title="Verify is blocked">
            The {[mismatch.reference && 'reference number', mismatch.date && 'date'].filter(Boolean).join(' and ')} in the home account {mismatch.reference && mismatch.date ? "don't" : "doesn't"} match the report.
            Check again, or:
            <span className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={onNotMatched}>Mark Not matched</Button>
              <Button size="sm" variant="secondary" onClick={onRequestDetails}>Request details from the donor</Button>
            </span>
          </Notice>
        )}
        <Field label="Reference in the home account" required error={errors.reference}><input className="input font-mono" autoComplete="off" maxLength={60} value={v.reference} onChange={set('reference')} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amount received (PHP)" required error={errors.amount}><input className="input" inputMode="decimal" autoComplete="off" value={v.amount} onChange={set('amount')} /></Field>
          <Field label="Date received" required error={errors.received_on}><input className="input" type="date" max={isoDate()} value={v.received_on} onChange={set('received_on')} /></Field>
        </div>
        {(needReason || v.reason) && (
          <Field label="Reason the amount differs" required error={errors.reason} hint="The received amount is recorded separately; an administrator approves it.">
            <textarea className="input" rows={2} maxLength={500} value={v.reason} onChange={set('reason')} />
          </Field>
        )}
      </div>
    </Modal>
  );
}

/** Not matched (message to the donor), Request details (message to the donor), Reopen and internal notes. */
export function ClaimMessageModal({ claim, kind, onClose, onDone }) {
  const cfg = {
    not_matched: { title: `Mark ${claim.donation_no} Not matched`, path: 'not-matched', field: 'message', label: 'Message to the donor', hint: "Shown to the donor. Don't include internal notes.", button: 'Mark Not matched' },
    details: { title: `Request details for ${claim.donation_no}`, path: 'request-details', field: 'message', label: 'What the home needs from the donor', hint: 'Shown to the donor; they reply from Donation history.', button: 'Send request' },
    reopen: { title: `Reopen ${claim.donation_no}`, path: 'reopen', field: 'note', label: 'Why it is reopened', hint: 'Internal note (not shown to the donor).', button: 'Reopen' },
    note: { title: `Internal note on ${claim.donation_no}`, path: 'claim-notes', field: 'note', label: 'Note', hint: 'Never shown to the donor.', button: 'Add note' },
  }[kind];
  const [value, setValue] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setError(null);
    try { await api(`/donations/${claim.donation_id}/${cfg.path}`, { method: 'POST', body: { [cfg.field]: value.trim() } }); onDone(); }
    catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} size="sm" title={cfg.title}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!value.trim()} onClick={save}>{cfg.button}</Button></>}>
      <div className="space-y-3">
        <ErrorNote error={error} />
        <Field label={cfg.label} required hint={cfg.hint}><textarea className="input" rows={3} maxLength={500} value={value} onChange={(e) => setValue(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

/** Approve or decline an amount difference / second-verifier approval. */
export function DecideModal({ approval, donationNo, onClose, onDone }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const go = async (decision) => {
    setBusy(decision); setError(null);
    try { await api(`/donations/approvals/${approval.approval_id}`, { method: 'POST', body: { decision, note: note.trim() || undefined } }); onDone(decision); }
    catch (err) { setError(err); } finally { setBusy(null); }
  };
  return (
    <Modal open onClose={onClose} title={`${approval.kind === 'amount_difference' ? 'Amount difference' : 'Second verification'}: ${donationNo}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="secondary" loading={busy === 'decline'} onClick={() => go('decline')}>Decline</Button><Button loading={busy === 'approve'} onClick={() => go('approve')}>Approve</Button></>}>
      <div className="space-y-3 text-sm">
        <ErrorNote error={error} />
        <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1">
          <dt className="text-slate-500">Checked by</dt><dd className="text-navy-900">{approval.requested_by_name} · {formatDateTime(approval.requested_at)}</dd>
          <dt className="text-slate-500">Amount received</dt><dd className="font-semibold text-navy-900">{formatMoney(approval.verified_amount)}</dd>
          <dt className="text-slate-500">Reference</dt><dd className="font-mono text-navy-900">{approval.verified_reference}</dd>
          <dt className="text-slate-500">Date received</dt><dd className="text-navy-900">{String(approval.verified_received_on || '').slice(0, 10)}</dd>
          {approval.reason && <><dt className="text-slate-500">Reason</dt><dd className="text-navy-900">{approval.reason}</dd></>}
        </dl>
        <p className="text-slate-600">Check the home's account yourself before approving.</p>
        <Field label="Note" hint="Required when declining"><textarea className="input" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
