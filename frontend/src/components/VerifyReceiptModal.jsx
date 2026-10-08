import { useState } from 'react';
import { BadgeCheck, CircleAlert } from 'lucide-react';
import { api } from '../api/client';
import { Badge, Button, Field, Modal } from './ui';
import { formatDateTime, formatMoney } from '../lib/format';

const SOURCE_TONE = { Portal: 'blue', 'Walk-in': 'green', 'Staff recorded': 'slate' };

/**
 * "Verify a donation receipt": staff type or paste the code printed under the receipt's
 * QR image. No camera or photo scanning, so the browser never asks for camera access.
 * Esc closes and focus starts in the code box (handled by Modal).
 */
export default function VerifyReceiptModal({ open, onClose }) {
  const [code, setCode] = useState('');
  const [fieldError, setFieldError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { ok: true, data } | { ok: false, message }

  const close = () => { setCode(''); setFieldError(null); setResult(null); onClose(); };
  const again = () => { setCode(''); setFieldError(null); setResult(null); };

  const submit = async (e) => {
    e.preventDefault();
    // Printed codes can wrap onto two lines, so all whitespace is removed, not just the ends.
    const value = code.replace(/\s+/g, '');
    if (!value) { setFieldError('The receipt code is required.'); return; }
    setFieldError(null); setBusy(true);
    try {
      const res = await api(`/donations/verify/${encodeURIComponent(value)}`);
      setResult({ ok: true, data: res.data });
    } catch (err) {
      setResult({ ok: false, message: err.message || 'Code not found. Check that it was copied exactly.' });
    } finally { setBusy(false); }
  };

  const d = result?.ok ? result.data : null;
  return (
    <Modal open={open} onClose={close} title="Verify a donation receipt" size="sm"
      footer={result
        ? <><Button variant="secondary" onClick={again}>Verify another code</Button><Button onClick={close}>Done</Button></>
        : <><Button variant="secondary" onClick={close}>Cancel</Button><Button type="submit" form="verify-receipt-form" loading={busy} disabled={!code}>Submit code</Button></>}>
      {!result && (
        <form id="verify-receipt-form" onSubmit={submit} noValidate className="space-y-3">
          <Field label="Receipt code" required error={fieldError} hint="Enter the code printed on the receipt, under the QR image.">
            <textarea className={`input font-mono text-xs ${fieldError ? 'border-red-400 focus:border-red-500 focus:ring-red-200' : ''}`}
              rows={4} maxLength={200} value={code} required aria-invalid={!!fieldError || undefined}
              onChange={(e) => { setCode(e.target.value); if (fieldError && e.target.value.trim()) setFieldError(null); }}
              placeholder="Paste the code shown under the QR image" />
          </Field>
        </form>
      )}

      {d && (
        <div className="space-y-3 text-sm" role="status">
          <p className="flex items-center gap-2 font-medium text-emerald-700"><BadgeCheck className="h-5 w-5" aria-hidden /> Receipt #{d.receipt_no} is authentic</p>
          <dl className="divide-y divide-slate-100">
            {[
              ['Donor', <>{d.donor_name} <Badge tone={SOURCE_TONE[d.source_label]}>{d.source_label}</Badge></>],
              ...(d.walk_in_contact !== undefined ? [['Walk-in contact', d.walk_in_contact || '-']] : []),
              ['Amount', `${formatMoney(d.amount)} via ${d.payment_method}`],
              ['Status', d.status],
              ['Date', formatDateTime(d.created_at)],
            ].map(([label, value]) => (
              <div key={label} className="grid grid-cols-3 gap-3 py-2"><dt className="text-slate-500">{label}</dt><dd className="col-span-2 text-navy-900">{value}</dd></div>
            ))}
          </dl>
        </div>
      )}

      {result && !result.ok && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>{result.message}</p>
        </div>
      )}
    </Modal>
  );
}
