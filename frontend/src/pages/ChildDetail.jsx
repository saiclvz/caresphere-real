import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, GraduationCap, ImagePlus, Pencil, Trash2 } from 'lucide-react';
import useApi from '../hooks/useApi';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import AuthImage from '../components/AuthImage';
import ProtectedRecord from '../components/ProtectedRecord';
import ChildForm from './ChildForm';
import { STATUS_TONE } from './Children';
import { Badge, Button, Card, ConfirmModal, ErrorNote, Spinner } from '../components/ui';
import { formatDate, formatDateTime } from '../lib/format';
import { MB, checkFile } from '../lib/files';
import PhotoCropDialog from '../components/PhotoCropDialog';
import ChildLegalPanel from '../components/adoption/ChildLegalPanel';
import ChildCaseWorker from '../components/ChildCaseWorker';
import AdoptionHistorySection from '../components/adoption/AdoptionHistorySection';

function Info({ label, children }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-navy-900">{children}</dd>
    </div>
  );
}

export default function ChildDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useApp();
  const isAdmin = user.role === 'Admin';
  const { data, loading, error, reload } = useApi(`/children/${id}`);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(null); // 'delete' | 'photo'
  const [busy, setBusy] = useState(false);
  const [cropFile, setCropFile] = useState(null); // picked photo waiting in the crop step

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  const child = data.data;

  const uploadPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const problem = checkFile(file, { types: ['image/jpeg', 'image/png'], maxBytes: 5 * MB });
    if (problem) { toast(`Profile photo: ${problem}`, 'error'); return; }
    setCropFile(file); // crop first; only the cropped image is uploaded
  };

  // Called by the crop dialog. Errors are shown in the dialog so the user can retry or cancel.
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
      await api(`/children/${child.child_id}/photo`, { method: 'DELETE' });
      await reload();
      toast('Photo removed.');
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); setConfirm(null); }
  };

  return (
    <>
      <Link to="/children" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-navy-900"><ArrowLeft className="h-4 w-4" /> Children</Link>

      <Card className="mb-6 p-5">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <div className="relative">
            <AuthImage src={child.profile_photo_url} alt={child.full_name} className="h-24 w-24 rounded-2xl" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-semibold text-navy-900">{child.full_name}</h1>
            <p className="text-sm text-slate-500">{child.child_id}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge tone={STATUS_TONE[child.status]}>{child.status}</Badge>
              {child.transition_flag && <Badge tone="amber"><GraduationCap className="h-3 w-3" /> Transition Review (18+){child.transition_status ? `: ${child.transition_status}` : ''}</Badge>}
              {child.is_public && <Badge tone="blue">Shown on donor portal</Badge>}
              {child.available_for_adoption && <Badge tone="green">Available for adoption</Badge>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-navy-900 hover:bg-slate-50 ${busy ? 'pointer-events-none opacity-60' : ''}`}>
              <ImagePlus className="h-3.5 w-3.5" /> {child.has_photo ? 'Change photo' : 'Add photo'}
              <input type="file" accept="image/jpeg,image/png" className="sr-only" onChange={uploadPhoto} />
            </label>
            {child.has_photo && <Button size="sm" variant="ghost" onClick={() => setConfirm('photo')}>Remove photo</Button>}
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
            {isAdmin && <Button size="sm" variant="danger" onClick={() => setConfirm('delete')}><Trash2 className="h-3.5 w-3.5" /> Delete</Button>}
          </div>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-2">
          <Card className="p-5">
            <h2 className="mb-4 font-semibold text-navy-900">Profile</h2>
            <dl className="grid grid-cols-2 gap-4">
              <Info label="Age">{child.age} {child.age === 1 ? 'year' : 'years'}</Info>
              <Info label="Date of birth">{formatDate(child.dob)}</Info>
              <Info label="Gender">{child.gender}</Info>
              <Info label="Admitted">{child.admission_date ? formatDate(child.admission_date) : 'Not recorded'}</Info>
              <div className="col-span-2"><Info label="Needs donors can see">{child.urgent_needs || <span className="text-slate-400">None posted</span>}</Info></div>
              <div className="col-span-2"><Info label="Public bio">{child.public_bio || <span className="text-slate-400">None</span>}</Info></div>
            </dl>
          </Card>

          {child.transition_flag && (
            <Card className="border-amber-200 p-5">
              <h2 className="flex items-center gap-2 font-semibold text-navy-900"><GraduationCap className="h-4 w-4 text-amber-600" /> Transition Review (18+)</h2>
              <p className="mt-1 text-sm text-slate-600">
                {child.first_name} has turned 18. The record stays active while a transition plan is prepared. Status: <strong>{child.transition_status || 'For Review'}</strong>.
              </p>
              <Link to={child.transition_review_id ? `/transition-reviews/${child.transition_review_id}` : '/transitions'} className="mt-3 inline-block text-sm font-medium text-brand hover:underline">Open Transition Review</Link>
            </Card>
          )}

          <Card className="p-5">
            <h2 className="mb-3 font-semibold text-navy-900">Discharge history</h2>
            {child.discharge_history.length === 0 ? <p className="text-sm text-slate-500">No discharges recorded.</p> : (
              <ol className="space-y-4">
                {child.discharge_history.map((d) => (
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

          <AdoptionHistorySection childId={child.child_id} />
          {isAdmin && <ChildCaseWorker child={child} onSaved={reload} />}
          {child.status === 'Active' && <ChildLegalPanel childId={child.child_id} onChanged={reload} />}
        </div>

        <div className="lg:col-span-3">
          <ProtectedRecord child={child} />
        </div>
      </div>

      {editing && (
        <ChildForm initial={child} onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); reload(); toast('Changes saved.'); }} />
      )}
      {cropFile && <PhotoCropDialog file={cropFile} onCancel={() => setCropFile(null)} onConfirm={saveCropped} />}
      <ConfirmModal open={!!confirm} onClose={() => setConfirm(null)} loading={busy} onConfirm={doConfirm}
        title={confirm === 'delete' ? 'Delete child record?' : 'Remove photo?'}
        confirmLabel={confirm === 'delete' ? 'Delete' : 'Remove'}
        message={confirm === 'delete'
          ? `Are you sure you want to delete ${child.full_name}'s record? This cannot be undone. Records with discharge or adoption history cannot be deleted.`
          : 'Are you sure you want to remove this profile photo?'} />
    </>
  );
}
