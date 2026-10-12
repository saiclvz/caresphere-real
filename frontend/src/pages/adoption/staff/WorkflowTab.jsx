import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Circle, Lock, Plus, Save } from 'lucide-react';
import { api } from '../../../api/client';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import { formatDate, formatDateTime } from '../../../lib/format';
import { Badge, Button, Card, ErrorNote, Field } from '../../../components/ui';
import { FormField } from '../FieldControls';
import { pageCheck, pageFields } from '../formLogic';
import { headersFor, TabState, useTab } from './common';

export const STATE_WORD = { completed: 'Completed', current: 'Current', blocked: 'Blocked', pending: 'Pending', skipped: 'Not part of this category' };
export const STATE_TONE = { completed: 'green', current: 'blue', blocked: 'red', pending: 'slate', skipped: 'slate' };
const StateIcon = ({ state, className = 'h-3.5 w-3.5' }) => (state === 'completed' ? <CheckCircle2 className={className} aria-hidden />
  : state === 'blocked' ? <Lock className={className} aria-hidden /> : state === 'current' ? <Circle className={`${className} fill-current`} aria-hidden /> : <Circle className={className} aria-hidden />);

/** The stages grouped into phases (display only; the stages and their rules are on the server). */
export const PHASES = [
  { key: 'application', label: 'Application', stages: ['inquiry', 'forum', 'pap', 'documents'] },
  { key: 'assessment', label: 'Assessment', stages: ['assessment', 'eligibility', 'link'] },
  { key: 'placement', label: 'Matching and placement', stages: ['matching', 'placement'] },
  { key: 'legal', label: 'Petition and approvals', stages: ['petition', 'racco', 'nacc', 'order', 'finality'] },
  { key: 'after', label: 'Registration and aftercare', stages: ['identity', 'registration', 'monitoring', 'closure'] },
];
/** Phases with the stages that apply to this case (a stage outside the category is left out), numbered 1..n. */
export function phasesOf(stages) {
  const applicable = (stages || []).filter((s) => s.state !== 'skipped');
  const num = Object.fromEntries(applicable.map((s, i) => [s.key, i + 1]));
  return PHASES.map((p) => {
    const list = p.stages.map((k) => applicable.find((s) => s.key === k)).filter(Boolean).map((s) => ({ ...s, n: num[s.key] }));
    const done = list.filter((s) => s.state === 'completed').length;
    const state = list.length && done === list.length ? 'completed' : list.some((s) => s.state === 'current') ? 'current'
      : list.some((s) => s.state === 'blocked') ? 'blocked' : 'pending';
    const open = list.find((s) => s.state === 'current') || list.find((s) => s.state !== 'completed') || list[list.length - 1];
    return { ...p, list, done, state, open: open?.key };
  }).filter((p) => p.list.length);
}

/** Case progress: five phases across the page (no sideways scrolling), then the current stage in words. */
export function CaseStepper({ stages, selected, onSelect }) {
  if (!stages?.length) return null;
  const phases = phasesOf(stages);
  const all = phases.flatMap((p) => p.list);
  const current = all.find((s) => s.state === 'current');
  const doneCount = all.filter((s) => s.state === 'completed').length;
  const selPhase = phases.find((p) => p.list.some((s) => s.key === selected))?.key;
  return (
    <nav aria-label="Adoption case progress" className="mb-3">
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {phases.map((p, i) => {
          const Tag = onSelect ? 'button' : 'div';
          return (
            <li key={p.key}>
              <Tag {...(onSelect ? { type: 'button', onClick: () => onSelect(p.open), 'aria-current': p.state === 'current' ? 'step' : undefined } : {})}
                className={`flex h-full w-full flex-col gap-1.5 rounded-xl border bg-white p-3 text-left shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                  selPhase === p.key ? 'border-brand ring-1 ring-brand' : p.state === 'blocked' ? 'border-red-200' : 'border-slate-200'} ${onSelect ? 'hover:bg-slate-50' : ''}`}>
                <span className="flex items-center gap-2">
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    p.state === 'completed' ? 'bg-emerald-100 text-emerald-700' : p.state === 'current' ? 'bg-navy-900 text-white' : p.state === 'blocked' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500'}`}>
                    {p.state === 'completed' ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : p.state === 'blocked' ? <Lock className="h-3 w-3" aria-hidden /> : i + 1}</span>
                  <span className="text-sm font-semibold leading-tight text-navy-900">{p.label}</span>
                </span>
                <span className="flex gap-0.5" aria-hidden>
                  {p.list.map((s) => <span key={s.key} title={`${s.label}: ${STATE_WORD[s.state]}`} className={`h-1.5 flex-1 rounded-full ${
                    s.state === 'completed' ? 'bg-emerald-500' : s.state === 'current' ? 'bg-navy-900' : s.state === 'blocked' ? 'bg-red-300' : 'bg-slate-200'}`} />)}
                </span>
                <span className="text-xs text-slate-500">{p.done} of {p.list.length} done{p.state === 'current' || p.state === 'blocked' ? ` · ${STATE_WORD[p.state]}` : ''}</span>
              </Tag>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-sm text-slate-600">
        {current ? <>Now at stage {phases.flatMap((p) => p.list).find((s) => s.key === current.key).n} of {all.length}: <strong className="text-navy-900">{current.label}</strong></> : 'No stage in progress'}
        <span className="text-slate-400"> · {doneCount} of {all.length} stages completed</span>
      </p>
    </nav>
  );
}

/** One field from a stage definition (config/adoptionStages.js). */
function StageInput({ f, value, onChange, error, disabled }) {
  const id = `sf-${f.key}`;
  const common = { id, className: 'input', disabled, 'aria-invalid': error ? 'true' : undefined, value: value || '', onChange: (e) => onChange(e.target.value) };
  const control = f.type === 'textarea' ? <textarea rows={3} maxLength={f.max} {...common} />
    : f.type === 'date' ? <input type="date" max={f.past ? new Date().toISOString().slice(0, 10) : undefined} {...common} />
      : f.type === 'select' || f.type === 'yesno' ? (
        <select {...common}><option value="">Choose...</option>{(f.type === 'yesno' ? ['Yes', 'No'] : f.options).map((o) => <option key={o} value={o}>{o}</option>)}</select>
      ) : <input type="text" maxLength={f.max} {...common} />;
  const req = f.required || (f.requiredWhen ? 'when' : false);
  return <Field label={f.label} required={req === true} error={error} hint={f.requiredWhen ? `Required when ${f.requiredWhen.in.join(' or ').toLowerCase()}.` : f.min ? `At least ${f.min} characters.` : undefined}>{control}</Field>;
}

/** A stage's form: Save persists it (validated on the server, audited, on the timeline). */
function StageForm({ fields, initial, onSubmit, readOnly, submitLabel = 'Save', saved }) {
  const [v, setV] = useState(initial || {});
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setV(initial || {}); }, [initial]);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null); setErrors({});
    try { await onSubmit(v); } catch (err) {
      if (err.details?.errors) { setErrors(err.details.errors); document.getElementById(`sf-${Object.keys(err.details.errors)[0]}`)?.focus(); }
      setError(err);
    } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      <ErrorNote error={error} />
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f, i) => (f.section
          ? <h4 key={`s${i}`} className="border-b border-slate-100 pb-1 pt-2 text-sm font-semibold text-navy-900 sm:col-span-2">{f.section}</h4>
          : <div key={f.key} className={f.type === 'textarea' ? 'sm:col-span-2' : ''}><StageInput f={f} value={v[f.key]} disabled={readOnly} error={errors[f.key]} onChange={(x) => setV((o) => ({ ...o, [f.key]: x }))} /></div>))}
      </div>
      {!readOnly && <div className="flex items-center gap-3"><Button type="submit" size="sm" loading={busy}><Save className="h-4 w-4" aria-hidden /> {submitLabel}</Button>{saved && <span className="text-xs text-slate-500">{saved}</span>}</div>}
      {readOnly && saved && <p className="text-xs text-slate-500">{saved}</p>}
    </form>
  );
}

/** A walk-in case: staff enter the applicant's answers (same questions and checks as the applicant's form). */
function PapAnswers({ app, config, onSaved }) {
  const { toast } = useApp();
  const st = useTab(app.application_id, 'applicant', 0);
  const [form, setForm] = useState(null);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (st.data && !form) setForm({ ...st.data.form, application_type: app.application_type }); }, [st.data, form, app.application_type]);
  if (!form) return <TabState state={st}>{() => null}</TabState>;
  const missing = Object.keys(pageCheck(config, page, form, [])).filter((k) => !k.startsWith('doc:'));
  const save = async () => {
    setBusy(true);
    try { await api(`/adoptions/${app.application_id}/pap-answers`, { method: 'PUT', headers: headersFor(app.application_id), body: { data: form } }); toast('Answers saved.'); onSaved(); }
    catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-navy-900">Application answers</span>
        <select className="input h-9 w-auto" value={page} onChange={(e) => setPage(Number(e.target.value))} aria-label="Page">
          {config.pages.filter((p) => p.n <= 8).map((p) => <option key={p.n} value={p.n}>{p.n}. {p.title}</option>)}
        </select>
        <Badge tone={missing.length ? 'amber' : 'green'}>{missing.length ? `${missing.length} answer${missing.length === 1 ? '' : 's'} missing on this page` : 'Page complete'}</Badge>
      </div>
      <div className="cs-theme space-y-4">{pageFields(config, page, form).map(([key, def]) => <FormField key={key} name={key} def={def} form={form} config={config} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} />)}</div>
      <Button size="sm" loading={busy} onClick={save}><Save className="h-4 w-4" aria-hidden /> Save answers</Button>
      <p className="text-xs text-slate-500">Uploads for this applicant are in the Documents tab.</p>
    </div>
  );
}

function Entries({ app, stage, entries, readOnly, onChanged }) {
  const { toast } = useApp();
  const [adding, setAdding] = useState(false);
  const mine = entries.filter((e) => e.stage_key === stage.key);
  const fields = stage.entries.fields;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between"><h4 className="text-sm font-semibold text-navy-900">{stage.entries.label}s ({mine.length})</h4>
        {!readOnly && !adding && <Button size="sm" variant="secondary" onClick={() => setAdding(true)}><Plus className="h-4 w-4" aria-hidden /> Add {stage.entries.label.toLowerCase()}</Button>}</div>
      {adding && (
        <div className="rounded-lg border border-slate-200 p-3">
          <StageForm fields={fields} initial={{}} submitLabel={`Save ${stage.entries.label.toLowerCase()}`} onSubmit={async (v) => {
            await api(`/adoptions/${app.application_id}/stages/${stage.key}/entries`, { method: 'POST', headers: headersFor(app.application_id), body: { data: v } });
            toast(`${stage.entries.label} recorded.`); setAdding(false); onChanged();
          }} />
          <button type="button" className="mt-2 text-xs text-slate-500 hover:text-navy-900" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      )}
      {mine.length === 0 ? <p className="text-sm text-slate-500">None recorded yet.</p> : (
        <ul className="space-y-2">{mine.map((e) => (
          <li key={e.entry_id} className="rounded-lg border border-slate-100 p-3 text-sm">
            <p className="font-medium text-navy-900">{e.round || e.data.v_type || stage.entries.label} · {formatDate(e.date)}</p>
            <dl className="mt-1 grid gap-x-4 gap-y-1 sm:grid-cols-2">
              {fields.filter((f) => f.key && e.data[f.key] && f.type !== 'date' && f.key !== 'f_round').map((f) => (
                <div key={f.key} className={f.type === 'textarea' ? 'sm:col-span-2' : ''}><dt className="text-xs text-slate-500">{f.label}</dt><dd className="whitespace-pre-line text-navy-900">{e.data[f.key]}</dd></div>
              ))}
            </dl>
            <p className="mt-1 text-xs text-slate-400">Recorded by {e.created_by_name} on {formatDateTime(e.created_at)}. Entries are kept as recorded; add a new one to correct.</p>
          </li>
        ))}</ul>
      )}
    </div>
  );
}

const PROCEED_LABEL = {
  'Forum attended': 'Record Forum attended', 'Case study completed': 'Record Case study completed', 'Cleared for matching': 'Clear for matching',
  'Trial custody': 'Start trial custody', 'Trial custody completed': 'Complete trial custody', 'Petition filed': 'Record Petition filed', Published: 'Record Published',
  'Mandatory appearance done': 'Record the mandatory appearance', 'Endorsed to NACC': 'Endorse to the NACC', 'Order of Adoption issued': 'Record the Order (finalize adoption)',
  'Civil registry updated': 'Record civil registration', Closed: 'Close adoption case',
};

/** The selected stage's workspace. */
function StagePanel({ app, config, d, stageKey, onChanged, onGo }) {
  const { toast } = useApp();
  const { user } = useAuth();
  const isAdmin = user.role === 'Admin';
  const def = d.config.stages.find((s) => s.key === stageKey) || d.config.stages[0];
  const st = d.stages.find((s) => s.key === def.key);
  const rec = d.records[def.key];
  const readOnly = (def.admin && !isAdmin) || ['Declined', 'Withdrawn'].includes(d.status) || (d.status === 'Closed' && def.key !== 'monitoring') || st.state === 'skipped';
  const [busy, setBusy] = useState(null);
  // Same windows as the server: visits during trial custody, follow-ups after the Order (finalization).
  const canAdd = def.key === 'monitoring' ? d.stages.find((s) => s.key === 'order')?.state === 'completed'
    : def.key === 'placement' ? ['Trial custody', 'Trial custody completed'].includes(d.status) : !['pending', 'blocked'].includes(st.state);
  const targets = [].concat(def.proceed || []).filter((t) => d.allowed_statuses.includes(t));
  const proceed = async (target) => {
    setBusy(target);
    try {
      await api(`/adoptions/${app.application_id}/stages/${def.key}/proceed`, { method: 'POST', headers: headersFor(app.application_id), body: { status: target } });
      toast(`Recorded: ${target}.`); onChanged();
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(null); }
  };
  const saveRecord = async (v) => {
    await api(`/adoptions/${app.application_id}/stages/${def.key}/record`, { method: 'POST', headers: headersFor(app.application_id), body: { data: v } });
    toast(`${def.label} saved.`); onChanged();
  };
  const saved = rec ? `Last saved by ${rec.updated_by_name}${rec.updated_by_role ? ` (${rec.updated_by_role})` : ''} on ${formatDateTime(rec.updated_at)}. Earlier versions are kept.` : null;
  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h3 className="text-lg font-semibold text-navy-900">{def.label}</h3><p className="text-sm text-slate-600">{def.help}</p></div>
        <Badge tone={STATE_TONE[st.state]}><StateIcon state={st.state} className="h-3 w-3" /> {STATE_WORD[st.state]}</Badge>
      </div>
      {st.state === 'blocked' && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-900" role="status">Blocked until {st.blocked_by} is complete.</p>}
      {st.outstanding.length > 0 && st.state !== 'skipped' && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          <p className="font-medium">Still to do</p>
          <ul className="mt-1 list-disc pl-5">{st.outstanding.map((o) => <li key={o}>{o}</li>)}</ul>
        </div>
      )}
      {def.admin && !isAdmin && <p className="text-xs text-slate-500">Only an administrator records this stage.</p>}

      {def.key === 'inquiry' && <p className="text-sm text-slate-700">{d.created_by_staff ? 'This case was opened by staff for a walk-in applicant.' : 'The applicant submitted this application online.'} Review it, assign staff, and request any missing documents through Update status.</p>}
      {def.key === 'pap' && (d.created_by_staff ? <PapAnswers app={app} config={config} onSaved={onChanged} /> : (
        <p className="text-sm text-slate-700">The applicant entered the answers online. <button type="button" className="font-medium text-brand hover:underline" onClick={() => onGo('applicant')}>Open the Applicant tab</button> to read them.</p>))}
      {def.key === 'documents' && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>{d.documents_summary.verified} of {d.documents_summary.required} required items verified.</span>
          <Button size="sm" variant="secondary" onClick={() => onGo('documents', 'blocking')}>Open Documents</Button>
          <Button size="sm" variant="secondary" onClick={() => onGo('idcheck')}>Open ID check</Button>
        </div>
      )}
      {def.key === 'eligibility' && <EligibilityPanel app={app} d={d} readOnly={readOnly} onChanged={onChanged} />}
      {['link', 'matching'].includes(def.key) && (
        <p className="text-sm text-slate-700">{def.key === 'link' ? 'Verify the child and the relationship' : 'Propose, review and approve the match'} in <button type="button" className="font-medium text-brand hover:underline" onClick={() => onGo('matching')}>Matching and placement</button>.
          {d.child && <> Child: <Link className="font-medium text-brand hover:underline" to={`/children/${d.child.child_id}`}>{d.child.full_name}</Link> ({d.child.child_id}).</>}</p>
      )}
      {def.record && <StageForm fields={def.record} initial={rec?.data} readOnly={readOnly} onSubmit={saveRecord} saved={saved} />}
      {def.entries && <Entries app={app} stage={def} entries={d.entries} readOnly={readOnly || !canAdd} onChanged={onChanged} />}
      {def.entries && !canAdd && !readOnly && <p className="text-xs text-slate-500">{def.key === 'monitoring' ? 'Follow-ups can be added once the Order of Adoption is recorded.' : def.key === 'placement' ? 'Visits can be added during trial custody.' : `${def.entries.label}s can be added once this stage is reached.`}</p>}
      {def.key === 'closure' && (
        <ul className="space-y-1 text-sm">{d.closure.map((c) => (
          <li key={c.key} className="flex items-center gap-2">{c.done ? <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden /> : <Circle className="h-4 w-4 text-slate-400" aria-hidden />}
            <span className={c.done ? 'text-navy-900' : 'text-slate-600'}>{c.label}</span><span className="sr-only">{c.done ? '(done)' : '(not done)'}</span></li>
        ))}</ul>
      )}
      {targets.length > 0 && !readOnly && (
        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
          {targets.map((t) => <Button key={t} size="sm" loading={busy === t} onClick={() => proceed(t)}>{PROCEED_LABEL[t] || t} <ArrowRight className="h-3.5 w-3.5" aria-hidden /></Button>)}
          <p className="w-full text-xs text-slate-500">Proceed checks every requirement on the server first. If something is missing, nothing changes and you see what to fix.</p>
        </div>
      )}
    </Card>
  );
}

/** Child eligibility: the existing child (from Children Management, read-only here) and its eligibility record. */
function EligibilityPanel({ app, d, readOnly, onChanged }) {
  const { toast } = useApp();
  const [pick, setPick] = useState(d.child?.child_id || '');
  const [busy, setBusy] = useState(false);
  const choose = async () => {
    setBusy(true);
    try { await api(`/adoptions/${app.application_id}/case-child`, { method: 'PUT', headers: headersFor(app.application_id), body: { child_id: pick || null } }); toast('Child selected.'); onChanged(); }
    catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  const c = d.child;
  return (
    <div className="space-y-3">
      {d.children.length > 0 && !readOnly && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Existing child this case is for" className="min-w-[16rem] flex-1">
            <select className="input" value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Choose a child...</option>
              {d.children.map((x) => <option key={x.child_id} value={x.child_id}>{x.full_name} ({x.child_id}, {x.age} yrs){x.eligibility ? ` · ${x.eligibility}` : ''}{x.available ? '' : ' · not marked available'}</option>)}
            </select>
          </Field>
          <Button size="sm" variant="secondary" loading={busy} disabled={pick === (c?.child_id || '')} onClick={choose}>Use this child</Button>
        </div>
      )}
      {c ? (
        <div className="rounded-lg border border-slate-200 p-3 text-sm">
          <p className="font-medium text-navy-900"><Link to={`/children/${c.child_id}`} className="hover:text-brand">{c.full_name}</Link> <span className="font-mono text-xs text-slate-500">{c.child_id}</span></p>
          <p className="text-xs text-slate-500">From Children Management (not copied): {c.sex || '–'} · born {c.dob ? formatDate(c.dob) : '–'} ({c.age} yrs) · {c.status}{c.available_for_adoption ? ' · available for adoption' : ' · not marked available'}{c.cdclaa_verified ? ` · CDCLAA ${c.cdclaa_number || ''} verified` : ' · CDCLAA not verified'}</p>
        </div>
      ) : <p className="text-sm text-slate-500">No child chosen yet.</p>}
      {c && (
        <div>
          <h4 className="mb-1 text-sm font-semibold text-navy-900">Adoption eligibility {d.eligibility && <Badge tone={['Eligible', 'Eligible with conditions'].includes(d.eligibility.status) ? 'green' : 'amber'}>{d.eligibility.status}</Badge>}</h4>
          <StageForm fields={d.config.eligibility_fields} initial={d.eligibility?.data} readOnly={readOnly} submitLabel="Save eligibility"
            saved={d.eligibility ? `Last saved by ${d.eligibility.updated_by_name} on ${formatDateTime(d.eligibility.updated_at)}. Kept on the child's record; earlier versions are kept.` : null}
            onSubmit={async (v) => { await api(`/adoptions/${app.application_id}/eligibility`, { method: 'PUT', headers: headersFor(app.application_id), body: { data: v } }); toast('Eligibility saved.'); onChanged(); }} />
        </div>
      )}
    </div>
  );
}

/** Case workflow tab: the selected stage's workspace (choose a stage in the stepper above or the list here). */
export default function WorkflowTab({ app, config, version, stageKey, onSelectStage, onChanged, onGo }) {
  const state = useTab(app.application_id, 'workflow', version);
  return (
    <TabState state={state} rows={8}>
      {(d) => {
        const key = stageKey || d.stages.find((s) => s.state === 'current')?.key || d.stages.find((s) => s.state !== 'completed' && s.state !== 'skipped')?.key || 'closure';
        // The stages of the phase being viewed (choose a phase in the cards above the tabs).
        const phase = phasesOf(d.stages).find((p) => p.list.some((s) => s.key === key));
        return (
          <div className="space-y-3">
            {phase && (
              <div role="group" aria-label={`${phase.label} stages`} className="flex flex-wrap gap-1.5">
                {phase.list.map((s) => (
                  <button key={s.key} type="button" onClick={() => onSelectStage(s.key)} aria-current={key === s.key ? 'true' : undefined}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                      key === s.key ? 'border-brand bg-brand-50 font-semibold text-navy-900' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
                    <StateIcon state={s.state} className={`h-3.5 w-3.5 ${s.state === 'completed' ? 'text-emerald-600' : s.state === 'blocked' ? 'text-red-600' : ''}`} />
                    {s.n}. {s.label}<span className="sr-only"> ({STATE_WORD[s.state]})</span>
                  </button>
                ))}
              </div>
            )}
            <StagePanel key={`${key}-${version}`} app={app} config={config} d={d} stageKey={key} onChanged={() => { onChanged(); state.reload(); }} onGo={onGo} />
          </div>
        );
      }}
    </TabState>
  );
}
