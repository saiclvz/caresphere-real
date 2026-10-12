import { useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, GraduationCap, ImagePlus, KeyRound, Lock, Pencil, Trash2 } from 'lucide-react';
import useApi from '../hooks/useApi';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import AuthImage from '../components/AuthImage';
import ProtectedRecord from '../components/ProtectedRecord';
import ChildForm from './ChildForm';
import { STATUS_TONE } from './Children';
import { Badge, Button, Card, ConfirmModal, ErrorNote, Field, Notice, Skeleton, Spinner } from '../components/ui';
import { formatDate, formatDateTime } from '../lib/format';
import { MB, checkFile } from '../lib/files';
import PhotoCropDialog from '../components/PhotoCropDialog';
import ChildLegalPanel from '../components/adoption/ChildLegalPanel';
import AdoptionHistorySection from '../components/adoption/AdoptionHistorySection';
import TransitionSummaryCard from '../components/TransitionSummaryCard';
import CareCard from '../components/children/CareCard';
import { AccessTab, LockedPlaceholder, RequestAccessModal } from '../components/children/AccessPanels';
import { hasDuty } from '../lib/duties';
import { CORE_LOCKED, DENIED, YOUR_ACCESS, chipOf } from '../lib/childAccess';

function Info({ label, children }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-navy-900">{children}</dd>
    </div>
  );
}

/** Core record: background and care, family and guardian, placement and discharge history. */
function CaseFiles({ childId, canEdit }) {
  const { toast } = useApp();
  const { data, loading, error, reload, setData } = useApi(`/children/${encodeURIComponent(childId)}/case-files`);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  if (loading && !data) return <Card className="p-5"><Skeleton rows={4} /></Card>;
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  const c = data.data;
  const save = async (e) => {
    e.preventDefault(); setSaving(true); setSaveError(null);
    try { const res = await api(`/children/${encodeURIComponent(childId)}/case-files`, { method: 'PUT', body: form }); setData({ data: { ...c, ...res.data } }); setForm(null); toast('Case files saved.'); }
    catch (err) { setSaveError(err); } finally { setSaving(false); }
  };
  const FIELDS = [['background_care_info', 'Background and care information'], ['guardian_family_info', 'Family and guardian information']];
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-navy-900">Case files</h2>
          {canEdit && !form && <Button size="sm" variant="secondary" onClick={() => setForm({ background_care_info: c.background_care_info || '', guardian_family_info: c.guardian_family_info || '' })}><Pencil className="h-3.5 w-3.5" aria-hidden /> Edit</Button>}
        </div>
        {form ? (
          <form onSubmit={save} className="space-y-3">
            <ErrorNote error={saveError} />
            {FIELDS.map(([k, l]) => <Field key={k} label={l}><textarea className="input" rows={4} maxLength={10000} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></Field>)}
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setForm(null)}>Cancel</Button><Button type="submit" loading={saving}>Save</Button></div>
          </form>
        ) : (
          <dl className="space-y-4">
            {FIELDS.map(([k, l]) => <div key={k}><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{l}</dt><dd className="mt-0.5 whitespace-pre-wrap text-sm text-navy-900">{c[k] || <span className="text-slate-400">Not recorded</span>}</dd></div>)}
          </dl>
        )}
      </Card>
      <Card className="p-5">
        <h2 className="mb-3 font-semibold text-navy-900">Placement and discharge history</h2>
        {c.discharge_history.length === 0 ? <p className="text-sm text-slate-500">No discharges recorded.</p> : (
          <ol className="space-y-4">
            {c.discharge_history.map((d) => (
              <li key={d.discharge_id} className="rounded-lg border border-slate-200 p-3 text-sm">
                <p className="font-medium text-navy-900">Discharged {formatDate(d.discharge_date)}</p>
                <p className="mt-1"><span className="text-slate-500">Reason:</span> {d.discharge_reason}</p>
                <p className="mt-1 whitespace-pre-wrap"><span className="text-slate-500">Report:</span> {d.report_of_what_happened}</p>
                <p className="mt-2 text-xs text-slate-500">Reported by {d.reported_by_name} ({d.reported_by_role}) on {formatDateTime(d.created_at)}</p>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

const TABS = [
  ['overview', 'Overview'], ['profile', 'Profile'], ['case_files', 'Case files'], ['health', 'Health'], ['adoption', 'Adoption'], ['transition', 'Transition'], ['access', 'Access'],
];

/**
 * Child page, by access level (the server decides and never sends a locked field):
 *  Overview (directory + Care card) · Profile and Case files (core record) · Health, Adoption, Transition
 *  (level 3: the existing unlock step) · Access (Admin and the case worker).
 */
export default function ChildDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useApp();
  const isAdmin = user.role === 'Admin';
  const [params, setParams] = useSearchParams();
  const { data, loading, error, reload } = useApi(`/children/${id}`);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(null); // 'delete' | 'photo' | 'intake'
  const [busy, setBusy] = useState(false);
  const [cropFile, setCropFile] = useState(null);
  const [requesting, setRequesting] = useState(false);
  const tabRefs = useRef({});

  if (loading && !data) return <Spinner />;
  if (error?.status === 403) {
    return (
      <>
        <Link to="/children" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-navy-900"><ArrowLeft className="h-4 w-4" aria-hidden /> Children</Link>
        <Notice tone="error" title={DENIED}>{error.message !== DENIED ? error.message : 'Ask an Admin if you need this record.'}</Notice>
      </>
    );
  }
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  const child = data.data;
  // Not admitted yet: the admission form is the only place for this record (Admin or the staff member who created it).
  if (child.access?.admission) return <Navigate to={`/admissions/${encodeURIComponent(child.child_id)}`} replace />;
  const access = child.access;
  const can = access.can;
  const readOnly = access.read_only;
  const coreShown = child.full_name !== undefined && child.full_name !== null;
  const name = child.full_name || child.display_name;
  const chip = chipOf(access);
  const locked = {
    profile: !coreShown, case_files: !coreShown,
    health: !can.sensitive || !hasDuty(user, 'health'), adoption: !can.sensitive || !hasDuty(user, 'adoption'), transition: !can.sensitive || !hasDuty(user, 'transition'),
  };
  const reasonFor = (k) => {
    if (['profile', 'case_files'].includes(k)) return CORE_LOCKED;
    const duty = { health: 'Health records', adoption: 'Adoption', transition: 'Transition Review' }[k];
    if (!can.sensitive) return `${duty}: Locked. Only the assigned case worker can open it, through the unlock step.`;
    return `${duty}: Locked. It needs the ${duty} duty.`;
  };
  const tabs = TABS.filter(([k]) => k !== 'access' || can.access_tab);
  const tab = tabs.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'overview';
  const pickTab = (k) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', k); return n; }, { replace: true });
  const onTabKey = (e) => {
    const i = tabs.findIndex(([k]) => k === tab);
    const next = e.key === 'ArrowRight' ? tabs[(i + 1) % tabs.length] : e.key === 'ArrowLeft' ? tabs[(i - 1 + tabs.length) % tabs.length] : e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs[tabs.length - 1] : null;
    if (next) { e.preventDefault(); pickTab(next[0]); tabRefs.current[next[0]]?.focus(); }
  };

  const uploadPhoto = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const problem = checkFile(file, { types: ['image/jpeg', 'image/png'], maxBytes: 5 * MB });
    if (problem) { toast(`Profile photo: ${problem}`, 'error'); return; }
    setCropFile(file);
  };
  const saveCropped = async (out) => {
    await api(`/children/${child.child_id}/photo`, { method: 'POST', body: { photo: { name: out.name, data: out.data } } });
    URL.revokeObjectURL(out.preview);
    setCropFile(null);
    await reload();
    toast('Photo updated.');
  };
  const doConfirm = async () => {
    setBusy(true);
    try {
      if (confirm === 'delete') {
        await api(`/children/${child.child_id}`, { method: 'DELETE' });
        toast('Child record deleted.');
        navigate('/children');
        return;
      }
      if (confirm === 'intake') {
        const res = await api(`/children/${child.child_id}/intake-complete`, { method: 'POST' });
        toast(res.message); await reload();
      } else {
        await api(`/children/${child.child_id}/photo`, { method: 'DELETE' });
        await reload();
        toast('Photo removed.');
      }
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); setConfirm(null); }
  };
  const lockedPanel = (k, title) => (
    <LockedPlaceholder title={title} message={reasonFor(k)} pending={access.pending_request}
      onRequest={['profile', 'case_files'].includes(k) && can.request ? () => setRequesting(true) : undefined} />
  );

  return (
    <>
      <Link to="/children" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-navy-900"><ArrowLeft className="h-4 w-4" aria-hidden /> Children</Link>

      <Card className="mb-4 p-5">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          {child.profile_photo_url !== undefined && <AuthImage src={child.profile_photo_url} alt={name} className="h-24 w-24 rounded-2xl" />}
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold text-navy-900">{name}</h1>
            <p className="font-mono text-sm text-slate-500">{child.child_id}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge tone={STATUS_TONE[child.status]}>{child.status}</Badge>
              {child.transition_flag && <Badge tone="amber"><GraduationCap className="h-3 w-3" aria-hidden /> Transition Review (18+){child.transition_status ? `: ${child.transition_status}` : ''}</Badge>}
              {child.is_public && <Badge tone="blue">Shown on donor portal</Badge>}
              {child.available_for_adoption && <Badge tone="green">Available for adoption</Badge>}
            </div>
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-600">
              {isAdmin && <><span>Case worker: <strong className="text-navy-900">{child.case_worker?.name || 'Not assigned'}</strong></span>
                <span className="text-slate-300" aria-hidden>|</span></>}
              {!isAdmin && child.case_worker?.you && <><span><strong className="text-navy-900">You are {child.case_worker.type === 'primary' ? 'the case worker' : child.case_worker.type === 'backup' ? 'the backup case worker' : 'the temporary cover'}</strong></span>
                <span className="text-slate-300" aria-hidden>|</span></>}
              <span>Your access: <Badge tone={chip.tone}><chip.Icon className="h-3 w-3" aria-hidden /> {YOUR_ACCESS[access.chip] || 'None'}</Badge></span>
              {!access.enforced && !isAdmin && access.chip === 'directory' && <span className="text-xs text-slate-500">(limits not enforced yet)</span>}
            </p>
          </div>
          {!readOnly && (
            <div className="flex flex-wrap gap-2">
              {can.edit_photo && (
                <label className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-navy-900 focus-within:ring-2 focus-within:ring-brand hover:bg-slate-50 ${busy ? 'pointer-events-none opacity-60' : ''}`}>
                  <ImagePlus className="h-3.5 w-3.5" aria-hidden /> {child.has_photo ? 'Change photo' : 'Add photo'}
                  <input type="file" accept="image/jpeg,image/png" className="sr-only" onChange={uploadPhoto} />
                </label>
              )}
              {can.edit_photo && child.has_photo && <Button size="sm" variant="ghost" onClick={() => setConfirm('photo')}>Remove photo</Button>}
              {coreShown && <Button size="sm" variant="secondary" onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" aria-hidden /> Edit</Button>}
              {isAdmin && <Button size="sm" variant="danger" onClick={() => setConfirm('delete')}><Trash2 className="h-3.5 w-3.5" aria-hidden /> Delete</Button>}
            </div>
          )}
        </div>
        {access.initial && (
          <Notice tone="info" className="mt-4" title="Temporary access">
            You registered this child. You can open the core record until {formatDateTime(access.initial.ends_at)} or until a case worker is assigned. Health, adoption and transition records are not included.
            <div className="mt-2"><Button size="sm" variant="secondary" onClick={() => setConfirm('intake')}><CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Mark intake complete</Button></div>
          </Notice>
        )}
        {!isAdmin && access.chip === 'directory' && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <Lock className="h-4 w-4 text-slate-400" aria-hidden />
            <span>You see the directory{can.care_card ? ' and the Care card' : ''}. {CORE_LOCKED}</span>
            {can.request && !access.pending_request && <Button size="sm" variant="secondary" onClick={() => setRequesting(true)}><KeyRound className="h-3.5 w-3.5" aria-hidden /> Request access</Button>}
            {access.pending_request && <Badge tone="amber">Request waiting for an Admin</Badge>}
          </div>
        )}
      </Card>

      <div role="tablist" aria-label="Child record sections" className="relative mb-4 flex gap-1 overflow-x-auto border-b border-slate-200" onKeyDown={onTabKey}>
        {tabs.map(([k, l]) => (
          <button key={k} ref={(el) => { tabRefs.current[k] = el; }} type="button" role="tab" id={`tab-${k}`} aria-selected={tab === k} aria-controls={`panel-${k}`} tabIndex={tab === k ? 0 : -1}
            onClick={() => pickTab(k)}
            className={`-mb-px inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${tab === k ? 'border-brand text-navy-900' : 'border-transparent text-slate-500 hover:text-navy-900'}`}>
            {locked[k] && <Lock className="h-3.5 w-3.5" aria-hidden />}{l}{locked[k] && <span className="sr-only"> (locked)</span>}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} tabIndex={0} className="focus:outline-none">
        {tab === 'overview' && (
          <div className="grid gap-4 lg:grid-cols-5">
            <Card className="p-5 lg:col-span-2">
              <h2 className="mb-4 font-semibold text-navy-900">Directory</h2>
              <dl className="grid grid-cols-2 gap-4">
                <Info label="Case number"><span className="font-mono">{child.child_id}</span></Info>
                <Info label="Name">{child.display_name}</Info>
                <Info label="Status">{child.status}</Info>
                {isAdmin ? <Info label="Case worker">{child.case_worker?.name || 'Not assigned'}</Info> : child.case_worker?.you ? <Info label="Case worker">You</Info> : null}
                <Info label="Date added">{child.created_at ? formatDate(child.created_at) : '-'}</Info>
                <Info label="Last activity">{child.updated_at ? formatDateTime(child.updated_at) : '-'}</Info>
              </dl>
            </Card>
            <div className="lg:col-span-3">{can.care_card || !access.enforced ? <CareCard childId={child.child_id} /> : (
              <LockedPlaceholder title="Care card" message="The Care card is shown to staff on shift." />
            )}</div>
          </div>
        )}
        {tab === 'profile' && (locked.profile ? lockedPanel('profile', 'Profile') : (
          <Card className="p-5">
            <h2 className="mb-4 font-semibold text-navy-900">Profile</h2>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Info label="Full name">{child.full_name}</Info>
              <Info label="Age">{child.age} {child.age === 1 ? 'year' : 'years'}</Info>
              <Info label="Date of birth">{formatDate(child.dob)}</Info>
              <Info label="Gender">{child.gender}</Info>
              <Info label="Admitted">{child.admission_date ? formatDate(child.admission_date) : 'Not recorded'}</Info>
              <Info label="Placement">{child.placement_status || 'None'}</Info>
              <div className="sm:col-span-2"><Info label="Needs donors can see">{child.urgent_needs || <span className="text-slate-400">None posted</span>}</Info></div>
              <div className="sm:col-span-2"><Info label="Public bio">{child.public_bio || <span className="text-slate-400">None</span>}</Info></div>
            </dl>
          </Card>
        ))}
        {tab === 'case_files' && (locked.case_files ? lockedPanel('case_files', 'Case files') : <>
          {child.has_admission_record && <p className="mb-3 text-sm"><Link className="font-medium text-brand hover:underline" to={`/admissions/${encodeURIComponent(child.child_id)}`}>Open the admission record</Link> <span className="text-slate-500">(referral details, parents and guardians, admission checklist and its history)</span></p>}
          <CaseFiles childId={child.child_id} canEdit={!readOnly} />
        </>)}
        {tab === 'health' && (locked.health ? lockedPanel('health', 'Health records') : <ProtectedRecord child={child} />)}
        {tab === 'adoption' && (locked.adoption ? lockedPanel('adoption', 'Adoption records') : (
          <div className="space-y-4">
            <AdoptionHistorySection childId={child.child_id} />
            {child.status === 'Active' && !readOnly && <ChildLegalPanel childId={child.child_id} onChanged={reload} />}
          </div>
        ))}
        {tab === 'transition' && (locked.transition ? lockedPanel('transition', 'Transition Review') : <TransitionSummaryCard childId={child.child_id} firstName={child.first_name || child.display_name} />)}
        {tab === 'access' && can.access_tab && <AccessTab childId={child.child_id} onChanged={reload} />}
      </div>

      {editing && (
        <ChildForm initial={child} onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); reload(); toast('Changes saved.'); }} />
      )}
      {cropFile && <PhotoCropDialog file={cropFile} onCancel={() => setCropFile(null)} onConfirm={saveCropped} />}
      {requesting && <RequestAccessModal childId={child.child_id} onClose={() => setRequesting(false)} onDone={(m) => { setRequesting(false); toast(m); reload(); }} />}
      <ConfirmModal open={!!confirm} onClose={() => setConfirm(null)} loading={busy} onConfirm={doConfirm}
        title={confirm === 'delete' ? 'Delete child record?' : confirm === 'intake' ? 'Mark intake complete?' : 'Remove photo?'}
        confirmLabel={confirm === 'delete' ? 'Delete' : confirm === 'intake' ? 'Mark complete' : 'Remove'}
        message={confirm === 'delete'
          ? `Are you sure you want to delete ${name}'s record? This cannot be undone. Records with discharge, adoption or access history cannot be deleted.`
          : confirm === 'intake' ? 'Your temporary access ends now and you will see the directory only.' : 'Are you sure you want to remove this profile photo?'} />
    </>
  );
}
