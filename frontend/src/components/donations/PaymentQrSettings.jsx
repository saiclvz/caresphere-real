import { useState } from 'react';
import { AlertTriangle, CheckCircle2, History, Plus, Printer, QrCode, ShieldAlert } from 'lucide-react';
import useApi from '../../hooks/useApi';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Modal, Notice, Spinner } from '../ui';
import SignedImage from './SignedImage';
import ReauthModal from './ReauthModal';
import { checkFile, MB, readFile } from '../../lib/files';
import { formatDate, formatDateTime } from '../../lib/format';

const GROUPS = ['E-wallet', 'Bank transfer'];
const NAME_CHECK = {
  match: { tone: 'success', text: 'The name inside the QR matches the account name.' },
  mismatch: { tone: 'warning', text: "The name inside the QR doesn't match the account name you typed." },
  no_name: { tone: 'warning', text: 'This QR Ph code has no merchant name to compare.' },
  not_qrph: { tone: 'info', text: 'This is not a QR Ph (EMV) code, so the name could not be checked. Make sure it is the official QR from the bank or e-wallet.' },
};

/** Add a method, or change the QR or details of one. Every change needs a reason and re-authentication. */
function ChangeEditor({ method, onClose, onDone }) {
  const { toast } = useApp();
  const [v, setV] = useState({
    label: method?.label || '', method_group: method?.method_group || 'E-wallet', account_name: method?.account_name || '', account_number: method?.account_number || '',
    bank_name: method?.bank_name || '', instructions: method?.instructions || '', reason: '',
  });
  const [image, setImage] = useState(null);
  const [preview, setPreview] = useState(null);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [mismatch, setMismatch] = useState(null);
  const [busy, setBusy] = useState(null);
  const [reauth, setReauth] = useState(false);
  const set = (k) => (e) => { setV({ ...v, [k]: e.target.value }); setErrors({ ...errors, [k]: undefined }); if (k === 'account_name') { setPreview(null); setMismatch(null); } };
  const pick = async (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    setPreview(null); setMismatch(null);
    if (!f) return;
    const problem = checkFile(f, { types: ['image/png', 'image/jpeg'], maxBytes: 1 * MB });
    if (problem) { setErrors({ ...errors, image: problem }); setImage(null); return; }
    setErrors({ ...errors, image: undefined });
    setImage(await readFile(f));
  };
  const check = async () => {
    if (!image) { setErrors({ ...errors, image: 'Choose the QR image (PNG or JPG, up to 1 MB).' }); return; }
    setBusy('preview'); setError(null);
    try { const r = await api('/payment-qr/preview', { method: 'POST', body: { image, account_name: v.account_name } }); setPreview(r.data); }
    catch (err) { if (err.details?.errors) setErrors(err.details.errors); setError(err); setPreview(null); } finally { setBusy(null); }
  };
  const submit = async (grant, confirmMismatch = false) => {
    setBusy('save'); setError(null);
    try {
      const r = await api('/payment-qr/changes', { method: 'POST', headers: { 'X-Reauth': grant }, body: { ...v, method_id: method?.method_id, image, confirm_mismatch: confirmMismatch || undefined } });
      setReauth(false);
      toast(r.data.status === 'Pending' ? 'Saved. Another administrator must approve it before donors see it.' : 'Saved. Donors now see the new QR. All administrators were notified.', 'success');
      onDone();
    } catch (err) {
      setReauth(false);
      if (err.details?.name_mismatch) setMismatch(err.details);
      else { if (err.details?.errors) setErrors(err.details.errors); setError(err); }
    } finally { setBusy(null); }
  };
  const [confirmAnyway, setConfirmAnyway] = useState(false);
  return (
    <Modal open onClose={onClose} size="lg" title={method ? `Change ${method.label}: QR or details` : 'Add a QR method'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy === 'save'} disabled={!image || !preview} onClick={() => { setConfirmAnyway(false); setReauth(true); }}>Save change</Button></>}>
      <div className="space-y-4">
        <ErrorNote error={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Label donors see" required error={errors.label}><input className="input" maxLength={60} value={v.label} onChange={set('label')} placeholder="GCash" /></Field>
          <Field label="Type" required error={errors.method_group}><select className="input" value={v.method_group} onChange={set('method_group')}>{GROUPS.map((g) => <option key={g}>{g}</option>)}</select></Field>
          <Field label="Account name (exactly as donors see it in their app)" required error={errors.account_name}><input className="input" maxLength={120} value={v.account_name} onChange={set('account_name')} /></Field>
          <Field label="Account or mobile number" error={errors.account_number} hint="Optional"><input className="input font-mono" maxLength={60} value={v.account_number} onChange={set('account_number')} /></Field>
          <Field label={v.method_group === 'Bank transfer' ? 'Bank' : 'E-wallet name'} required={v.method_group === 'Bank transfer'} error={errors.bank_name}><input className="input" maxLength={120} value={v.bank_name} onChange={set('bank_name')} /></Field>
        </div>
        <Field label="Instructions shown under the QR" hint="Optional. Never ask donors to send money anywhere else."><textarea className="input" rows={2} maxLength={1000} value={v.instructions} onChange={set('instructions')} /></Field>
        <Field label="Official QR image" required error={errors.image} hint="PNG or JPG up to 1 MB, downloaded from the home's own bank or e-wallet account. It is checked, decoded and re-saved by CareSphere.">
          <input type="file" accept="image/png,image/jpeg" onChange={pick} className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-navy-900" />
        </Field>
        {image && (
          <div className="flex flex-wrap items-start gap-4">
            <img src={image.data} alt="The QR image you chose" className="h-40 w-40 rounded-lg border border-slate-200 bg-white object-contain p-1" />
            <div className="min-w-0 flex-1 space-y-2">
              <Button size="sm" variant="secondary" loading={busy === 'preview'} onClick={check}><QrCode className="h-4 w-4" aria-hidden /> Check the QR</Button>
              {preview && (
                <>
                  <Notice tone={NAME_CHECK[preview.name_check].tone}>{NAME_CHECK[preview.name_check].text}{preview.decoded_name ? ` Name in the QR: "${preview.decoded_name}".` : ''}</Notice>
                  <div><p className="text-xs font-medium text-slate-500">Decoded text</p><pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-50 p-2 font-mono text-xs text-navy-900">{preview.decoded_text}</pre></div>
                </>
              )}
              {!preview && <p className="text-xs text-slate-500">Check the QR before saving. A QR that can't be decoded is refused.</p>}
            </div>
          </div>
        )}
        {mismatch && (
          <Notice tone="warning" title="The name inside the QR is different">
            The QR says "{mismatch.decoded_name}" but you typed "{v.account_name}". This can mean the QR was replaced. Save it only if you are sure it is the home's account.
            <span className="mt-2 block"><Button size="sm" variant="secondary" onClick={() => { setConfirmAnyway(true); setReauth(true); }}>It is correct: save anyway</Button></span>
          </Notice>
        )}
        <Field label="Reason for this change" required error={errors.reason} hint="Kept in the version history and sent to every administrator."><textarea className="input" rows={2} maxLength={500} value={v.reason} onChange={set('reason')} /></Field>
      </div>
      {reauth && <ReauthModal purpose="payment_qr" what="Changing where donors send money needs your password and two-step code." onClose={() => setReauth(false)} onGrant={(g) => submit(g, confirmAnyway)} />}
    </Modal>
  );
}

function Versions({ method, onClose }) {
  const { data, loading, error } = useApi(`/payment-qr/methods/${method.method_id}/versions`);
  const x = data?.data;
  return (
    <Modal open onClose={onClose} size="lg" title={`${method.label}: version history`} footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      {loading && !data ? <Spinner /> : error ? <ErrorNote error={error} /> : (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Versions can't be edited or deleted. Old images are kept.</p>
          <ol className="space-y-3">
            {x.versions.map((ver) => (
              <li key={ver.version_id} className="flex flex-wrap gap-3 rounded-xl border border-slate-200 p-3">
                <SignedImage url={ver.qr_url} alt={`${method.label} QR version ${ver.version_no}`} className="h-24 w-24 border border-slate-200 p-1" />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-semibold text-navy-900">Version {ver.version_no} · {formatDateTime(ver.created_at)}</p>
                  <p className="text-navy-900">{ver.account_name}{ver.account_number ? ` · ${ver.account_number}` : ''}{ver.bank_name ? ` · ${ver.bank_name}` : ''}</p>
                  <p className="text-xs text-slate-500">By {ver.created_by_name}{ver.approved_by_name ? `, approved by ${ver.approved_by_name}` : ''} · {ver.qr_format === 'qrph' ? `QR Ph${ver.qr_decoded_name ? ` (${ver.qr_decoded_name})` : ''}` : 'Other QR'}</p>
                  {ver.reason && <p className="mt-1 text-xs text-slate-600">Reason: {ver.reason}</p>}
                </div>
              </li>
            ))}
          </ol>
          {x.changes.some((c) => c.status !== 'Applied') && (
            <div>
              <h3 className="text-sm font-semibold text-navy-900">Changes not applied</h3>
              <ul className="mt-1 space-y-1 text-sm text-slate-700">{x.changes.filter((c) => c.status !== 'Applied').map((c) => <li key={c.change_id}>{formatDateTime(c.requested_at)} · {c.status} · requested by {c.requested_by_name}{c.decision_note ? ` · ${c.decision_note}` : ''}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function PendingChange({ c, onChanged }) {
  const { toast } = useApp();
  const [reauth, setReauth] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const approve = async (grant) => {
    try { await api(`/payment-qr/changes/${c.change_id}/approve`, { method: 'POST', headers: { 'X-Reauth': grant }, body: {} }); setReauth(false); toast('Approved. Donors now see this change.', 'success'); onChanged(); }
    catch (err) { setReauth(false); toast(err.message, 'error'); }
  };
  const close = async (cancel) => {
    setBusy(true);
    try { await api(`/payment-qr/changes/${c.change_id}/${cancel ? 'cancel' : 'reject'}`, { method: 'POST', body: { note: note.trim() || undefined } }); toast(cancel ? 'Cancelled.' : 'Rejected.', 'success'); setRejecting(false); onChanged(); }
    catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <li className="flex flex-wrap gap-4 rounded-xl border border-amber-200 bg-amber-50/40 p-4">
      <SignedImage url={c.qr_url} alt={`Proposed ${c.label} QR`} className="h-32 w-32 border border-slate-200 p-1" />
      <div className="min-w-0 flex-1 space-y-1 text-sm">
        <p className="font-semibold text-navy-900">{c.action === 'create' ? 'New method' : 'Change'}: {c.label} <span className="font-normal text-slate-500">· {c.method_group}</span></p>
        <p className="text-navy-900">{c.account_name}{c.account_number ? ` · ${c.account_number}` : ''}{c.bank_name ? ` · ${c.bank_name}` : ''}</p>
        <p className="text-xs text-slate-500">Requested by {c.requested_by_name} · {formatDateTime(c.requested_at)}</p>
        <p className="text-xs text-slate-600">Reason: {c.reason}</p>
        {c.name_mismatch && <p className="flex items-center gap-1 text-xs font-medium text-amber-800"><AlertTriangle className="h-3 w-3" aria-hidden /> The name inside the QR ("{c.qr_decoded_name}") doesn't match the account name.</p>}
        <details className="text-xs"><summary className="cursor-pointer font-medium text-brand">Decoded QR text</summary><pre className="mt-1 whitespace-pre-wrap break-all rounded bg-white p-2 font-mono text-navy-900">{c.qr_decoded_text}</pre></details>
        <div className="flex flex-wrap gap-2 pt-1">
          {c.mine ? <Button size="sm" variant="secondary" loading={busy} onClick={() => close(true)}>Cancel my request</Button> : (
            <>
              <Button size="sm" onClick={() => setReauth(true)}>Approve</Button>
              <Button size="sm" variant="secondary" onClick={() => setRejecting(!rejecting)}>Reject</Button>
            </>
          )}
        </div>
        {c.mine && <p className="text-xs text-slate-500">Another administrator must approve it.</p>}
        {rejecting && (
          <div className="flex flex-wrap items-end gap-2 pt-1">
            <Field label="Reason" className="min-w-[14rem] flex-1"><input className="input h-9" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            <Button size="sm" loading={busy} disabled={!note.trim()} onClick={() => close(false)}>Reject change</Button>
          </div>
        )}
      </div>
      {reauth && <ReauthModal purpose="payment_qr" what="Approving a change to where donors send money needs your password and two-step code." onClose={() => setReauth(false)} onGrant={approve} />}
    </li>
  );
}

function Controls({ controls, onSaved }) {
  const { toast } = useApp();
  const [v, setV] = useState(() => Object.fromEntries(controls.map((c) => [c.key, String(c.value)])));
  const [reauth, setReauth] = useState(false);
  const [error, setError] = useState(null);
  const changed = controls.filter((c) => String(c.value) !== v[c.key]);
  const save = async (grant) => {
    setError(null);
    try {
      await api('/settings', { method: 'PUT', headers: { 'X-Reauth': grant }, body: Object.fromEntries(changed.map((c) => [c.key, v[c.key]])) });
      setReauth(false); toast('Donation controls saved. The other administrators were notified.', 'success'); onSaved();
    } catch (err) { setReauth(false); setError(err); }
  };
  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold text-navy-900">Donation controls</h2>
      <p className="mb-4 text-sm text-slate-500">Limits for donor reports and the checks on verifying and cash. Saving needs your password and two-step code; every administrator is notified.</p>
      <ErrorNote error={error} />
      <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
        {controls.map((c) => c.toggle ? (
          <label key={c.key} className="flex items-start gap-2 text-sm text-navy-900"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand" checked={v[c.key] === '1'} onChange={(e) => setV({ ...v, [c.key]: e.target.checked ? '1' : '0' })} /> {c.label.replace(/ \(1 = on\)/, '')}</label>
        ) : (
          <Field key={c.key} label={c.label} hint={`${c.min} to ${c.max}`}><input className="input w-40" type="number" min={c.min} max={c.max} value={v[c.key]} onChange={(e) => setV({ ...v, [c.key]: e.target.value })} /></Field>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-3 border-t border-slate-100 pt-4">
        <Button disabled={!changed.length} onClick={() => setReauth(true)}>Save controls</Button>
        {changed.length > 0 && <span className="text-xs text-slate-500">{changed.length} change{changed.length === 1 ? '' : 's'} not saved</span>}
      </div>
      {reauth && <ReauthModal purpose="donation_controls" what="Changing donation controls needs your password and two-step code." onClose={() => setReauth(false)} onGrant={save} />}
    </Card>
  );
}

/** Opens the printable "Donation QR sheet" (images embedded, so nothing is fetched from another site). */
async function printSheet(toast) {
  const win = window.open('', '_blank');
  if (!win) { toast('Allow pop-ups to print the QR sheet.', 'error'); return; }
  win.document.write('<p style="font-family:sans-serif">Preparing the QR sheet...</p>');
  try {
    const r = await api('/payment-qr/sheet');
    const s = r.data;
    const toData = async (url) => { const b = await (await api(url, { raw: true })).blob(); return new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); }); };
    const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const cards = await Promise.all(s.methods.map(async (m) => `<section><h2>${esc(m.label)}</h2><img alt="" src="${await toData(m.qr_url)}"><p><b>${esc(m.account_name)}</b></p>${m.account_number ? `<p>${esc(m.account_number)}</p>` : ''}${m.bank_name ? `<p>${esc(m.bank_name)}</p>` : ''}<p class="s">Check that the name in your app is exactly "${esc(m.account_name)}". QR updated on ${esc(formatDate(m.updated_on))}.</p></section>`));
    win.document.open();
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Donation QR sheet</title><style>body{font-family:system-ui,sans-serif;color:#0f172a;margin:24px}h1{font-size:20px;margin:0}.g{display:grid;grid-template-columns:repeat(2,1fr);gap:20px;margin-top:16px}section{border:1px solid #cbd5e1;border-radius:12px;padding:16px;text-align:center;break-inside:avoid}img{width:220px;height:220px;object-fit:contain}h2{margin:0 0 8px;font-size:18px}p{margin:4px 0}.s{font-size:12px;color:#475569}.n{margin-top:16px;font-size:13px;border-top:1px solid #cbd5e1;padding-top:8px}</style></head><body><h1>${esc(s.org_name)}: Donate with a QR code</h1><p class="s">Printed ${esc(new Date(s.printed_at).toLocaleString())}. Throw away older printouts.</p><div class="g">${cards.join('')}</div><p class="n">CareSphere doesn't receive or hold your money. After sending, report your donation in your CareSphere donor account so the home can confirm it.</p></body></html>`);
    win.document.close();
    // Printed from here (the new window has no script of its own, so the page's Content Security Policy holds).
    setTimeout(() => { win.focus(); win.print(); }, 300);
  } catch (err) { win.close(); toast(err.message, 'error'); }
}

/** Settings > Payment QR (Admin only). */
export default function PaymentQrSettings() {
  const { toast } = useApp();
  const { data, loading, error, reload } = useApi('/payment-qr');
  const [editing, setEditing] = useState(null);
  const [history, setHistory] = useState(null);
  const [resolving, setResolving] = useState(null);
  const [resolveNote, setResolveNote] = useState('');
  const x = data?.data;
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  const toggle = async (m) => {
    try { await api(`/payment-qr/methods/${m.method_id}`, { method: 'PUT', body: { enabled: !m.enabled } }); toast(m.enabled ? `${m.label} hidden from donors.` : `${m.label} shown to donors.`, 'success'); reload(); }
    catch (err) { toast(err.message, 'error'); }
  };
  const confirm = async (m) => {
    try { await api(`/payment-qr/methods/${m.method_id}/confirm`, { method: 'POST' }); toast('Recorded: you checked this QR against the home account.', 'success'); reload(); }
    catch (err) { toast(err.message, 'error'); }
  };
  const resolve = async () => {
    try { await api(`/payment-qr/problems/${resolving.report_id}/resolve`, { method: 'POST', body: { note: resolveNote.trim() } }); toast('Marked resolved.', 'success'); setResolving(null); setResolveNote(''); reload(); }
    catch (err) { toast(err.message, 'error'); }
  };
  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-navy-900">Payment QR</h2>
            <p className="max-w-2xl text-sm text-slate-500">The home's official QR codes that donors scan with their own app. CareSphere doesn't receive, hold or process payments. Every change needs a reason and your password and two-step code{x.second_admin_required ? ', and another administrator must approve it' : ''}. All administrators are notified.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => printSheet(toast)} disabled={!x.methods.some((m) => m.enabled && m.current_version_id)}><Printer className="h-4 w-4" aria-hidden /> Print QR sheet</Button>
            <Button onClick={() => setEditing({})}><Plus className="h-4 w-4" aria-hidden /> Add a method</Button>
          </div>
        </div>
        {x.problems.length > 0 && (
          <Notice tone="warning" className="mt-4" title={`${x.problems.length} problem${x.problems.length === 1 ? '' : 's'} reported by donors`}>
            <ul className="mt-1 space-y-1">{x.problems.map((p) => <li key={p.report_id} className="flex flex-wrap items-center gap-2"><ShieldAlert className="h-3.5 w-3.5" aria-hidden /> {p.label}: {p.problem_label}{p.note ? ` ("${p.note}")` : ''} · {formatDateTime(p.created_at)} <button type="button" className="font-medium text-brand underline" onClick={() => setResolving(p)}>Resolve</button></li>)}</ul>
          </Notice>
        )}
        {x.methods.length === 0 ? <EmptyState icon={QrCode} title="No QR methods yet" description="Add the home's GCash, Maya or bank QR so donors can give." /> : (
          <ul className="mt-5 grid gap-4 lg:grid-cols-2">
            {x.methods.map((m) => (
              <li key={m.method_id} className="flex gap-4 rounded-xl border border-slate-200 p-4">
                {m.qr_url ? <SignedImage url={m.qr_url} alt={`${m.label} QR`} className="h-28 w-28 shrink-0 border border-slate-200 p-1" /> : <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-xl bg-slate-50 text-xs text-slate-500">No QR</div>}
                <div className="min-w-0 flex-1 text-sm">
                  <p className="flex flex-wrap items-center gap-2 font-semibold text-navy-900">{m.label} <Badge tone={m.enabled && m.current_version_id ? 'green' : 'slate'}>{m.enabled && m.current_version_id ? 'Shown to donors' : 'Hidden'}</Badge>{m.open_problems > 0 && <Badge tone="amber">{m.open_problems} problem{m.open_problems === 1 ? '' : 's'}</Badge>}</p>
                  {m.current_version_id ? (
                    <>
                      <p className="text-navy-900">{m.account_name}{m.account_number ? ` · ${m.account_number}` : ''}</p>
                      <p className="text-xs text-slate-500">{m.method_group}{m.bank_name ? ` · ${m.bank_name}` : ''} · version {m.version_no} · updated {formatDate(m.qr_updated_at || m.version_at)}</p>
                      <p className="text-xs text-slate-500">{m.qr_format === 'qrph' ? `QR Ph${m.qr_decoded_name ? `: "${m.qr_decoded_name}"` : ''}` : 'Other QR'}</p>
                      <p className="text-xs text-slate-500">{m.last_confirmed_at ? <>Last checked by {m.last_confirmed_by_name} on {formatDate(m.last_confirmed_at)}</> : 'Never checked against the account'}</p>
                    </>
                  ) : <p className="text-xs text-amber-800">No QR uploaded: hidden from donors.</p>}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Button size="sm" variant="secondary" onClick={() => setEditing(m)}>Change QR or details</Button>
                    {m.current_version_id && <Button size="sm" variant="ghost" onClick={() => confirm(m)}><CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> I checked it</Button>}
                    <Button size="sm" variant="ghost" onClick={() => setHistory(m)}><History className="h-3.5 w-3.5" aria-hidden /> History</Button>
                    {(m.current_version_id || m.enabled) && <Button size="sm" variant="ghost" onClick={() => toggle(m)}>{m.enabled ? 'Hide' : 'Show'}</Button>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {x.pending.length > 0 && (
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-navy-900">Waiting for approval</h2>
          <p className="mb-3 text-sm text-slate-500">Check each change against the home's own account before approving. Donors keep seeing the current QR until then.</p>
          <ul className="space-y-3">{x.pending.map((c) => <PendingChange key={c.change_id} c={c} onChanged={reload} />)}</ul>
        </Card>
      )}
      <Controls key={JSON.stringify(x.controls)} controls={x.controls} onSaved={reload} />
      {editing && <ChangeEditor method={editing.method_id ? editing : null} onClose={() => setEditing(null)} onDone={() => { setEditing(null); reload(); }} />}
      {history && <Versions method={history} onClose={() => setHistory(null)} />}
      {resolving && (
        <Modal open onClose={() => setResolving(null)} size="sm" title="Resolve the problem report" footer={<><Button variant="secondary" onClick={() => setResolving(null)}>Cancel</Button><Button disabled={!resolveNote.trim()} onClick={resolve}>Mark resolved</Button></>}>
          <Field label="What you checked or changed" required><textarea className="input" rows={3} maxLength={500} value={resolveNote} onChange={(e) => setResolveNote(e.target.value)} /></Field>
        </Modal>
      )}
    </div>
  );
}
