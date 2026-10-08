import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyRound, Lock, LockOpen, Pencil, ScanLine } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import useCountdown from '../hooks/useCountdown';
import CountdownRing from './CountdownRing';
import TokenVerifyModal from './TokenVerifyModal';
import { clearGrant, readGrant, saveGrant, unlockHeaders } from '../lib/grants';
import { Button, Card, ErrorNote, Field, Modal } from './ui';
import { formatDateTime } from '../lib/format';

const HEALTH = [
  ['blood_type', 'Blood type', false], ['allergies', 'Allergies', false], ['vaccinations', 'Immunizations', true],
  ['prescriptions', 'Prescriptions', true], ['doctor_notes', "Doctor's notes", true],
];
const CASE = [['background_care_info', 'Background and care information'], ['guardian_family_info', 'Guardian and family information']];

/**
 * Health record + confidential case files.
 * Admin: re-enter the password (unchanged). Staff: the shared unlock flow (purpose, confidentiality
 * tick, QR to the phone, single-use Token ID). One child unlock opens this section and the child's
 * adoption legal records together, for the unlock length set by Admin. The server enforces the
 * limit; this timer only mirrors it and clears the data at zero.
 */
export default function ProtectedRecord({ child }) {
  const { user } = useAuth();
  const { toast } = useApp();
  const isAdmin = user.role === 'Admin';
  const [access, setAccess] = useState(null); // { token, seconds, key }
  const [data, setData] = useState(null);
  const [askToken, setAskToken] = useState(false);
  const [editing, setEditing] = useState(null); // 'health' | 'case'
  const tokenRef = useRef(null);
  tokenRef.current = access?.token || null;

  const headers = () => ({ 'X-Health-Access': tokenRef.current });

  const lock = useCallback(async (message) => {
    const token = tokenRef.current;
    setAccess(null); setData(null); setEditing(null);
    if (message) toast(message);
    if (token) api(`/children/${child.child_id}/health-access/revoke`, { method: 'POST', headers: { 'X-Health-Access': token } }).catch(() => {});
    if (!isAdmin && readGrant('health', child.child_id)) {
      // Staff "Lock now" also ends the child unlock session (legal records lock too).
      api('/unlock/lock', { method: 'POST', headers: { ...unlockHeaders('health', child.child_id), 'X-Health-Access': token || '' },
        body: { record_type: 'health', record_id: child.child_id } }).catch(() => {});
      clearGrant('health', child.child_id);
    }
  }, [child.child_id, toast, isAdmin]);

  // Close access when leaving the page.
  useEffect(() => () => {
    const token = tokenRef.current;
    if (token) api(`/children/${child.child_id}/health-access/revoke`, { method: 'POST', headers: { 'X-Health-Access': token } }).catch(() => {});
  }, [child.child_id]);

  const remaining = useCountdown(access?.seconds, access?.key, () => lock('Time is up. The record was locked again.'));

  const openWithToken = useCallback(async (token) => {
    tokenRef.current = token;
    const rec = await api(`/children/${child.child_id}/protected`, { headers: { 'X-Health-Access': token } });
    setData(rec.data);
    setAccess({ token, seconds: rec.data.remaining_seconds, key: Date.now() });
  }, [child.child_id]);
  const open = async (body) => {
    const res = await api(`/children/${child.child_id}/health-access`, { method: 'POST', body });
    await openWithToken(res.data.access_token);
  };
  // Staff: the child may already be unlocked from the legal records panel, or get locked from there.
  useEffect(() => {
    if (isAdmin) return undefined;
    const sync = (e) => {
      if (e && (e.detail.kind !== 'health' || e.detail.id !== String(child.child_id))) return;
      const g = readGrant('health', child.child_id);
      if (g?.health_access_token && !tokenRef.current) openWithToken(g.health_access_token).catch(() => {});
      if (!g && tokenRef.current) { setAccess(null); setData(null); setEditing(null); tokenRef.current = null; }
    };
    sync();
    window.addEventListener('caresphere-unlock', sync);
    return () => window.removeEventListener('caresphere-unlock', sync);
  }, [child.child_id, isAdmin, openWithToken]);
  const onUnlocked = async (result) => {
    setAskToken(false);
    saveGrant('health', child.child_id, result.grant, result.expires_at, { purpose: result.purpose, health_access_token: result.health_access_token });
  };

  const save = async (kind, body) => {
    try {
      const path = kind === 'health' ? 'health' : 'case-files';
      const res = await api(`/children/${child.child_id}/${path}`, { method: 'PUT', body, headers: headers() });
      setData((d) => (kind === 'health' ? { ...d, health: res.data } : { ...d, case_files: res.data }));
      setEditing(null);
      toast(kind === 'health' ? 'Health record saved.' : 'Case files saved.');
    } catch (err) {
      if (err.status === 401 || err.status === 403) { lock(); throw new Error(`${err.message}`); }
      throw err;
    }
  };

  if (!access || !data) {
    return (
      <Card className="p-6">
        <div className="flex flex-col items-center text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-navy-900"><Lock className="h-5 w-5 text-white" /></div>
          <p className="mt-3 font-semibold text-navy-900">Health record and case files are locked</p>
          <p className="mt-1 max-w-sm text-sm text-slate-500">
            {isAdmin ? 'Administrators have full access. Opening them is recorded.'
              : 'State your purpose, scan the QR with your phone, and type the Token ID it shows. This also opens the child\'s adoption legal records.'}
          </p>
          <div className="phi-blur mt-4 w-full max-w-sm select-none space-y-2 text-left text-sm text-slate-400" aria-hidden>
            <p>Blood type ●●●</p><p>Allergies ●●●●●●●●</p><p>Background ●●●●●●●●●●●●●●</p>
          </div>
          {isAdmin
            ? <Button className="mt-4" onClick={() => open({}).catch((err) => toast(err.message, 'error'))}><KeyRound className="h-4 w-4" /> Open (Admin full access)</Button>
            : child.assigned_staff_id === user.user_id
              ? <Button className="mt-4" onClick={() => setAskToken(true)}><ScanLine className="h-4 w-4" /> Unlock sensitive sections</Button>
              : <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-700" role="status">You're not assigned to this record. Ask an Admin to assign you.</p>}
        </div>
        {!isAdmin && <TokenVerifyModal open={askToken} onClose={() => setAskToken(false)} recordType="health" recordId={child.child_id}
          recordLabel={`Child record ${child.child_id}`} onUnlocked={onUnlocked} />}
      </Card>
    );
  }

  const h = data.health || {};
  const c = data.case_files || {};
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-4 bg-navy-900 px-5 py-4 text-white">
        <LockOpen className="h-5 w-5 text-emerald-400" aria-hidden />
        <div className="flex-1">
          <p className="font-semibold">Protected record open</p>
          <p className="text-xs text-slate-300">Locks automatically when the timer ends. Every view and change is logged.</p>
        </div>
        <CountdownRing remaining={remaining} total={180} size={56} light />
        <Button variant="secondary" size="sm" onClick={() => lock('Record locked.')}><Lock className="h-3.5 w-3.5" /> Lock now</Button>
      </div>

      <section className="border-b border-slate-100 p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold text-navy-900">Health history</h3>
          {editing !== 'health' && <Button size="sm" variant="secondary" onClick={() => setEditing('health')}><Pencil className="h-3.5 w-3.5" /> Edit</Button>}
        </div>
        {editing === 'health'
          ? <EditForm fields={HEALTH.map(([k, l, long]) => ({ k, l, long }))} initial={h} onCancel={() => setEditing(null)} onSave={(b) => save('health', b)} />
          : (
            <dl className="grid gap-4 sm:grid-cols-2">
              {HEALTH.map(([k, label]) => (
                <div key={k}><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap text-sm text-navy-900">{h[k] || <span className="text-slate-400">Not recorded</span>}</dd></div>
              ))}
              {h.updated_at && <p className="text-xs text-slate-500 sm:col-span-2">Last updated {formatDateTime(h.updated_at)}{h.last_updated_by_name ? ` by ${h.last_updated_by_name}` : ''}</p>}
            </dl>
          )}
      </section>

      <section className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold text-navy-900">Case files</h3>
          {editing !== 'case' && <Button size="sm" variant="secondary" onClick={() => setEditing('case')}><Pencil className="h-3.5 w-3.5" /> Edit</Button>}
        </div>
        {editing === 'case'
          ? <EditForm fields={CASE.map(([k, l]) => ({ k, l, long: true }))} initial={c} onCancel={() => setEditing(null)} onSave={(b) => save('case', b)} />
          : (
            <dl className="space-y-4">
              {CASE.map(([k, label]) => (
                <div key={k}><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap text-sm text-navy-900">{c[k] || <span className="text-slate-400">Not recorded</span>}</dd></div>
              ))}
            </dl>
          )}
      </section>
    </Card>
  );
}

function EditForm({ fields, initial, onSave, onCancel }) {
  const [form, setForm] = useState(() => Object.fromEntries(fields.map((f) => [f.k, initial[f.k] || ''])));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const submit = async () => {
    setSaving(true); setError(null);
    try { await onSave(form); } catch (err) { setError(err); } finally { setSaving(false); }
  };
  return (
    <div className="space-y-3">
      <ErrorNote error={error} />
      {fields.map((f) => (
        <Field key={f.k} label={f.l}>
          {f.long
            ? <textarea className="input" rows={3} value={form[f.k]} onChange={(e) => setForm({ ...form, [f.k]: e.target.value })} />
            : <input className="input" value={form[f.k]} onChange={(e) => setForm({ ...form, [f.k]: e.target.value })} />}
        </Field>
      ))}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button loading={saving} onClick={submit}>Save</Button>
      </div>
    </div>
  );
}
