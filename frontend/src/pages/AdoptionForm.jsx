import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, CircleAlert, Send } from 'lucide-react';
import useApi from '../hooks/useApi';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import AuthImage from '../components/AuthImage';
import { DISCLAIMER } from './AdoptChild';
import { DOC_TYPES_ALLOWED } from './ApplicationDetail';
import { Button, Card, ErrorNote, Field, PageHeader, Spinner } from '../components/ui';
import { isoDate } from '../lib/format';
import { MB, ageFromDob, checkFile, readFile } from '../lib/files';

const CIVIL = ['Single', 'Married', 'Widowed', 'Separated', 'Annulled'];
const blank = (v) => !String(v ?? '').trim();

function Step({ n, title, children }) {
  return (
    <Card className="p-5">
      <h2 className="mb-4 font-semibold text-navy-900">{n}. {title}</h2>
      <div className="space-y-4">{children}</div>
    </Card>
  );
}

/** The 6-section adoption application. The form is saved first, then each document is uploaded. */
export default function AdoptionForm() {
  const { user } = useAuth();
  const { toast } = useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const children = useApi('/public-children?purpose=adoption');
  const docTypes = useApi('/adoptions/document-types');

  const [form, setForm] = useState({
    legal_name: user.full_name, date_of_birth: '', contact_number: '', email: user.email, address: '', civil_status: 'Single',
    occupation: '', employment_details: '', spouse_details: '', household_members: '', living_conditions: '', caregiving_experience: '',
    child_id: params.get('child') || '', reason_for_adoption: '', declaration_accepted: false,
  });
  const [files, setFiles] = useState({}); // doc_type -> { file, error }
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const types = docTypes.data?.data || [];
  const childList = children.data?.data || [];

  const errors = useMemo(() => {
    const e = {};
    const need = (k, msg) => { if (blank(form[k])) e[k] = msg; };
    need('legal_name', 'Legal name is required.');
    if (!form.date_of_birth) e.date_of_birth = 'Date of birth is required.';
    else if ((ageFromDob(form.date_of_birth) ?? 0) < 18) e.date_of_birth = 'Applicants must be at least 18 years old.';
    need('contact_number', 'Contact number is required.');
    if (!e.contact_number && !/^[+\d][\d\s-]{6,19}$/.test(form.contact_number.trim())) e.contact_number = 'Enter a valid contact number.';
    need('email', 'Email is required.');
    if (!e.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim())) e.email = 'Enter a valid email address.';
    need('address', 'Address is required.');
    need('occupation', 'Occupation is required.');
    need('employment_details', 'Employment details are required.');
    if (form.civil_status === 'Married') need('spouse_details', 'Spouse / co-applicant details are required for married applicants.');
    need('household_members', 'Household members are required.');
    need('living_conditions', 'Living conditions are required.');
    need('caregiving_experience', 'Caregiving experience is required.');
    if (!form.child_id) e.child_id = 'Select a child.';
    for (const t of types) {
      if (files[t.doc_type]?.error) e[`doc_${t.doc_type}`] = files[t.doc_type].error;
      else if (t.required && !files[t.doc_type]?.file) e[`doc_${t.doc_type}`] = 'This document is required.';
    }
    need('reason_for_adoption', 'Reason for adoption is required.');
    if (!form.declaration_accepted) e.declaration_accepted = 'You must confirm the declaration and privacy consent.';
    return e;
  }, [form, files, types]);
  const show = (k) => touched && errors[k];

  const pick = (docType) => (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const problem = checkFile(file, { types: DOC_TYPES_ALLOWED, maxBytes: 10 * MB });
    setFiles((f) => ({ ...f, [docType]: problem ? { error: problem } : { file } }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(errors).length) { setError(new Error('Please complete the highlighted fields.')); return; }
    setSubmitting(true); setError(null);
    let created;
    try {
      setProgress('Submitting application…');
      created = (await api('/adoptions', { method: 'POST', body: { ...form, declaration_accepted: form.declaration_accepted === true } })).data;
      const chosen = types.filter((t) => files[t.doc_type]?.file);
      for (const [i, t] of chosen.entries()) {
        setProgress(`Uploading documents (${i + 1} of ${chosen.length})…`);
        const f = await readFile(files[t.doc_type].file);
        await api(`/adoptions/${created.application_id}/documents`, { method: 'POST', body: { doc_type: t.doc_type, file: { name: f.name, data: f.data } } });
      }
      toast(`Application ${created.reference_no} submitted.`);
      navigate(`/applications/${created.application_id}`);
    } catch (err) {
      if (created) {
        // The application exists; missing documents can be uploaded from its page.
        toast(`Application ${created.reference_no} was submitted, but a document failed to upload: ${err.message}`, 'error');
        navigate(`/applications/${created.application_id}`);
      } else setError(err);
    } finally { setSubmitting(false); setProgress(''); }
  };

  if ((children.loading && !children.data) || (docTypes.loading && !docTypes.data)) return <Spinner />;

  return (
    <form onSubmit={submit} noValidate className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Adoption application" description={DISCLAIMER} />
      <ErrorNote error={error || children.error || docTypes.error} />

      <Step n={1} title="Applicant information">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Legal name" error={show('legal_name')}><input className="input" value={form.legal_name} onChange={set('legal_name')} maxLength={150} /></Field>
          <Field label="Date of birth" error={show('date_of_birth')}><input className="input" type="date" max={isoDate()} value={form.date_of_birth} onChange={set('date_of_birth')} /></Field>
          <Field label="Contact number" error={show('contact_number')}><input className="input" inputMode="tel" value={form.contact_number} onChange={set('contact_number')} placeholder="09XX XXX XXXX" /></Field>
          <Field label="Email" error={show('email')}><input className="input" type="email" value={form.email} onChange={set('email')} /></Field>
        </div>
        <Field label="Address" error={show('address')}><textarea className="input" rows={2} value={form.address} onChange={set('address')} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Civil status"><select className="input" value={form.civil_status} onChange={set('civil_status')}>{CIVIL.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Occupation" error={show('occupation')}><input className="input" value={form.occupation} onChange={set('occupation')} /></Field>
        </div>
        <Field label="Employment details" hint="Employer, position and length of employment." error={show('employment_details')}>
          <textarea className="input" rows={2} value={form.employment_details} onChange={set('employment_details')} />
        </Field>
      </Step>

      <Step n={2} title="Family and household">
        <Field label={`Spouse / co-applicant details${form.civil_status === 'Married' ? '' : ' (if any)'}`} error={show('spouse_details')}>
          <textarea className="input" rows={2} value={form.spouse_details} onChange={set('spouse_details')} />
        </Field>
        <Field label="Household members" hint="Names, ages and relationship to you." error={show('household_members')}><textarea className="input" rows={3} value={form.household_members} onChange={set('household_members')} /></Field>
        <Field label="Living conditions" error={show('living_conditions')}><textarea className="input" rows={2} value={form.living_conditions} onChange={set('living_conditions')} /></Field>
        <Field label="Caregiving experience" error={show('caregiving_experience')}><textarea className="input" rows={2} value={form.caregiving_experience} onChange={set('caregiving_experience')} /></Field>
      </Step>

      <Step n={3} title="Child selection">
        {show('child_id') && <p className="text-sm text-red-600">{errors.child_id}</p>}
        {childList.length === 0 ? <p className="text-sm text-slate-500">No child profiles are available right now.</p> : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {childList.map((c) => (
              <li key={c.child_id}>
                <label className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 ${form.child_id === c.child_id ? 'border-brand ring-2 ring-brand/20' : 'border-slate-200'}`}>
                  <input type="radio" name="child" className="accent-brand" checked={form.child_id === c.child_id} onChange={() => setForm((f) => ({ ...f, child_id: c.child_id }))} />
                  <AuthImage src={c.photo_url} alt="" className="h-12 w-12 rounded-lg" />
                  <span><span className="block font-medium text-navy-900">{c.display_name}</span><span className="text-xs text-slate-500">{c.age_label} · {c.gender}</span></span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </Step>

      <Step n={4} title="Supporting documents">
        <p className="text-sm text-slate-500">PDF, PNG or JPG, up to 10 MB each. Files are stored encrypted.</p>
        <ul className="divide-y divide-slate-100">
          {types.map((t) => {
            const f = files[t.doc_type];
            return (
              <li key={t.doc_type} className="flex flex-wrap items-center gap-3 py-3">
                {f?.file ? <CheckCircle2 className="h-5 w-5 text-emerald-500" aria-hidden /> : <CircleAlert className={`h-5 w-5 ${t.required ? 'text-amber-500' : 'text-slate-300'}`} aria-hidden />}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-navy-900">{t.label}{t.required ? '' : ' (optional)'}</p>
                  <p className={`text-xs ${f?.file ? 'text-emerald-600' : 'text-slate-500'}`}>{f?.file ? `Ready: ${f.file.name}` : 'Missing'}</p>
                  {show(`doc_${t.doc_type}`) && <p className="text-xs text-red-600">{errors[`doc_${t.doc_type}`]}</p>}
                  {!touched && f?.error && <p className="text-xs text-red-600">{f.error}</p>}
                </div>
                <label className="inline-flex cursor-pointer items-center rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-navy-900 hover:bg-slate-50">
                  {f?.file ? 'Change' : 'Choose file'}
                  <input type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" className="sr-only" onChange={pick(t.doc_type)} />
                </label>
              </li>
            );
          })}
        </ul>
      </Step>

      <Step n={5} title="Reason for adoption">
        <Field label="Reason for adoption" error={show('reason_for_adoption')}><textarea className="input" rows={4} value={form.reason_for_adoption} onChange={set('reason_for_adoption')} /></Field>
      </Step>

      <Step n={6} title="Declaration and consent">
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand" checked={form.declaration_accepted} onChange={set('declaration_accepted')} />
          <span className="text-slate-700">
            I declare that the information I have provided is true and accurate. I consent to the home collecting and processing my
            personal data and documents for evaluating this application, in line with the Data Privacy Act of 2012 (RA 10173).
            I understand that {DISCLAIMER.charAt(0).toLowerCase() + DISCLAIMER.slice(1)}
          </span>
        </label>
        {show('declaration_accepted') && <p className="text-sm text-red-600">{errors.declaration_accepted}</p>}
        <p className="text-xs text-slate-500">The date and time of your confirmation are recorded when you submit.</p>
      </Step>

      <div className="flex items-center justify-end gap-3 pb-8">
        {progress && <span className="text-sm text-slate-500" aria-live="polite">{progress}</span>}
        <Button variant="secondary" onClick={() => navigate('/adopt')} disabled={submitting}>Cancel</Button>
        <Button type="submit" loading={submitting} disabled={submitting}><Send className="h-4 w-4" /> Submit application</Button>
      </div>
    </form>
  );
}
