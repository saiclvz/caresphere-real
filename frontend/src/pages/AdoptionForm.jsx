import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CheckCircle2, Info, Save } from 'lucide-react';
import useApi from '../hooks/useApi';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { Spinner } from '../components/ui';
import { readFile } from '../lib/files';
import { DocumentField, FormField, StatusChip } from './adoption/FieldControls';
import PrivacyNotice from './adoption/PrivacyNotice';
import {
  applicationPath, displayValue, fieldStatus, isVisible, missingItems, pageDocuments, pageFields, validatePage,
} from './adoption/formLogic';
import './adoption/adoption.css';

const AUTOSAVE_MS = 1200;

/**
 * /applications/new: opens the donor's active application (one per donor), or asks for the
 * application type and starts a draft.
 */
export function StartApplication() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const configReq = useApi('/adoptions/form-config');
  const types = configReq.data?.data?.application_types;
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const start = useCallback(async (type) => {
    setBusy(true); setError(null);
    try {
      const res = await api('/adoptions', { method: 'POST', body: { application_type: type } });
      navigate(`/applications/${res.data.application_id}/edit`, { replace: true });
    } catch (err) {
      const existing = err.details?.existing_application_id;
      if (existing) {
        const res = await api(`/adoptions/${existing}`).catch(() => null);
        navigate(res ? applicationPath(res.data) : '/applications', { replace: true });
      } else { setError(err); setBusy(false); }
    }
  }, [navigate]);

  // ?type=Regular|Relative starts right away (used by links that already chose).
  const preset = params.get('type');
  useEffect(() => { if (preset === 'Regular' || preset === 'Relative') start(preset); }, [preset, start]);

  return (
    <div className="cs-theme cs-page">
      <div className="cs-card mx-auto max-w-2xl space-y-4 p-6">
        <div>
          <h1 className="cs-title text-xl">Start an adoption application</h1>
          <p className="cs-muted text-sm">First, choose the type of adoption. You can change it while your application is still a draft.</p>
        </div>
        {error && <div className="cs-notice cs-notice-error" role="alert">{error.message}</div>}
        {!types ? <Spinner /> : (
          <div className="grid gap-3 sm:grid-cols-2">
            {Object.entries(types).map(([key, t]) => (
              <button key={key} type="button" disabled={busy} onClick={() => start(key)} className="cs-card cs-surface-2 p-4 text-left hover:opacity-90 disabled:opacity-50"
                style={{ cursor: busy ? 'wait' : 'pointer' }}>
                <span className="cs-title block">{t.label}</span>
                <span className="cs-muted mt-1 block text-sm">{t.hint}</span>
              </button>
            ))}
          </div>
        )}
        {busy && <p className="cs-muted text-sm" aria-live="polite">Opening your application...</p>}
      </div>
    </div>
  );
}

function SaveIndicator({ state, onRetry }) {
  if (state === 'saving') return <span className="cs-muted text-xs" aria-live="polite">Saving...</span>;
  if (state === 'error') {
    return <span className="text-xs" style={{ color: 'var(--cs-danger)' }} aria-live="polite">Not saved. <button type="button" className="cs-link" onClick={onRetry}>Try again</button></span>;
  }
  if (state === 'saved') return <span className="cs-muted text-xs" aria-live="polite">All changes saved</span>;
  return null;
}

/** Page 9: every visible item with a status chip and an Edit link, then consent and Submit. */
function ReviewPage({ config, form, app, onEdit, consent, setConsent, submitError, missing }) {
  return (
    <div className="space-y-4">
      {config.pages.filter((p) => p.n <= 8).map((p) => {
        const fields = pageFields(config, p.n, form);
        const docs = pageDocuments(config, p.n, form);
        return (
          <section key={p.n} className="cs-card p-4" aria-labelledby={`review-${p.n}`}>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 id={`review-${p.n}`} className="cs-title">{p.n}. {p.title}</h3>
              <button type="button" className="cs-link text-sm" onClick={() => onEdit(p.n)}>Edit<span className="sr-only"> {p.title}</span></button>
            </div>
            <dl>
              {fields.map(([key, def]) => (
                <div key={key} className="flex flex-wrap items-start justify-between gap-2 border-t py-2 cs-divider">
                  <dt className="min-w-0 flex-1 text-sm">
                    <span className="cs-muted">{def.label}</span>
                    <span className="block break-words">{displayValue(config, key, def, form) || <span className="cs-muted">Not answered</span>}</span>
                  </dt>
                  <dd><StatusChip status={fieldStatus(config, key, def, form)} /></dd>
                </div>
              ))}
              {docs.map(([key, def]) => {
                const files = app.documents.filter((d) => d.doc_type === key && d.status !== 'Replaced');
                const status = files.length ? 'Done' : def.required ? 'Missing' : 'Optional';
                return (
                  <div key={key} className="flex flex-wrap items-start justify-between gap-2 border-t py-2 cs-divider">
                    <dt className="min-w-0 flex-1 text-sm">
                      <span className="cs-muted">{def.label}</span>
                      <span className="block break-words">{files.length ? files.map((f) => f.original_name).join(', ') : <span className="cs-muted">No file chosen</span>}</span>
                    </dt>
                    <dd><StatusChip status={status} /></dd>
                  </div>
                );
              })}
              {p.n === 7 && <p className="cs-muted border-t py-2 text-sm cs-divider">Home study report: arranged by the home after you submit. Nothing to upload.</p>}
            </dl>
          </section>
        );
      })}

      <PrivacyNotice notice={config.privacy_notice} />
      <section className="cs-card p-4">
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-0.5 shrink-0" checked={consent} onChange={(e) => setConsent(e.target.checked)} aria-describedby="consent-note" aria-required="true" />
          <span>{config.consent_text}<span className="cs-req" aria-hidden="true">*</span></span>
        </label>
        <p id="consent-note" className="cs-hint mt-2">By ticking this box you also confirm that you have read the privacy notice above. The date and time of your confirmation, and the notice version, are recorded when you submit.</p>
      </section>

      <div className={`cs-notice ${missing.length ? 'cs-notice-warn' : 'cs-notice-success'}`} aria-live="polite">
        {missing.length
          ? <>{missing.length} required item{missing.length === 1 ? ' is' : 's are'} still missing: {missing.slice(0, 6).map((m) => m.label).join(', ')}{missing.length > 6 ? ', and more' : ''}.</>
          : consent ? 'Everything required is complete. You can submit your application.' : 'Everything required is complete. Tick the declaration box to submit.'}
      </div>
      {submitError && <div className="cs-notice cs-notice-error" role="alert">{submitError}</div>}
    </div>
  );
}

function SubmittedView({ app }) {
  return (
    <div className="cs-theme cs-page">
      <div className="cs-card mx-auto max-w-xl space-y-4 p-6 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10" style={{ color: 'var(--cs-success)' }} aria-hidden />
        <h1 className="cs-title text-xl">Application submitted</h1>
        <p className="cs-muted text-sm">Thank you. The home will review your application and contact you about the next steps. Submitting does not guarantee approval.</p>
        <div className="cs-card cs-surface-2 p-4">
          <p className="cs-muted text-xs">Your reference number</p>
          <p className="cs-title font-mono text-2xl tracking-wide">{app.reference_no}</p>
        </div>
        <p className="cs-notice cs-notice-info text-left text-xs">This is a prototype system built for a capstone project. Keep your reference number for any follow-up with the home.</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Link to={`/applications/${app.application_id}`} className="cs-btn cs-btn-primary">View my application</Link>
          <Link to="/applications" className="cs-btn">My applications</Link>
        </div>
      </div>
    </div>
  );
}

/** /applications/:id/edit: the 9-page application with autosave. */
export default function AdoptionForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useApp();
  const configReq = useApi('/adoptions/form-config');
  const config = configReq.data?.data;
  const [app, setApp] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [form, setForm] = useState(null);
  const [page, setPage] = useState(1);
  const [errors, setErrors] = useState({});
  const [saveState, setSaveState] = useState('idle');
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [submitted, setSubmitted] = useState(null);
  const timer = useRef(null);
  const formRef = useRef(null);
  const pageRef = useRef(1);
  const topRef = useRef(null);
  formRef.current = form;
  pageRef.current = page;

  useEffect(() => {
    let alive = true;
    api(`/adoptions/${id}`).then((res) => {
      if (!alive) return;
      if (res.data.status !== 'Draft') { navigate(`/applications/${id}`, { replace: true }); return; }
      setApp(res.data); setForm(res.data.form); setPage(Math.min(9, Math.max(1, res.data.current_page || 1)));
    }).catch((err) => alive && setLoadError(err));
    return () => { alive = false; };
  }, [id, navigate]);

  /** Saves the whole form. With validatePage, the server also returns that page's errors. */
  const save = useCallback(async ({ validatePage: vp, currentPage } = {}) => {
    clearTimeout(timer.current);
    setSaveState('saving');
    try {
      const res = await api(`/adoptions/${id}`, { method: 'PUT', body: { data: formRef.current, current_page: currentPage ?? pageRef.current, validate_page: vp } });
      setSaveState('saved');
      return res.data;
    } catch (err) {
      setSaveState('error');
      throw err;
    }
  }, [id]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const update = (patch) => {
    const next = { ...formRef.current, ...patch };
    formRef.current = next;
    setForm(next);
    // Errors on this page clear as soon as the field is fixed (or hidden). Other pages' errors stay.
    setErrors((prev) => {
      if (!Object.keys(prev).length) return prev;
      const fresh = validatePage(config, pageRef.current, next);
      const out = {};
      for (const [k, msg] of Object.entries(prev)) {
        const onThisPage = config.fields[k]?.page === pageRef.current;
        if (!onThisPage) out[k] = msg;
        else if (fresh[k]) out[k] = fresh[k];
      }
      return out;
    });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { save().catch(() => {}); }, AUTOSAVE_MS);
  };

  const goTo = async (n) => {
    if (n < 1 || n > 9) return;
    try { await save({ currentPage: n }); } catch { /* the indicator shows it; answers stay in the browser */ }
    setPage(n);
    setSubmitError(null);
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /** Next: browser check plus the server's check for this page. Uploads never block Next. */
  const next = async () => {
    const clientErrors = validatePage(config, page, form);
    let serverErrors = {};
    try {
      const res = await save({ validatePage: page });
      serverErrors = res.validation?.errors || {};
    } catch { /* keep the browser check */ }
    const all = { ...serverErrors, ...clientErrors };
    if (Object.keys(all).length) {
      setErrors((prev) => ({ ...prev, ...all }));
      document.getElementById(`f-${Object.keys(all)[0]}`)?.focus();
      return;
    }
    goTo(page + 1);
  };

  const changeType = async (type) => {
    try {
      await api(`/adoptions/${id}`, { method: 'PUT', body: { data: formRef.current, application_type: type } });
      setApp((a) => ({ ...a, application_type: type }));
      toast(type === 'Relative' ? 'Changed to Relative or stepchild. Matching and trial custody will be skipped.' : 'Changed to Regular.');
    } catch (err) { toast(err.message, 'error'); }
  };

  const saveDraft = async () => {
    try { await save(); toast('Draft saved. You can come back to it anytime from My applications.'); } catch (err) { toast(err.message, 'error'); }
  };

  const upload = async (docType, file) => {
    const f = await readFile(file);
    const res = await api(`/adoptions/${id}/documents`, { method: 'POST', body: { doc_type: docType, file: { name: f.name, data: f.data } } });
    setApp(res.data);
  };
  const removeFile = async (doc) => {
    try {
      const res = await api(`/adoptions/${id}/documents/${doc.document_id}`, { method: 'DELETE' });
      setApp(res.data);
    } catch (err) { toast(err.message, 'error'); }
  };

  const submit = async () => {
    setSubmitting(true); setSubmitError(null);
    try {
      await save();
      const res = await api(`/adoptions/${id}/submit`, { method: 'POST', body: {
        consent: true, consent_version: config.consent_version, privacy_notice_version: config.privacy_notice.version,
      } });
      setSubmitted(res.data);
    } catch (err) {
      const pages = err.details?.pages;
      if (pages) setErrors(Object.assign({}, ...Object.values(pages)));
      setSubmitError(err.message);
    } finally { setSubmitting(false); }
  };

  if (submitted) return <SubmittedView app={submitted} />;
  if (loadError || configReq.error) {
    return <div className="cs-theme cs-page"><div className="cs-notice cs-notice-error" role="alert">{(loadError || configReq.error).message}</div></div>;
  }
  if (!config || !app || !form) return <div className="cs-theme cs-page"><Spinner label="Loading your application" /></div>;

  const current = config.pages.find((p) => p.n === page);
  const fields = pageFields(config, page, form);
  const docs = pageDocuments(config, page, form);
  const missing = missingItems(config, form, app.documents);
  const addressStart = fields.findIndex(([, d]) => d.group === 'address');
  const before = addressStart === -1 ? fields : fields.slice(0, addressStart);
  const address = fields.filter(([, d]) => d.group === 'address');
  const after = addressStart === -1 ? [] : fields.slice(addressStart).filter(([, d]) => d.group !== 'address');
  const renderField = ([key, def]) => (
    <FormField key={key} name={key} def={def} form={form} onChange={update} error={errors[key]} config={config} />
  );

  return (
    <div className="cs-theme cs-page" ref={topRef}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="cs-title text-2xl">Adoption application</h1>
          <p className="cs-muted text-sm">Your answers are saved as you type. You can leave and continue later from My applications.</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <label className="flex items-center gap-2 text-sm">
            <span className="cs-muted">Type</span>
            <select className="cs-input" style={{ minHeight: '2rem', width: 'auto', paddingTop: 2, paddingBottom: 2 }} value={app.application_type}
              onChange={(e) => changeType(e.target.value)} aria-label="Application type">
              {Object.entries(config.application_types).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
            </select>
          </label>
          <SaveIndicator state={saveState} onRetry={() => save().catch(() => {})} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <nav aria-label="Application pages" className="cs-card h-fit p-2">
          <div className="px-2 pb-2 pt-1">
            <p className="cs-muted text-xs">Page {page} of {config.pages.length}</p>
            <div className="cs-progress mt-1" role="progressbar" aria-valuemin={1} aria-valuemax={config.pages.length} aria-valuenow={page} aria-label="Progress">
              <span style={{ width: `${(page / config.pages.length) * 100}%` }} />
            </div>
          </div>
          <div className="px-1 pb-1 lg:hidden">
            <label htmlFor="step-select" className="sr-only">Go to page</label>
            <select id="step-select" className="cs-input" value={page} onChange={(e) => goTo(Number(e.target.value))}>
              {config.pages.map((p) => <option key={p.n} value={p.n}>{p.n}. {p.title}</option>)}
            </select>
          </div>
          <ol className="hidden space-y-0.5 lg:block">
            {config.pages.map((p) => (
              <li key={p.n}>
                <button type="button" className="cs-step" aria-current={p.n === page ? 'step' : undefined} onClick={() => goTo(p.n)}>
                  <span className="cs-step-num">{p.n}</span><span>{p.title}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <div className="space-y-4">
          <section className="cs-card space-y-4 p-4 sm:p-6" aria-labelledby="page-title">
            <div>
              <h2 id="page-title" className="cs-title text-lg">{page}. {current.title}</h2>
              {current.note && <p className="cs-muted mt-1 text-sm">{current.note}</p>}
            </div>
            {current.info && (
              <div className="cs-notice cs-notice-info flex gap-3"><Info className="h-5 w-5 shrink-0" aria-hidden /><p>{current.info}</p></div>
            )}

            {page === 9 ? (
              <ReviewPage config={config} form={form} app={app} onEdit={goTo} consent={consent} setConsent={setConsent} submitError={submitError} missing={missing} />
            ) : (
              <>
                {before.map(renderField)}
                {address.length > 0 && (
                  <fieldset className="cs-card cs-surface-2 space-y-4 p-4">
                    <legend className="cs-title px-1 text-sm">Address</legend>
                    <div className="grid gap-4 sm:grid-cols-2">{address.map(renderField)}</div>
                  </fieldset>
                )}
                {after.map(renderField)}
                {docs.length > 0 && (
                  <div className="space-y-3">
                    {docs.map(([key, def]) => (
                      <DocumentField key={key} docType={key} def={def} required={def.required && isVisible(def, form)} rules={config.file_rules}
                        files={app.documents.filter((d) => d.doc_type === key && d.status !== 'Replaced')} onUpload={upload} onRemove={removeFile} />
                    ))}
                    <p className="cs-hint">Missing required files won't stop you from moving on, but they are needed before you submit.</p>
                  </div>
                )}
              </>
            )}
          </section>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <button type="button" className="cs-btn" onClick={() => goTo(page - 1)} disabled={page === 1}>
              <ArrowLeft className="h-4 w-4" aria-hidden /> Back
            </button>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="cs-btn" onClick={saveDraft}><Save className="h-4 w-4" aria-hidden /> Save as draft</button>
              {page < 9 ? (
                <button type="button" className="cs-btn cs-btn-primary" onClick={next}>Next <ArrowRight className="h-4 w-4" aria-hidden /></button>
              ) : (
                <button type="button" className="cs-btn cs-btn-primary" onClick={submit} disabled={submitting || missing.length > 0 || !consent}>
                  {submitting ? 'Submitting...' : 'Submit application'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
