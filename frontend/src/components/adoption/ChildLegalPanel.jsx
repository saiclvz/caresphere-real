import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BadgeCheck, Lock, Upload } from 'lucide-react';
import useApi from '../../hooks/useApi';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useApp } from '../../context/AppContext';
import { readFile } from '../../lib/files';
import { formatDate } from '../../lib/format';
import { Badge, Button, Card, ErrorNote, Field, Spinner } from '../ui';
import ProtectedRecords from './ProtectedRecords';
import TokenVerifyModal from '../TokenVerifyModal';
import { clearGrant, saveGrant, unlockHeaders } from '../../lib/grants';

const FILE_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];
async function pickFile(file) {
  if (!FILE_TYPES.includes(file.type)) throw new Error('Only PDF, PNG or JPG files are accepted.');
  if (file.size > 10 * 1024 * 1024) throw new Error('The file is larger than 10 MB.');
  const f = await readFile(file);
  return { name: f.name, data: f.data };
}

/** CDCLAA (RA 11642): recorded by Staff or Admin, verified by Admin. Required before a child can be Available for adoption. */
function Cdclaa({ childId, onChanged }) {
  const { user } = useAuth();
  const { toast } = useApp();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [unlocking, setUnlocking] = useState(false);
  // Staff need a token for this child to see the CDCLAA details (sent as X-Protected-Access).
  // One unlock opens the whole child record (health, case files and these legal records).
  const reload = useCallback(() => api(`/children/${childId}/cdclaa`, { headers: unlockHeaders('health', childId) })
    .then((r) => { setData(r); setError(null); }).catch(setError), [childId]);
  useEffect(() => {
    const onChange = (e) => { if (e.detail.kind === 'health' && e.detail.id === String(childId)) reload(); };
    window.addEventListener('caresphere-unlock', onChange);
    return () => window.removeEventListener('caresphere-unlock', onChange);
  }, [childId, reload]);
  useEffect(() => { reload(); }, [reload]);
  const loading = !data && !error;
  const c = data?.data;
  const expiresAt = c && !c.locked && user.role === 'Staff' ? c.sensitive?.expires_at : null;
  useEffect(() => {
    if (!expiresAt) return undefined;
    const t = setTimeout(() => { clearGrant('health', childId); }, Math.max(0, Math.min(new Date(expiresAt).getTime() - Date.now(), 2 ** 31 - 1)));
    return () => clearTimeout(t);
  }, [expiresAt, childId, reload]);
  const [form, setForm] = useState(null);
  const [file, setFile] = useState(null);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  if (loading) return <Spinner />;
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (c.locked) {
    const onUnlocked = (result) => {
      setUnlocking(false);
      saveGrant('health', childId, result.grant, result.expires_at, { purpose: result.purpose, health_access_token: result.health_access_token });
      toast('Child record unlocked.');
    };
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-medium text-navy-800">CDCLAA</h3>
          {c.verified ? <Badge tone="green">Verified</Badge> : <Badge tone="slate">Not verified</Badge>}
          {c.placement_status !== 'None' && <Badge tone="blue">{c.placement_status === 'Trial custody' ? 'Matched / Trial custody' : 'Matched'}</Badge>}
        </div>
        <p className="flex items-center gap-1.5 text-sm text-slate-600"><Lock className="h-4 w-4 text-amber-700" aria-hidden /> CDCLAA details are locked.</p>
        <Button size="sm" onClick={() => setUnlocking(true)}>Unlock child record</Button>
        <TokenVerifyModal open={unlocking} onClose={() => setUnlocking(false)} recordType="health" recordId={childId} recordLabel={`Child record ${childId}`} onUnlocked={onUnlocked} />
      </div>
    );
  }

  const save = async () => {
    const e = {};
    if (!form.number.trim()) e.number = 'CDCLAA number is required.';
    if (!form.date) e.date = 'Issue date is required.';
    if (!c.has_file && !file) e.file = 'Upload a copy of the CDCLAA.';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await api(`/children/${childId}/cdclaa`, { method: 'PUT', body: { number: form.number.trim(), date: form.date, file: file ? await pickFile(file) : undefined } });
      toast('CDCLAA saved. An administrator must verify it before the child can be Available for adoption.');
      setForm(null); setFile(null); reload(); onChanged?.();
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  const verify = async () => {
    setBusy(true);
    try { await api(`/children/${childId}/cdclaa/verify`, { method: 'POST' }); toast('CDCLAA verified.'); reload(); onChanged?.(); }
    catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium text-navy-800">CDCLAA</h3>
        {c.verified ? <Badge tone="green"><BadgeCheck className="h-3 w-3" /> Verified {formatDate(c.verified_at)}</Badge> : c.number ? <Badge tone="amber">Not verified</Badge> : <Badge tone="slate">Not recorded</Badge>}
        {c.placement_status !== 'None' && <Badge tone="blue">{c.placement_status === 'Trial custody' ? 'Matched / Trial custody' : 'Matched'}</Badge>}
      </div>
      {c.number && !form && <p className="text-sm text-slate-600">No. <span className="font-mono">{c.number}</span>, issued {formatDate(c.date)}{c.has_file && <> · copy on file <Lock className="inline h-3 w-3 text-red-600" aria-label="protected" /></>}</p>}
      <p className="text-xs text-slate-500">Certificate Declaring a Child Legally Available for Adoption. Matching and "Available for adoption" need a verified CDCLAA.</p>
      {form ? (
        <div className="space-y-2 rounded-lg border border-slate-200 p-3">
          <Field label="CDCLAA number" required error={errors.number}><input className="input font-mono" maxLength={80} value={form.number} onChange={(e) => setForm((f) => ({ ...f, number: e.target.value }))} /></Field>
          <Field label="Issue date" required error={errors.date}><input className="input" type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} /></Field>
          <Field label="Copy (PDF, PNG or JPG, up to 10 MB)" required={!c.has_file} error={errors.file} hint={c.has_file ? 'Leave empty to keep the current copy.' : undefined}>
            <input className="input" type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </Field>
          <p className="text-xs text-amber-700">Saving clears the verification until an administrator verifies again.</p>
          <div className="flex gap-2"><Button size="sm" loading={busy} onClick={save}>Save CDCLAA</Button><Button size="sm" variant="ghost" onClick={() => setForm(null)}>Cancel</Button></div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => { setForm({ number: c.number || '', date: c.date ? String(c.date).slice(0, 10) : '' }); setErrors({}); }}>{c.number ? 'Update CDCLAA' : 'Record CDCLAA'}</Button>
          {user.role === 'Admin' && c.number && !c.verified && <Button size="sm" loading={busy} onClick={verify}><BadgeCheck className="h-4 w-4" /> Verify</Button>}
          {user.role === 'Admin' && <Link to="/audit-log?tab=data-protection" className="inline-flex items-center rounded-lg px-2.5 py-1.5 text-xs font-medium text-brand hover:bg-slate-100">Manage staff tokens</Link>}
        </div>
      )}
      {c.sensitive?.unlocked && user.role === 'Staff' && <p className="text-xs text-emerald-700">Unlocked for {c.sensitive.purpose} until {new Date(c.sensitive.expires_at).toLocaleTimeString()}.</p>}
    </div>
  );
}

/** Admin: sealed original birth record (birth certificate, natural parents' identity). Always shows "Sealed". */
function Sealed({ childId }) {
  const { toast } = useApp();
  const { data, reload } = useApi(`/children/${childId}/sealed-records`);
  const [kind, setKind] = useState('original_birth_certificate');
  const [busy, setBusy] = useState(false);
  const rows = data?.data?.records || [];
  const upload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try { await api(`/children/${childId}/sealed-records`, { method: 'POST', body: { kind, file: await pickFile(file) } }); toast('Stored as a sealed record.'); reload(); }
    catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-2 border-t border-slate-100 pt-3">
      <h3 className="flex items-center gap-1 text-sm font-medium text-navy-800"><Lock className="h-4 w-4 text-red-600" aria-hidden /> Sealed original birth record</h3>
      {rows.length === 0 ? <p className="text-xs text-slate-500">Nothing stored.</p> : (
        <ul className="space-y-1 text-sm">{rows.map((r) => <li key={r.sealed_id} className="flex items-center gap-2"><Badge tone="red">Sealed</Badge>{r.label}<span className="text-xs text-slate-400">{formatDate(r.uploaded_at)}</span></li>)}</ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <select className="input h-9 w-auto" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Sealed record type">
          <option value="original_birth_certificate">Original birth certificate</option>
          <option value="natural_parents_identity">Natural parents' identity</option>
        </select>
        <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-navy-900 hover:bg-slate-50">
          <Upload className="h-3.5 w-3.5" aria-hidden /> {busy ? 'Uploading...' : 'Upload sealed file'}
          <input type="file" className="sr-only" accept=".pdf,.png,.jpg,.jpeg" onChange={upload} disabled={busy} />
        </label>
      </div>
      <p className="text-xs text-slate-500">Opening a sealed record needs a typed reason and the NACC Order of Adoption number. Every access is logged.</p>
    </div>
  );
}

function AdminRecords({ childId }) {
  const { data, reload } = useApi(`/protected-records?child_id=${encodeURIComponent(childId)}`);
  return <ProtectedRecords records={data?.data} onChanged={reload} title="Protected record QR (child)" />;
}

/** Child page: adoption legal records (CDCLAA; sealed records and protected files for Admin). */
/**
 * Matching readiness: the child's needs, siblings to place together and room needs (for the compatibility
 * review), and the child's documents, each verified by Admin. Matching is blocked until all are verified.
 */
function MatchReadiness({ childId }) {
  const { user } = useAuth();
  const { toast } = useApp();
  const isAdmin = user.role === 'Admin';
  const { data, error, reload } = useApi(`/children/${encodeURIComponent(childId)}/match-profile`);
  const [form, setForm] = useState(null);
  const [refs, setRefs] = useState({});
  const [busy, setBusy] = useState(null);
  const p = data?.data;
  useEffect(() => { if (p) setForm({ special_needs: p.special_needs || '', sibling_group_size: p.sibling_group_size ?? '', needs_own_room: p.needs_own_room === null ? '' : String(p.needs_own_room) }); }, [p]);
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (!p || !form) return <Spinner />;
  const save = async () => {
    setBusy('profile');
    try { await api(`/children/${encodeURIComponent(childId)}/match-profile`, { method: 'PUT', body: { ...form, needs_own_room: form.needs_own_room === '' ? null : form.needs_own_room === 'true' } }); toast('Matching profile saved.'); reload(); }
    catch (err) { toast(err.message, 'error'); } finally { setBusy(null); }
  };
  const verify = async (key) => {
    setBusy(key);
    try { await api(`/children/${encodeURIComponent(childId)}/match-documents/${key}/verify`, { method: 'POST', body: { reference: refs[key] || '' } }); toast('Marked verified.'); reload(); }
    catch (err) { toast(err.message, 'error'); } finally { setBusy(null); }
  };
  const missing = p.documents.filter((d) => !d.verified_at).length;
  return (
    <Card className="space-y-3 p-5">
      <div>
        <h2 className="font-semibold text-navy-900">Matching readiness</h2>
        <p className="text-xs text-slate-500">Matching is blocked until the CDCLAA and these documents are verified. The profile is used for the compatibility review only.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Health or special needs"><select className="input" disabled={!isAdmin} value={form.special_needs} onChange={(e) => setForm({ ...form, special_needs: e.target.value })}>
          <option value="">Not recorded</option>{['None', 'Some', 'Significant'].map((o) => <option key={o}>{o}</option>)}</select></Field>
        <Field label="Siblings to place together"><input className="input" type="number" min="0" max="10" disabled={!isAdmin} value={form.sibling_group_size} onChange={(e) => setForm({ ...form, sibling_group_size: e.target.value })} /></Field>
        <Field label="Needs a room of their own"><select className="input" disabled={!isAdmin} value={form.needs_own_room} onChange={(e) => setForm({ ...form, needs_own_room: e.target.value })}>
          <option value="">Not recorded</option><option value="true">Yes</option><option value="false">No, can share</option></select></Field>
      </div>
      {isAdmin && <Button size="sm" variant="secondary" loading={busy === 'profile'} onClick={save}>Save profile</Button>}
      <div>
        <p className="text-sm font-medium text-navy-900">Child's documents {missing ? <Badge tone="amber">{missing} not verified</Badge> : <Badge tone="green"><BadgeCheck className="h-3 w-3" aria-hidden /> All verified</Badge>}</p>
        <ul className="mt-1 divide-y divide-slate-100 text-sm">
          {p.documents.map((d) => (
            <li key={d.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0">{d.label}{d.verified_at && <span className="block text-xs text-slate-500">Verified by {d.verified_by_name || 'Admin'} on {formatDate(d.verified_at)}{d.reference ? ` · ${d.reference}` : ''}</span>}</span>
              {d.verified_at ? <Badge tone="green"><BadgeCheck className="h-3 w-3" aria-hidden /> Verified</Badge> : isAdmin ? (
                <span className="flex items-center gap-2">
                  <input className="input h-8 w-48 text-xs" maxLength={120} placeholder="Where the original is filed" aria-label={`Reference for ${d.label}`} value={refs[d.key] || ''} onChange={(e) => setRefs({ ...refs, [d.key]: e.target.value })} />
                  <Button size="sm" variant="secondary" loading={busy === d.key} disabled={(refs[d.key] || '').trim().length < 3} onClick={() => verify(d.key)}>Mark verified</Button>
                </span>
              ) : <Badge tone="amber">Not verified</Badge>}
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

export default function ChildLegalPanel({ childId, onChanged }) {
  const { user } = useAuth();
  return (
      <div className="space-y-4">
        <Card className="space-y-3 p-5">
          <h2 className="font-semibold text-navy-900">Adoption legal records</h2>
          <Cdclaa childId={childId} onChanged={onChanged} />
          {user.role === 'Admin' && <Sealed childId={childId} />}
        </Card>
        <MatchReadiness childId={childId} />
        {user.role === 'Admin' && <AdminRecords childId={childId} />}
      </div>
  );
}
