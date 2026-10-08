import { useMemo, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { api } from '../api/client';
import useApi from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { Button, ErrorNote, Field, Modal } from '../components/ui';
import { isoDate } from '../lib/format';
import { MB, ageFromDob, checkFile } from '../lib/files';
import PhotoCropDialog from '../components/PhotoCropDialog';

const OVER_AGE = 'Registration denied. The child exceeds the maximum age requirement.';
const PHOTO_TYPES = ['image/jpeg', 'image/png'];
const blank = (v) => !String(v ?? '').trim();

const EMPTY = {
  first_name: '', last_name: '', gender: 'Female', dob: '', admission_date: isoDate(), urgent_needs: '', public_bio: '', is_public: false, available_for_adoption: false,
  background_care_info: '', guardian_family_info: '',
  blood_type: '', allergies: '', vaccinations: '', prescriptions: '', doctor_notes: '',
  status: 'Active', discharge_reason: '', report_of_what_happened: '', discharge_date: isoDate(),
};

/**
 * Register (Admin) or edit (Admin, Staff) a child.
 *  - New registrations are blocked above the maximum admission age (also enforced by the API).
 *  - Changing status to Discharged requires reason, report and date; "reported by" is the signed-in user.
 *  - Adopted is never chosen here: it is set when an adoption application is marked Completed.
 */
export default function ChildForm({ initial, onClose, onSaved }) {
  const { user } = useAuth();
  const isAdmin = user.role === 'Admin';
  const editing = Boolean(initial);
  const rules = useApi('/children/rules');
  const maxAge = rules.data?.data?.max_admission_age ?? 17;

  const [form, setForm] = useState(() => (editing ? {
    ...EMPTY, ...initial, urgent_needs: initial.urgent_needs || '', public_bio: initial.public_bio || '',
    admission_date: initial.admission_date || '', is_public: !!initial.is_public,
    available_for_adoption: !!initial.available_for_adoption,
  } : EMPTY));
  const [photo, setPhoto] = useState(null);
  const [cropFile, setCropFile] = useState(null); // picked file waiting in the crop step
  const [touched, setTouched] = useState({});
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const touch = (k) => () => setTouched((t) => ({ ...t, [k]: true }));

  const age = ageFromDob(form.dob);
  const overAge = !editing && age !== null && age > maxAge;
  const discharging = editing && form.status === 'Discharged' && initial.status !== 'Discharged';
  const statusLocked = editing && initial.status !== 'Active' && !isAdmin;

  const errors = useMemo(() => {
    const e = {};
    if (blank(form.first_name)) e.first_name = 'First name is required.';
    if (blank(form.last_name)) e.last_name = 'Last name is required.';
    if (!form.dob) e.dob = 'Date of birth is required.';
    else if (form.dob > isoDate()) e.dob = 'Date of birth cannot be in the future.';
    else if (overAge) e.dob = OVER_AGE;
    if (!editing && !form.admission_date) e.admission_date = 'Admission date is required.';
    if (form.admission_date && form.admission_date > isoDate()) e.admission_date = 'Admission date cannot be in the future.';
    if (form.admission_date && form.dob && form.admission_date < form.dob) e.admission_date = 'Admission date cannot be before the date of birth.';
    if (discharging) {
      if (blank(form.discharge_reason)) e.discharge_reason = 'Discharge reason is required.';
      if (blank(form.report_of_what_happened)) e.report_of_what_happened = 'Report of what happened is required.';
      if (!form.discharge_date) e.discharge_date = 'Discharge date is required.';
      else if (form.discharge_date > isoDate()) e.discharge_date = 'Discharge date cannot be in the future.';
    }
    if (photo?.error) e.photo = photo.error;
    return e;
  }, [form, overAge, editing, discharging, photo]);
  const invalid = Object.keys(errors).length > 0;
  const show = (k) => (touched[k] || touched._all || (k === 'dob' && overAge)) && errors[k];

  const pickPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const problem = checkFile(file, { types: PHOTO_TYPES, maxBytes: 5 * MB });
    if (problem) { setPhoto((p) => ({ ...(p?.data ? p : {}), error: `Profile photo: ${problem}` })); return; }
    setCropFile(file); // crop first; only the cropped image is uploaded
  };

  const submit = async (e) => {
    e.preventDefault();
    setTouched({ _all: true });
    if (invalid) return;
    setSaving(true);
    setError(null);
    try {
      let res;
      if (editing) {
        const body = {
          first_name: form.first_name, last_name: form.last_name, gender: form.gender, dob: form.dob,
          admission_date: form.admission_date || null, urgent_needs: form.urgent_needs, public_bio: form.public_bio,
        };
        if (isAdmin) body.is_public = form.is_public;
        body.available_for_adoption = form.available_for_adoption;
        if (form.status !== initial.status) {
          body.status = form.status;
          if (discharging) Object.assign(body, {
            discharge_reason: form.discharge_reason, report_of_what_happened: form.report_of_what_happened, discharge_date: form.discharge_date,
          });
        }
        res = await api(`/children/${initial.child_id}`, { method: 'PUT', body });
      } else {
        res = await api('/children', {
          method: 'POST',
          body: {
            first_name: form.first_name, last_name: form.last_name, gender: form.gender, dob: form.dob, admission_date: form.admission_date,
            urgent_needs: form.urgent_needs, public_bio: form.public_bio, ...(isAdmin && { is_public: form.is_public }), available_for_adoption: form.available_for_adoption,
            background_care_info: form.background_care_info, guardian_family_info: form.guardian_family_info,
            health: { blood_type: form.blood_type, allergies: form.allergies, vaccinations: form.vaccinations, prescriptions: form.prescriptions, doctor_notes: form.doctor_notes },
            photo: photo?.data ? { name: photo.name, data: photo.data } : undefined,
          },
        });
      }
      onSaved(res.data);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={editing ? `Edit ${initial.full_name}` : 'Register a child'} size="lg"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" form="child-form" loading={saving} disabled={overAge || saving}>
          {editing ? 'Save changes' : 'Register child'}
        </Button>
      </>}>
      <form id="child-form" onSubmit={submit} noValidate className="space-y-4">
        <ErrorNote error={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" error={show('first_name')}><input className="input" value={form.first_name} onChange={set('first_name')} onBlur={touch('first_name')} maxLength={50} /></Field>
          <Field label="Last name" error={show('last_name')}><input className="input" value={form.last_name} onChange={set('last_name')} onBlur={touch('last_name')} maxLength={50} /></Field>
          <Field label="Gender"><select className="input" value={form.gender} onChange={set('gender')}><option>Female</option><option>Male</option></select></Field>
          <Field label="Date of birth" error={show('dob')} hint={age !== null && !errors.dob ? `Age: ${age} ${age === 1 ? 'year' : 'years'}` : !editing ? `Children up to ${maxAge} years old can be registered.` : undefined}>
            <input className={`input ${overAge ? 'border-red-400 ring-2 ring-red-100' : ''}`} type="date" max={isoDate()} value={form.dob} onChange={set('dob')} onBlur={touch('dob')} aria-invalid={!!errors.dob} />
          </Field>
          <Field label="Admission date" error={show('admission_date')}><input className="input" type="date" max={isoDate()} value={form.admission_date || ''} onChange={set('admission_date')} onBlur={touch('admission_date')} /></Field>
          {editing && (
            <Field label="Status" hint={statusLocked ? `Only an administrator can change the status of a ${initial.status.toLowerCase()} child.` : 'Adopted is set automatically when an adoption is completed.'}>
              <select className="input" value={form.status} onChange={set('status')} disabled={statusLocked || initial.status === 'Adopted' && !isAdmin}>
                <option>Active</option>
                <option>Discharged</option>
                {initial.status === 'Adopted' && <option>Adopted</option>}
              </select>
            </Field>
          )}
        </div>

        {discharging && (
          <fieldset className="space-y-4 rounded-xl border border-amber-200 bg-amber-50/50 p-4">
            <legend className="px-1 text-sm font-semibold text-amber-900">Discharge documentation (required)</legend>
            <Field label="Discharge reason" error={show('discharge_reason')}><textarea className="input" rows={2} value={form.discharge_reason} onChange={set('discharge_reason')} onBlur={touch('discharge_reason')} /></Field>
            <Field label="Report of what happened" hint="Detailed circumstances and the actions taken." error={show('report_of_what_happened')}>
              <textarea className="input" rows={4} value={form.report_of_what_happened} onChange={set('report_of_what_happened')} onBlur={touch('report_of_what_happened')} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Discharge date" error={show('discharge_date')}><input className="input" type="date" max={isoDate()} value={form.discharge_date} onChange={set('discharge_date')} onBlur={touch('discharge_date')} /></Field>
              <Field label="Reported by"><input className="input bg-slate-50" value={`${user.full_name} (${user.role})`} readOnly /></Field>
            </div>
          </fieldset>
        )}

        <Field label="Needs donors can see" hint="Shown on the donor portal with a shortened name. Don't include health details.">
          <textarea className="input" rows={2} value={form.urgent_needs} onChange={set('urgent_needs')} maxLength={2000} />
        </Field>
        <Field label="Public bio" hint="A short, non-identifying description for the donor and adoption portals.">
          <textarea className="input" rows={2} value={form.public_bio} onChange={set('public_bio')} maxLength={2000} />
        </Field>
        {isAdmin && (
          <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand" checked={form.is_public} onChange={set('is_public')} />
            <span><span className="font-medium text-navy-900">Show on the donor portal</span>
              <span className="block text-slate-500">Donors can pick this child when donating. Only the first name, last initial, age, photo, bio and needs are shown. Confirm consent before enabling.</span></span>
          </label>
        )}
        <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand" checked={form.available_for_adoption} onChange={set('available_for_adoption')}
            disabled={!editing || form.status !== 'Active' || (!initial?.cdclaa_verified && !form.available_for_adoption)} />
          <span><span className="font-medium text-navy-900">Available for adoption</span>
            <span className="block text-slate-500">Lists this child on Adopt a Child for donor accounts. Only Active children under 18 appear.
              {(!editing || !initial?.cdclaa_verified) && ' Needs a CDCLAA verified by an administrator first (record it on the child\'s page).'}</span></span>
        </label>

        {!editing && (
          <>
            <Field label="Profile photo (optional)" error={show('photo') || photo?.error} hint="JPG or PNG, up to 5 MB. Stored encrypted.">
              <div className="flex items-center gap-3">
                {photo?.preview && <img src={photo.preview} alt="Cropped preview" className="h-14 w-14 rounded-lg object-cover" />}
                <span className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-navy-900 hover:bg-slate-50">
                  <ImagePlus className="h-4 w-4" /> {photo?.data ? 'Change photo' : 'Choose photo'}
                  <input type="file" accept="image/jpeg,image/png" className="sr-only" onChange={pickPhoto} />
                </span>
              </div>
            </Field>
            {cropFile && (
              <PhotoCropDialog file={cropFile} onCancel={() => setCropFile(null)}
                onConfirm={(out) => { setPhoto({ name: out.name, data: out.data, preview: out.preview }); setCropFile(null); }} />
            )}
            <fieldset className="space-y-4 rounded-xl border border-slate-200 p-4">
              <legend className="px-1 text-sm font-semibold text-navy-900">Case files (encrypted)</legend>
              <Field label="Background and care information"><textarea className="input" rows={3} value={form.background_care_info} onChange={set('background_care_info')} /></Field>
              <Field label="Guardian and family information"><textarea className="input" rows={3} value={form.guardian_family_info} onChange={set('guardian_family_info')} /></Field>
            </fieldset>
            <fieldset className="space-y-4 rounded-xl border border-slate-200 p-4">
              <legend className="px-1 text-sm font-semibold text-navy-900">Health history (encrypted)</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Blood type"><input className="input" value={form.blood_type} onChange={set('blood_type')} maxLength={10} /></Field>
                <Field label="Allergies"><input className="input" value={form.allergies} onChange={set('allergies')} /></Field>
              </div>
              <Field label="Immunizations"><textarea className="input" rows={2} value={form.vaccinations} onChange={set('vaccinations')} /></Field>
              <Field label="Prescriptions"><textarea className="input" rows={2} value={form.prescriptions} onChange={set('prescriptions')} /></Field>
              <Field label="Doctor's notes"><textarea className="input" rows={2} value={form.doctor_notes} onChange={set('doctor_notes')} /></Field>
            </fieldset>
          </>
        )}
      </form>
    </Modal>
  );
}
