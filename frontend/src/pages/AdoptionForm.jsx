import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Info, Lock, Save } from 'lucide-react';
import useApi from '../hooks/useApi';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { Spinner } from '../components/ui';
import { readFile } from '../lib/files';
import { DocumentField, FormField, StatusChip } from './adoption/FieldControls';
import PrivacyNotice from './adoption/PrivacyNotice';
import {
  applicationPath, completedPages, displayValue, docRequired, errorLabel, fieldStatus, ID_SIDE_DOCS, missingItems, pageCheck, pageDocuments, pageFields, reachablePage,
} from './adoption/formLogic';
import IdCapture from '../components/adoption/IdCapture';
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
  useEffect(() => { if (preset && types?.[preset]) start(preset); }, [preset, start, types]);

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
    return <span className="text-xs" style={{ color: 'var(--ad-danger)' }} aria-live="polite">Not saved. <button type="button" className="cs-link" onClick={onRetry}>Try again</button></span>;
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
        const left = Object.keys(pageCheck(config, p.n, form, app.documents)).length;
        return (
          <section key={p.n} className="cs-card p-4" aria-labelledby={`review-${p.n}`}>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 id={`review-${p.n}`} className="cs-title flex items-center gap-2">{p.n}. {p.title} <StatusChip status={left ? 'Missing' : 'Done'} />
                {left > 0 && <span className="cs-muted text-xs font-normal">{left} item{left === 1 ? '' : 's'} to complete</span>}</h3>
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
                const status = files.length ? 'Done' : docRequired(config, key, def, form) ? 'Missing' : 'Optional';
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
        <CheckCircle2 className="mx-auto h-10 w-10" style={{ color: 'var(--ad-success)' }} aria-hidden />
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
  const [summary, setSummary] = useState([]); // keys of the items missing on this page, after Next
  const [serverDone, setServerDone] = useState(null); // pages the server accepted as complete
  const summaryRef = useRef(null);
  const appRef = useRef(null);
  const timer = useRef(null);
  const formRef = useRef(null);
  const pageRef = useRef(1);
  const topRef = useRef(null);
  formRef.current = form;
  pageRef.current = page;
  appRef.current = app;

  useEffect(() => {
    let alive = true;
    api(`/adoptions/${id}`).then((res) => {
      if (!alive) return;
      if (res.data.status !== 'Draft') { navigate(`/applications/${id}`, { replace: true }); return; }
      setApp(res.data); setForm({ ...res.data.form, application_type: res.data.application_type });
      setServerDone(res.data.completed_pages || null);
      setPage(Math.min(res.data.reachable_page || 9, Math.max(1, res.data.current_page || 1)));
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
      if (res.data?.completed_pages) setServerDone(res.data.completed_pages);
      return res.data;
    } catch (err) {
      // 422 = saved, but this page still has required items missing (Next only).
      setSaveState(err.status === 422 ? 'saved' : 'error');
      throw err;
    }
  }, [id]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const update = (patch) => {
    const next = { ...formRef.current, ...patch };
    formRef.current = next;
    setForm(next);
    // Errors clear as soon as the item is fixed or hidden (the page recalculates on every change).
    setErrors((prev) => {
      if (!Object.keys(prev).length) return prev;
      const fresh = pageCheck(config, pageRef.current, next, appRef.current?.documents || []);
      const out = {};
      for (const [k, msg] of Object.entries(prev)) {
        const onThisPage = k.startsWith('doc:') ? config.documents[k.slice(4)]?.page === pageRef.current : config.fields[k]?.page === pageRef.current;
        if (!onThisPage) out[k] = msg;
        else if (fresh[k]) out[k] = fresh[k];
      }
      return out;
    });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { save().catch(() => {}); }, AUTOSAVE_MS);
  };

  /** Shows the missing items: inline errors, the summary at the top (announced), focus on the first one. */
  const showMissing = (errs) => {
    setErrors((prev) => ({ ...prev, ...errs }));
    setSummary(Object.keys(errs));
    requestAnimationFrame(() => {
      const first = Object.keys(errs)[0];
      const el = document.getElementById(`f-${first}`);
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus({ preventScroll: true }); } else summaryRef.current?.focus();
    });
  };

  const open = async (n) => {
    try { await save({ currentPage: n }); } catch { /* the indicator shows it; answers stay in the browser */ }
    setPage(n);
    setSummary([]);
    setSubmitError(null);
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /**
   * Next: every visible required item on this page must be complete (fields and uploads). The browser
   * checks first; the server checks again and refuses (422) with the missing items. Never skips pages.
   */
  const next = async () => {
    const clientErrors = pageCheck(config, page, formRef.current, app.documents);
    if (Object.keys(clientErrors).length) {
      save().catch(() => {}); // keep what was typed
      showMissing(clientErrors);
      return;
    }
    try {
      const res = await save({ validatePage: page, currentPage: page + 1 });
      setServerDone(res.completed_pages || null);
    } catch (err) {
      const errs = err.details?.validation?.errors;
      if (errs && Object.keys(errs).length) { setServerDone(err.details.completed_pages || null); showMissing(errs); return; }
      toast(err.message, 'error');
      return;
    }
    setPage(page + 1);
    setSummary([]);
    setSubmitError(null);
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /** The stepper: earlier pages always open; a later page only when every page before it is complete. */
  const goTo = async (n) => {
    if (n < 1 || n > 9 || n === page) return;
    if (n < page) { open(n); return; }
    const done = completedPages(config, formRef.current, app.documents);
    if (n > reachablePage(done)) {
      // Explain what is missing on the current page (or the first incomplete page before it).
      if (!done.includes(page)) { showMissing(pageCheck(config, page, formRef.current, app.documents)); return; }
      toast(`Finish page ${reachablePage(done)} first.`, 'error');
      return;
    }
    open(n);
  };

  const changeType = async (type) => {
    try {
      await api(`/adoptions/${id}`, { method: 'PUT', body: { data: formRef.current, application_type: type } });
      setApp((a) => ({ ...a, application_type: type }));
      formRef.current = { ...formRef.current, application_type: type };
      setForm(formRef.current);
      toast(`Changed to ${config.application_types[type]?.label || type}. The document list was updated.`);
    } catch (err) { toast(err.message, 'error'); }
  };

  const saveDraft = async () => {
    try { await save(); toast('Draft saved. You can come back to it anytime from My applications.'); } catch (err) { toast(err.message, 'error'); }
  };

  const upload = async (docType, file, issuedDate) => {
    const f = await readFile(file);
    const res = await api(`/adoptions/${id}/documents`, { method: 'POST', body: { doc_type: docType, file: { name: f.name, data: f.data }, issued_date: issuedDate } });
    setApp(res.data);
    setErrors((prev) => { if (!prev[`doc:${docType}`]) return prev; const n = { ...prev }; delete n[`doc:${docType}`]; return n; });
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
  const idSides = pageDocuments(config, page, form).filter(([k]) => ID_SIDE_DOCS.includes(k));
  const docs = pageDocuments(config, page, form).filter(([k]) => !ID_SIDE_DOCS.includes(k));
  const missing = missingItems(config, form, app.documents);
  // Completion is recalculated on every change (hidden items never count); the server's state is used too.
  const done = completedPages(config, form, app.documents);
  const reachable = reachablePage(done);
  const groups = config.field_groups || { address: { label: 'Address' } };
  // Fields in order; a group's fields are shown together in one box where the group's first field is.
  const blocks = [];
  for (const entry of fields) {
    const g = entry[1].group;
    const last = blocks[blocks.length - 1];
    if (g && last?.group === g) last.items.push(entry);
    else if (g && blocks.some((b) => b.group === g)) blocks.find((b) => b.group === g).items.push(entry);
    else blocks.push({ group: g || null, items: [entry] });
  }
  const renderField = ([key, def]) => (
    <FormField key={key} name={key} def={def} form={form} onChange={update} error={errors[key]} config={config} />
  );
  const summaryKeys = summary.filter((k) => errors[k]);

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
              {config.pages.map((p) => <option key={p.n} value={p.n}>{p.n}. {p.title}{p.n > reachable && p.n !== page ? ' (locked)' : p.n <= 8 && done.includes(p.n) ? ' (done)' : ''}</option>)}
            </select>
          </div>
          <ol className="hidden space-y-0.5 lg:block">
            {config.pages.map((p) => {
              const locked = p.n > reachable && p.n !== page;
              const isDone = p.n <= 8 && done.includes(p.n) && !locked;
              return (
                <li key={p.n}>
                  <button type="button" className={`cs-step ${isDone ? 'is-done' : ''} ${locked ? 'is-locked' : ''}`} aria-current={p.n === page ? 'step' : undefined}
                    aria-disabled={locked ? 'true' : undefined} onClick={() => goTo(p.n)}>
                    <span className="cs-step-num">{isDone && p.n !== page ? <Check className="h-3.5 w-3.5" aria-hidden /> : locked ? <Lock className="h-3 w-3" aria-hidden /> : p.n}</span>
                    <span>{p.title}</span>
                    <span className="sr-only">{isDone ? ' (complete)' : locked ? ' (locked until the earlier pages are complete)' : ''}</span>
                  </button>
                </li>
              );
            })}
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
            <div aria-live="assertive" aria-atomic="true">
              {page < 9 && summaryKeys.length > 0 && (
                <div ref={summaryRef} tabIndex={-1} className="cs-notice cs-notice-error" role="alert">
                  <p className="font-semibold">{summaryKeys.length} required item{summaryKeys.length === 1 ? '' : 's'} left on this page</p>
                  <ul className="mt-1 list-disc pl-5 text-sm">
                    {summaryKeys.map((k) => (
                      <li key={k}><a href={`#f-${k}`} className="cs-link" onClick={(e) => { e.preventDefault(); const el = document.getElementById(`f-${k}`); el?.scrollIntoView({ behavior: 'smooth', block: 'center' }); el?.focus({ preventScroll: true }); }}>
                        {errorLabel(config, k)}</a>: {errors[k]}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {page === 9 ? (
              <ReviewPage config={config} form={form} app={app} onEdit={goTo} consent={consent} setConsent={setConsent} submitError={submitError} missing={missing} />
            ) : (
              <>
                {blocks.map((b, i) => (b.group ? (
                  <fieldset key={b.group} className="cs-card cs-surface-2 space-y-4 p-4">
                    <legend className="cs-title px-1 text-sm">{groups[b.group]?.label || b.group}</legend>
                    {groups[b.group]?.note && <p className="cs-hint">{groups[b.group].note}</p>}
                    <div className={`grid gap-4 ${b.group === 'address' ? 'sm:grid-cols-2' : ''}`}>{b.items.map(renderField)}</div>
                  </fieldset>
                ) : <div key={`f${i}`} className="space-y-4">{b.items.map(renderField)}</div>))}
                {idSides.length > 0 && (
                  <IdCapture appId={id} config={config} form={form} documents={app.documents} onUpload={upload} onRemove={removeFile} errors={errors} />
                )}
                {docs.length > 0 && (
                  <div className="space-y-3">
                    {docs.map(([key, def]) => (
                      <DocumentField key={key} docType={key} def={def} required={docRequired(config, key, def, form)} rules={config.file_rules} requiredError={errors[`doc:${key}`]}
                        files={app.documents.filter((d) => d.doc_type === key && d.status !== 'Replaced')} onUpload={upload} onRemove={removeFile} />
                    ))}
                    <p className="cs-hint">Required files must be uploaded before you can continue. The home checks them later; that check never stops you from moving on.</p>
                  </div>
                )}
              </>
            )}
          </section>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <button type="button" className="cs-btn" onClick={() => open(page - 1)} disabled={page === 1}>
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
