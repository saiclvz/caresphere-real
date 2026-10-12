import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarPlus, Pencil, Plus, Save, X } from 'lucide-react';
import { Badge, Button, Card, ConfirmModal, ErrorNote, Modal } from '../../components/ui';
import { formatDate, formatDateTime } from '../../lib/format';
import { Check, F, PRIORITY_TONE, Progress, SavedBy, Select, StageDocuments, TASK_TONE, today, useStageSave } from './common';

const writable = (review, admin = false) => review.permissions.can_edit && (!admin || review.permissions.admin);
const AdminOnly = ({ what }) => <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600" role="note">Only an administrator records {what}. You can read it here once it is recorded.</p>;
const ClosedNote = ({ review }) => (review.permissions.closed ? <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600" role="note">This review is closed and read-only{review.permissions.admin ? '. As an administrator you can still correct it; every change is logged.' : '.'}</p> : null);
const Row = ({ label, children }) => <div><dt className="text-xs text-slate-500">{label}</dt><dd className="text-sm text-navy-900">{children || <span className="text-slate-400">Not recorded</span>}</dd></div>;

// ---------------------------------------------------------------- 1. Identify for review

export function IdentifyStage({ review, onSaved, goTo }) {
  const c = review.config;
  const [v, setV] = useState({
    proposed_pathway: review.proposed_pathway || '', target_transition_date: review.target_transition_date || '', housing_goal: review.housing_goal || '',
    vocational_goal: review.vocational_goal || '', education_goal: review.education_goal || '', informed_at: review.informed_at ? String(review.informed_at).slice(0, 10) : '', informed_by: review.informed_by || '',
  });
  const set = (k) => (e) => setV((o) => ({ ...o, [k]: e?.target ? e.target.value : e }));
  const { busy, errors, error, run } = useStageSave(review, onSaved);
  const can = writable(review);
  const begin = async () => { if (await run('begin', '/begin-assessment', 'POST', undefined, 'Assessment started.')) goTo('assessment'); };
  return (
    <div className="space-y-5">
      <dl className="grid gap-3 rounded-lg border border-slate-200 p-4 sm:grid-cols-3">
        <Row label="Young person">{review.full_name}</Row>
        <Row label="Case number"><span className="font-mono">{review.case_number}</span></Row>
        <Row label="Age">{review.age} years old</Row>
        <Row label="Date flagged">{formatDate(review.flagged_at)}</Row>
        <Row label="Current placement">{review.current_placement}</Row>
        <Row label="Assigned social worker">{review.assigned_staff?.name || 'Not assigned'}</Row>
        <Row label="Child record status">{review.child_status}</Row>
        <Row label="Review status">{review.review_status}</Row>
        <Row label="Date of birth">{formatDate(review.dob)}</Row>
      </dl>
      <Link to={`/children/${review.child_id}`} className="inline-block text-sm font-medium text-brand hover:underline">Open the child's record</Link>
      <ErrorNote error={error && !Object.keys(errors).length ? error : null} />
      <div className="grid gap-3 sm:grid-cols-2">
        <F name="proposed_pathway" label="Proposed pathway" errors={errors}><Select value={v.proposed_pathway} disabled={!can} options={c.pathways} onChange={set('proposed_pathway')} /></F>
        <F name="target_transition_date" label="Target transition date" errors={errors}><input type="date" className="input" disabled={!can} value={v.target_transition_date} onChange={set('target_transition_date')} /></F>
        <F name="housing_goal" label="Housing goal" errors={errors} className="sm:col-span-2"><textarea rows={2} maxLength={3000} className="input" disabled={!can} value={v.housing_goal} onChange={set('housing_goal')} /></F>
        <F name="vocational_goal" label="Vocational goal" errors={errors}><textarea rows={2} maxLength={3000} className="input" disabled={!can} value={v.vocational_goal} onChange={set('vocational_goal')} /></F>
        <F name="education_goal" label="Education goal" errors={errors}><textarea rows={2} maxLength={3000} className="input" disabled={!can} value={v.education_goal} onChange={set('education_goal')} /></F>
      </div>
      <fieldset className="space-y-2 rounded-lg border border-slate-200 p-3">
        <legend className="px-1 text-sm font-medium text-navy-800">Young person informed of this review and their data rights</legend>
        <p className="text-xs text-slate-500">They are an adult data subject (RA 10173).</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <F name="informed_at" label="Date informed" errors={errors}><input type="date" className="input" max={today()} disabled={!can} value={v.informed_at} onChange={set('informed_at')} /></F>
          <F name="informed_by" label="Informed by" errors={errors}><input className="input" maxLength={150} disabled={!can} value={v.informed_by} onChange={set('informed_by')} /></F>
        </div>
      </fieldset>
      {can && (
        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
          <Button variant="secondary" loading={busy === 'save'} onClick={() => run('save', '', 'PUT', v, 'Details saved.')}><Save className="h-4 w-4" aria-hidden /> Save details</Button>
          {!review.assessment_started_at
            ? <Button loading={busy === 'begin'} onClick={begin}>Begin Assessment <ArrowRight className="h-4 w-4" aria-hidden /></Button>
            : <Button variant="secondary" onClick={() => goTo('assessment')}>Go to the assessment <ArrowRight className="h-4 w-4" aria-hidden /></Button>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 2. Assessment + Child's Voice

const SCORE = { 'Needs Improvement': 1, 'Partially Ready': 2, Ready: 3 };

export function AssessmentStage({ review, onSaved, goTo }) {
  const c = review.config;
  const a = review.workflow.assessment;
  const voice = review.workflow.voice;
  const [ratings, setRatings] = useState(() => a?.ratings || {});
  const [notes, setNotes] = useState(() => a?.notes || {});
  const [overall, setOverall] = useState(a?.overall_readiness || '');
  const [vc, setVc] = useState(() => ({ ...(voice?.answers || {}), declined: voice?.declined || false }));
  const { busy, errors, error, run } = useStageSave(review, onSaved);
  const can = writable(review) && Boolean(review.assessment_started_at);
  const score = (cat) => {
    const vals = cat.items.map(([k]) => SCORE[ratings[k]]).filter(Boolean);
    return { rated: vals.length, total: cat.items.length, pct: vals.length ? Math.round((vals.reduce((x, y) => x + y, 0) / (vals.length * 3)) * 100) : null };
  };
  const body = (complete) => ({ ratings, notes, overall_readiness: overall, voice: vc, complete });
  const saveContinue = async () => { if (await run('complete', '/assessment', 'PUT', body(true), 'Assessment saved and completed.')) goTo('conference'); };
  if (!review.assessment_started_at) return <p className="text-sm text-slate-600">Begin the assessment from <button type="button" className="font-medium text-brand hover:underline" onClick={() => goTo('identify')}>Identify for review</button>.</p>;
  return (
    <div className="space-y-5">
      {a?.completed_at && <Badge tone="green">Completed {formatDate(a.completed_at)}</Badge>}
      <ErrorNote error={error && !Object.keys(errors).length ? error : null} />
      {error && Object.keys(errors).length > 0 && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{error.message} Fix the items marked below.</p>}
      {c.categories.map((cat) => {
        const sc = score(cat);
        return (
          <fieldset key={cat.key} className="rounded-lg border border-slate-200 p-3">
            <legend className="px-1 text-sm font-semibold text-navy-900">{cat.label}</legend>
            <p className="mb-2 text-xs text-slate-500">{sc.rated} of {sc.total} rated{sc.pct !== null ? ` · readiness guide ${sc.pct}%` : ''}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {cat.items.map(([k, label]) => (
                <F key={k} name={`rating_${k}`} label={label} errors={errors}>
                  <select className="input" disabled={!can} value={ratings[k] || 'Not Assessed'} onChange={(e) => setRatings((r) => ({ ...r, [k]: e.target.value }))}>
                    {c.ratings.map((o) => <option key={o}>{o}</option>)}
                  </select>
                </F>
              ))}
            </div>
            <F name={`notes_${cat.key}`} label="Social worker notes" errors={errors} className="mt-2">
              <textarea rows={2} maxLength={5000} className="input" disabled={!can} value={notes[cat.key] || ''} onChange={(e) => setNotes((n) => ({ ...n, [cat.key]: e.target.value }))} />
            </F>
          </fieldset>
        );
      })}
      <F name="overall_readiness" label="Overall readiness" required errors={errors} hint="The social worker's judgement. The readiness guide above never decides this.">
        <Select value={overall} disabled={!can} options={c.overall} onChange={setOverall} />
      </F>
      <fieldset className="rounded-lg border border-brand-200 bg-brand-50/40 p-3" data-field="voice">
        <legend className="px-1 text-sm font-semibold text-navy-900">Child's Voice</legend>
        <p className="mb-2 text-xs text-slate-600">In the young person's own words. Record their answers, or that they chose not to answer and why.</p>
        {errors.voice && <p className="mb-2 text-sm text-red-700" role="alert">{errors.voice}</p>}
        <div className="grid gap-2">
          {c.child_voice.map(([k, q]) => (
            <F key={k} name={`voice_${k}`} label={q} errors={errors}>
              <textarea rows={2} maxLength={3000} className="input" disabled={!can || vc.declined} value={vc[k] || ''} onChange={(e) => setVc((o) => ({ ...o, [k]: e.target.value }))} />
            </F>
          ))}
          <label className="flex items-center gap-2 text-sm text-navy-900"><input type="checkbox" disabled={!can} checked={vc.declined} onChange={(e) => setVc((o) => ({ ...o, declined: e.target.checked }))} /> The young person chose not to answer</label>
          {vc.declined && <F name="declined_reason" label="Reason" errors={errors}><input className="input" maxLength={1000} disabled={!can} value={vc.declined_reason || ''} onChange={(e) => setVc((o) => ({ ...o, declined_reason: e.target.value }))} /></F>}
        </div>
        {voice && <SavedBy name={voice.recorded_by_name} at={voice.recorded_at} prefix="Recorded" />}
      </fieldset>
      <SavedBy name={a?.updated_by_name} at={a?.updated_at} />
      {can && (
        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
          <Button variant="secondary" loading={busy === 'draft'} onClick={() => run('draft', '/assessment', 'PUT', body(false), 'Draft saved.')}><Save className="h-4 w-4" aria-hidden /> Save draft</Button>
          <Button loading={busy === 'complete'} onClick={saveContinue}>Save Assessment &amp; Continue <ArrowRight className="h-4 w-4" aria-hidden /></Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 3. Case conference

const blankConf = (review) => ({
  conference_date: today(), location: '', meeting_type: 'In person', facilitator: review.assigned_staff?.name || '', assessment_summary: '', strengths: '', concerns: '', recommendation: '', notes: '',
  participants: [{ role: 'Social Worker', name: review.assigned_staff?.name || '' }, { role: 'Young Person', name: review.full_name || '' }],
});

function Participants({ list, onChange, roles, disabled, errors }) {
  const set = (i, k, val) => onChange(list.map((p, j) => (j === i ? { ...p, [k]: val } : p)));
  return (
    <div data-field="participants" className="space-y-2">
      <p className="text-sm font-medium text-navy-800">Participants</p>
      {errors.participants && <p className="text-sm text-red-700" role="alert">{errors.participants}</p>}
      {list.map((p, i) => (
        <div key={i} className="flex flex-wrap items-start gap-2" data-field={`participant_${i}`}>
          <select aria-label={`Participant ${i + 1} role`} className="input w-56" disabled={disabled} value={p.role} onChange={(e) => set(i, 'role', e.target.value)}>
            <option value="">Role...</option>{roles.map((r) => <option key={r}>{r}</option>)}
          </select>
          <input aria-label={`Participant ${i + 1} name`} className="input min-w-[10rem] flex-1" maxLength={150} disabled={disabled} placeholder="Name" value={p.name} onChange={(e) => set(i, 'name', e.target.value)} />
          {!disabled && <Button size="sm" variant="ghost" onClick={() => onChange(list.filter((_, j) => j !== i))} aria-label={`Remove participant ${i + 1}`}><X className="h-4 w-4" aria-hidden /></Button>}
          {errors[`participant_${i}`] && <p className="w-full text-xs text-red-700">{errors[`participant_${i}`]}</p>}
        </div>
      ))}
      {!disabled && <Button size="sm" variant="secondary" onClick={() => onChange([...list, { role: '', name: '' }])}><Plus className="h-4 w-4" aria-hidden /> Add participant</Button>}
    </div>
  );
}

export function ConferenceStage({ review, onSaved, onView }) {
  const c = review.config;
  const confs = review.workflow.conferences;
  const can = writable(review) && Boolean(review.workflow.assessment?.completed_at);
  const scheduled = confs.find((x) => x.status === 'Scheduled');
  const [form, setForm] = useState(() => (confs.length && !scheduled ? null : scheduled ? { ...blankConf(review), ...scheduled, conference_date: scheduled.conference_date, participants: scheduled.participants.length ? scheduled.participants : blankConf(review).participants } : blankConf(review)));
  const [follow, setFollow] = useState(null);
  const { busy, errors, error, run } = useStageSave(review, onSaved);
  const set = (k) => (e) => setForm((o) => ({ ...o, [k]: e?.target ? e.target.value : e }));
  const save = async () => {
    const path = form.conference_id ? `/conferences/${form.conference_id}` : '/conferences';
    if (await run('save', path, form.conference_id ? 'PUT' : 'POST', { ...form, status: 'Held' }, 'Case conference saved.')) setForm(null);
  };
  const schedule = async () => {
    if (await run('follow', '/conferences', 'POST', { status: 'Scheduled', conference_date: follow.date, location: follow.location, meeting_type: follow.meeting_type, facilitator: follow.facilitator, follow_up_of: confs.find((x) => x.status === 'Held')?.conference_id || null }, 'Follow-up conference scheduled.')) setFollow(null);
  };
  if (!review.workflow.assessment?.completed_at) return <p className="text-sm text-slate-600">Complete the transition assessment first.</p>;
  return (
    <div className="space-y-5">
      {confs.length > 0 && (
        <ul className="space-y-3">
          {confs.map((x) => (
            <li key={x.conference_id} className="rounded-lg border border-slate-200 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-navy-900">{x.status === 'Held' ? 'Case conference' : 'Follow-up conference'} · {formatDate(x.conference_date)}</p>
                <Badge tone={x.status === 'Held' ? 'green' : 'blue'}>{x.status}</Badge>
              </div>
              <p className="text-xs text-slate-500">{[x.meeting_type, x.location, x.facilitator && `facilitator ${x.facilitator}`].filter(Boolean).join(' · ')}</p>
              {x.status === 'Held' && (
                <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                  <Row label="Participants">{x.participants.map((p) => `${p.name} (${p.role})`).join(', ')}</Row>
                  <Row label="Recommendation">{x.recommendation}</Row>
                  <Row label="Assessment summary">{x.assessment_summary}</Row>
                  <Row label="Strengths">{x.strengths}</Row>
                  <Row label="Concerns">{x.concerns}</Row>
                  <Row label="Notes">{x.notes}</Row>
                </dl>
              )}
              <div className="mt-2 border-t border-slate-100 pt-2"><StageDocuments review={review} stage="conference" conferenceId={x.conference_id} canUpload={writable(review)} onSaved={onSaved} onView={onView} title="Conference documents" /></div>
              {x.status === 'Scheduled' && can && !form && <Button size="sm" className="mt-2" onClick={() => setForm({ ...blankConf(review), ...x, participants: x.participants.length ? x.participants : blankConf(review).participants })}>Record this conference</Button>}
              {x.status === 'Held' && review.permissions.admin && !form && <Button size="sm" variant="ghost" className="mt-2" onClick={() => setForm({ ...blankConf(review), ...x })}><Pencil className="h-3.5 w-3.5" aria-hidden /> Correct (Admin)</Button>}
            </li>
          ))}
        </ul>
      )}
      {form && can && (
        <Card className="space-y-3 p-4 shadow-none">
          <h4 className="font-semibold text-navy-900">{form.conference_id ? 'Record the conference' : 'New case conference'}</h4>
          <ErrorNote error={error && !Object.keys(errors).length ? error : null} />
          <div className="grid gap-3 sm:grid-cols-3">
            <F name="conference_date" label="Conference date" required errors={errors}><input type="date" className="input" max={today()} value={form.conference_date} onChange={set('conference_date')} /></F>
            <F name="meeting_type" label="Meeting type" errors={errors}><Select value={form.meeting_type} options={c.meeting_types} onChange={set('meeting_type')} /></F>
            <F name="location" label="Location" errors={errors}><input className="input" maxLength={150} value={form.location || ''} onChange={set('location')} /></F>
            <F name="facilitator" label="Facilitator" required errors={errors}><input className="input" maxLength={150} value={form.facilitator || ''} onChange={set('facilitator')} /></F>
          </div>
          <Participants list={form.participants} onChange={(p) => setForm((o) => ({ ...o, participants: p }))} roles={c.participant_roles} errors={errors} />
          <F name="assessment_summary" label="Assessment summary" required errors={errors}><textarea rows={2} maxLength={5000} className="input" value={form.assessment_summary || ''} onChange={set('assessment_summary')} /></F>
          <div className="grid gap-3 sm:grid-cols-2">
            <F name="strengths" label="Strengths" errors={errors}><textarea rows={2} maxLength={5000} className="input" value={form.strengths || ''} onChange={set('strengths')} /></F>
            <F name="concerns" label="Concerns" errors={errors}><textarea rows={2} maxLength={5000} className="input" value={form.concerns || ''} onChange={set('concerns')} /></F>
          </div>
          <F name="recommendation" label="Recommendation" required errors={errors}><Select value={form.recommendation} options={c.recommendations} onChange={set('recommendation')} /></F>
          <F name="notes" label="Conference notes" errors={errors}><textarea rows={3} maxLength={10000} className="input" value={form.notes || ''} onChange={set('notes')} /></F>
          <div className="flex flex-wrap gap-2">
            <Button loading={busy === 'save'} onClick={save}><Save className="h-4 w-4" aria-hidden /> Save Conference</Button>
            {confs.length > 0 && <Button variant="ghost" onClick={() => setForm(null)}>Cancel</Button>}
          </div>
        </Card>
      )}
      {can && (
        <div className="flex flex-wrap gap-2">
          {!form && <Button variant="secondary" onClick={() => setForm(blankConf(review))}><Plus className="h-4 w-4" aria-hidden /> Record another conference</Button>}
          <Button variant="secondary" onClick={() => setFollow({ date: '', location: '', meeting_type: 'In person', facilitator: review.assigned_staff?.name || '' })}><CalendarPlus className="h-4 w-4" aria-hidden /> Schedule Follow-up</Button>
        </div>
      )}
      <Modal open={Boolean(follow)} onClose={() => setFollow(null)} title="Schedule a follow-up conference" size="sm"
        footer={<><Button variant="secondary" onClick={() => setFollow(null)}>Cancel</Button><Button loading={busy === 'follow'} onClick={schedule}>Schedule</Button></>}>
        {follow && (
          <div className="space-y-3">
            <ErrorNote error={error && !Object.keys(errors).length ? error : null} />
            <F name="conference_date" label="Date" required errors={errors}><input type="date" className="input" min={today()} value={follow.date} onChange={(e) => setFollow((f) => ({ ...f, date: e.target.value }))} /></F>
            <F name="meeting_type" label="Meeting type" errors={errors}><Select value={follow.meeting_type} options={c.meeting_types} onChange={(x) => setFollow((f) => ({ ...f, meeting_type: x }))} /></F>
            <F name="location" label="Location" errors={errors}><input className="input" maxLength={150} value={follow.location} onChange={(e) => setFollow((f) => ({ ...f, location: e.target.value }))} /></F>
            <p className="text-xs text-slate-500">The assigned staff and administrators are notified.</p>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------- 4. Decision (Admin)

export function DecisionStage({ review, onSaved }) {
  const c = review.config;
  const decisions = review.workflow.decisions;
  const ready = review.workflow.assessment?.completed_at && review.workflow.conferences.some((x) => x.status === 'Held');
  const can = writable(review, true) && ready && !review.workflow.discharge;
  const [v, setV] = useState({ pathway: review.proposed_pathway || '', decision: '', decision_date: today(), conditions: '', justification: '', next_review_date: '' });
  const [confirm, setConfirm] = useState(false);
  const { busy, errors, error, run } = useStageSave(review, onSaved);
  const set = (k) => (e) => setV((o) => ({ ...o, [k]: e?.target ? e.target.value : e }));
  const later = ['Deferred', 'Continue Residential Care'].includes(v.decision);
  const record = async () => { setConfirm(false); await run('save', '/decision', 'POST', v, 'Transition decision recorded.'); };
  return (
    <div className="space-y-5">
      {decisions.length > 0 && (
        <ul className="space-y-2">
          {decisions.map((d, i) => (
            <li key={d.decision_id} className={`rounded-lg border p-3 text-sm ${i === 0 ? 'border-brand-200' : 'border-slate-200 opacity-80'}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-navy-900">{d.decision} · {d.pathway}</p>
                <Badge tone={['Approved', 'Approved with Conditions'].includes(d.decision) ? 'green' : 'amber'}>{i === 0 ? 'Current decision' : 'Earlier decision'}</Badge>
              </div>
              <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                <Row label="Decision date">{formatDate(d.decision_date)}</Row>
                <Row label="Decision maker">{d.decision_maker_name}</Row>
                {d.conditions && <Row label="Conditions">{d.conditions}</Row>}
                <Row label="Reason / justification">{d.justification}</Row>
                {d.next_review_date && <Row label="Next review">{formatDate(d.next_review_date)}</Row>}
              </dl>
            </li>
          ))}
        </ul>
      )}
      {!ready && <p className="text-sm text-slate-600">A completed assessment and a case conference are needed before the decision.</p>}
      {ready && !review.permissions.admin && decisions.length === 0 && <AdminOnly what="the transition decision" />}
      {review.workflow.discharge && <p className="text-xs text-slate-500">The transition has been recorded; the decision can no longer change.</p>}
      {can && (
        <Card className="space-y-3 p-4 shadow-none">
          <h4 className="font-semibold text-navy-900">{decisions.length ? 'Record a new decision' : 'Record the transition decision'}</h4>
          <ErrorNote error={error && !Object.keys(errors).length ? error : null} />
          <div className="grid gap-3 sm:grid-cols-3">
            <F name="pathway" label="Recommended pathway" required errors={errors}><Select value={v.pathway} options={c.pathways} onChange={set('pathway')} /></F>
            <F name="decision" label="Decision" required errors={errors}><Select value={v.decision} options={c.decisions} onChange={set('decision')} /></F>
            <F name="decision_date" label="Decision date" required errors={errors}><input type="date" className="input" max={today()} value={v.decision_date} onChange={set('decision_date')} /></F>
          </div>
          {v.decision === 'Approved with Conditions' && <F name="conditions" label="Conditions" required errors={errors}><textarea rows={2} maxLength={5000} className="input" value={v.conditions} onChange={set('conditions')} /></F>}
          <F name="justification" label="Reason / justification" required errors={errors}><textarea rows={3} maxLength={5000} className="input" value={v.justification} onChange={set('justification')} /></F>
          {later && <F name="next_review_date" label="New review date" required errors={errors} hint="The review stays active (In Progress) until then."><input type="date" className="input" min={today()} value={v.next_review_date} onChange={set('next_review_date')} /></F>}
          <p className="text-xs text-slate-500">Decision maker: you. Approval creates the transition plan automatically.</p>
          <Button loading={busy === 'save'} onClick={() => setConfirm(true)}>Record decision</Button>
        </Card>
      )}
      <ConfirmModal open={confirm} title="Record this decision?" confirmLabel="Record decision" onClose={() => setConfirm(false)} onConfirm={record} loading={busy === 'save'}
        message={`${v.decision || 'Decision'} · ${v.pathway || 'pathway'}. Decisions are kept as recorded; a later decision is added, not overwritten.`} />
    </div>
  );
}

// ---------------------------------------------------------------- 5. Plan

function TaskModal({ review, task, onClose, onSaved }) {
  const c = review.config;
  const [v, setV] = useState(() => ({ name: '', description: '', status: 'Pending', priority: 'Medium', due_date: '', assigned_to: '', assigned_name: '', notes: '', ...(task || {}), assigned_to: task?.assigned_to || '' }));
  const { busy, errors, error, run } = useStageSave(review, onSaved);
  const set = (k) => (e) => setV((o) => ({ ...o, [k]: e?.target ? e.target.value : e }));
  const save = async () => { if (await run('save', task ? `/tasks/${task.task_id}` : '/tasks', task ? 'PUT' : 'POST', v, task ? 'Task updated.' : 'Task added.')) onClose(); };
  return (
    <Modal open onClose={onClose} title={task ? task.name : 'Add a custom task'} size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy === 'save'} onClick={save}>Save task</Button></>}>
      <div className="space-y-3">
        <ErrorNote error={error && !Object.keys(errors).length ? error : null} />
        {!task && <F name="name" label="Task name" required errors={errors}><input className="input" maxLength={150} value={v.name} onChange={set('name')} /></F>}
        {!task && <F name="description" label="Description" errors={errors}><input className="input" maxLength={500} value={v.description} onChange={set('description')} /></F>}
        {task?.description && <p className="text-sm text-slate-600">{task.description}</p>}
        <div className="grid gap-3 sm:grid-cols-3">
          <F name="status" label="Status" errors={errors}><select className="input" value={v.status} onChange={set('status')}>{c.task_statuses.map((s) => <option key={s}>{s}</option>)}</select></F>
          <F name="priority" label="Priority" errors={errors}><select className="input" value={v.priority} onChange={set('priority')}>{c.priorities.map((s) => <option key={s}>{s}</option>)}</select></F>
          <F name="due_date" label="Due date" errors={errors}><input type="date" className="input" value={v.due_date || ''} onChange={set('due_date')} /></F>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <F name="assigned_to" label="Assigned staff" errors={errors}>
            <select className="input" value={v.assigned_to || ''} onChange={set('assigned_to')}>
              <option value="">Someone else (type the name)</option>{review.staff.map((s) => <option key={s.user_id} value={s.user_id}>{s.full_name} ({s.role})</option>)}
            </select>
          </F>
          {!v.assigned_to && <F name="assigned_name" label="Assigned person" errors={errors}><input className="input" maxLength={150} placeholder="e.g. House parent" value={v.assigned_name || ''} onChange={set('assigned_name')} /></F>}
        </div>
        <F name="notes" label="Notes" errors={errors} hint={v.status === 'Not Applicable' ? 'Required: why this task does not apply.' : undefined}><textarea rows={3} maxLength={3000} className="input" value={v.notes || ''} onChange={set('notes')} /></F>
      </div>
    </Modal>
  );
}

export function PlanStage({ review, onSaved }) {
  const tasks = review.workflow.tasks;
  const [editing, setEditing] = useState(null);
  const can = writable(review);
  if (!review.workflow.plan) return <p className="text-sm text-slate-600">The transition plan is created automatically when the transition is approved (Transition decision).</p>;
  const counted = tasks.filter((t) => t.status !== 'Not Applicable');
  const done = counted.filter((t) => t.status === 'Completed').length;
  const pct = counted.length ? (done / counted.length) * 100 : 100;
  return (
    <div className="space-y-4">
      <Progress value={pct} label={`${done} of ${counted.length} tasks completed${tasks.length !== counted.length ? ` (${tasks.length - counted.length} not applicable)` : ''}`} />
      {review.target_transition_date && <p className="text-sm text-slate-600">Target transition date: <strong className="text-navy-900">{formatDate(review.target_transition_date)}</strong></p>}
      <div className="relative overflow-x-auto rounded-lg border border-slate-200">
        <table className="cs-table min-w-full divide-y divide-slate-100 text-sm">
          <thead className="bg-slate-50"><tr><th className="th">Task</th><th className="th">Assigned</th><th className="th">Due</th><th className="th">Priority</th><th className="th">Status</th><th className="th"><span className="sr-only">Action</span></th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {tasks.map((t) => {
              const overdue = t.due_date && t.due_date < today() && !['Completed', 'Not Applicable'].includes(t.status);
              return (
                <tr key={t.task_id}>
                  <td className="td"><p className="font-medium text-navy-900">{t.name}</p>{t.description && <p className="text-xs text-slate-500">{t.description}</p>}{t.notes && <p className="mt-1 text-xs text-slate-600">Note: {t.notes}</p>}</td>
                  <td className="td whitespace-nowrap">{t.assigned_to_name || t.assigned_name || <span className="text-slate-400">-</span>}</td>
                  <td className={`td whitespace-nowrap ${overdue ? 'font-medium text-red-700' : ''}`}>{t.due_date ? formatDate(t.due_date) : '-'}{overdue && <span className="block text-xs">Overdue</span>}</td>
                  <td className="td"><Badge tone={PRIORITY_TONE[t.priority]}>{t.priority}</Badge></td>
                  <td className="td"><Badge tone={TASK_TONE[t.status]}>{t.status}</Badge></td>
                  <td className="td text-right">{can && <Button size="sm" variant="secondary" onClick={() => setEditing(t)}>Update<span className="sr-only"> {t.name}</span></Button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {can && <Button variant="secondary" onClick={() => setEditing('new')}><Plus className="h-4 w-4" aria-hidden /> Add custom task</Button>}
      {editing && <TaskModal review={review} task={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={onSaved} />}
    </div>
  );
}

// ---------------------------------------------------------------- 6. Preparation

export function PreparationStage({ review, onSaved }) {
  const prep = review.workflow.preparation;
  const items = review.config.preparation;
  const approved = ['Approved', 'Approved with Conditions'].includes(review.workflow.decisions[0]?.decision);
  const can = writable(review) && approved && (!review.workflow.discharge || review.permissions.admin);
  const [na, setNa] = useState(null);
  const { busy, errors, error, run } = useStageSave(review, onSaved);
  const done = items.filter(([k]) => prep[k]).length;
  if (!approved) return <p className="text-sm text-slate-600">Preparation starts after the transition is approved.</p>;
  return (
    <div className="space-y-4">
      <Progress value={(done / items.length) * 100} label={`${done} of ${items.length} tasks completed`} />
      <ErrorNote error={error && !na ? error : null} />
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {items.map(([k, label]) => {
          const p = prep[k];
          return (
            <li key={k} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                <input type="checkbox" disabled={!can || busy === k || p?.status === 'Not Applicable'} checked={p?.status === 'Done'}
                  onChange={(e) => run(k, '/preparation', 'PUT', { item_key: k, status: e.target.checked ? 'Done' : '' }, e.target.checked ? 'Marked done.' : 'Marked not done.')} />
                <span className={p ? 'text-navy-900' : 'text-slate-700'}>{label}</span>
              </label>
              {p && <span className="text-xs text-slate-500">{p.status === 'Not Applicable' ? `Not applicable: ${p.note}` : 'Done'} · {p.done_by_name}, {formatDate(p.done_at)}</span>}
              {can && !p && <Button size="sm" variant="ghost" onClick={() => setNa({ k, label, note: '' })}>Not applicable</Button>}
              {can && p?.status === 'Not Applicable' && <Button size="sm" variant="ghost" loading={busy === k} onClick={() => run(k, '/preparation', 'PUT', { item_key: k, status: '' }, 'Reopened.')}>Undo</Button>}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-slate-500">Every item must be done or not applicable before the transition is recorded.</p>
      <Modal open={Boolean(na)} onClose={() => setNa(null)} title="Not applicable" size="sm"
        footer={<><Button variant="secondary" onClick={() => setNa(null)}>Cancel</Button><Button loading={busy === na?.k} onClick={async () => { if (await run(na.k, '/preparation', 'PUT', { item_key: na.k, status: 'Not Applicable', note: na.note }, 'Marked not applicable.')) setNa(null); }}>Save</Button></>}>
        {na && <div className="space-y-2"><p className="text-sm text-navy-900">{na.label}</p>
          <F name="note" label="Why it does not apply" required errors={errors}><textarea rows={2} maxLength={1000} className="input" value={na.note} onChange={(e) => setNa((o) => ({ ...o, note: e.target.value }))} /></F></div>}
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------- 7. Discharge / placement (Admin)

export function DischargeStage({ review, onSaved }) {
  const c = review.config;
  const w = review.workflow;
  const dis = w.discharge;
  const tasksOk = w.tasks.length > 0 && w.tasks.every((t) => ['Completed', 'Not Applicable'].includes(t.status));
  const prepOk = c.preparation.every(([k]) => w.preparation[k]);
  const approved = ['Approved', 'Approved with Conditions'].includes(w.decisions[0]?.decision);
  const [v, setV] = useState({ transition_date: today(), destination_type: '', destination_name: '', destination_address: '', receiving: '', contact: '', reason: '', notes: '', confirm: false });
  const [ask, setAsk] = useState(false);
  const { busy, errors, error, run } = useStageSave(review, onSaved);
  const set = (k) => (e) => setV((o) => ({ ...o, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }));
  if (dis) {
    return (
      <div className="space-y-3">
        <dl className="grid gap-3 rounded-lg border border-slate-200 p-4 sm:grid-cols-2">
          <Row label="Transition date">{formatDate(dis.transition_date)}</Row>
          <Row label="Destination type">{dis.destination_type}</Row>
          <Row label="Destination name">{dis.destination_name}</Row>
          <Row label="Destination address">{dis.destination_address}</Row>
          <Row label="Receiving person / organization">{dis.receiving}</Row>
          <Row label="Contact information">{dis.contact}</Row>
          <Row label="Reason for transition">{dis.reason}</Row>
          <Row label="Discharge notes">{dis.notes}</Row>
        </dl>
        <SavedBy name={dis.recorded_by_name} at={dis.recorded_at} prefix="Recorded" />
        <p className="text-xs text-slate-500">The child's record is kept: status Discharged, with this transition in the discharge history.</p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <ul className="space-y-1">
        <Check done={approved} label="Transition approved" />
        <Check done={tasksOk} label="Transition plan tasks complete" />
        <Check done={prepOk} label="Pre-transition checklist complete" />
      </ul>
      {!review.permissions.admin && <AdminOnly what="the discharge / placement" />}
      {review.permissions.admin && approved && tasksOk && prepOk && writable(review, true) && (
        <Card className="space-y-3 p-4 shadow-none">
          <ErrorNote error={error && !Object.keys(errors).length ? error : null} />
          <div className="grid gap-3 sm:grid-cols-2">
            <F name="transition_date" label="Transition date" required errors={errors}><input type="date" className="input" max={today()} value={v.transition_date} onChange={set('transition_date')} /></F>
            <F name="destination_type" label="Destination type" required errors={errors}><Select value={v.destination_type} options={c.destinations} onChange={set('destination_type')} /></F>
            <F name="destination_name" label="Destination name" required errors={errors}><input className="input" maxLength={200} value={v.destination_name} onChange={set('destination_name')} /></F>
            <F name="receiving" label="Receiving person / organization" required errors={errors}><input className="input" maxLength={200} value={v.receiving} onChange={set('receiving')} /></F>
            <F name="destination_address" label="Destination address" required errors={errors} className="sm:col-span-2"><input className="input" maxLength={500} value={v.destination_address} onChange={set('destination_address')} /></F>
            <F name="contact" label="Contact information" required errors={errors}><input className="input" maxLength={200} value={v.contact} onChange={set('contact')} /></F>
          </div>
          <F name="reason" label="Reason for transition" required errors={errors}><textarea rows={2} maxLength={3000} className="input" value={v.reason} onChange={set('reason')} /></F>
          <F name="notes" label="Discharge notes" errors={errors}><textarea rows={3} maxLength={10000} className="input" value={v.notes} onChange={set('notes')} /></F>
          <div data-field="confirm">
            <label className="flex items-start gap-2 text-sm text-navy-900"><input type="checkbox" className="mt-0.5" checked={v.confirm} onChange={set('confirm')} /> I confirm that the transition/placement details have been reviewed.</label>
            {errors.confirm && <p className="mt-1 text-xs text-red-700">{errors.confirm}</p>}
          </div>
          <Button loading={busy === 'save'} onClick={() => setAsk(true)}>Record Transition</Button>
        </Card>
      )}
      <ConfirmModal open={ask} title="Record the transition?" confirmLabel="Record Transition" onClose={() => setAsk(false)} loading={busy === 'save'}
        onConfirm={async () => { setAsk(false); await run('save', '/discharge', 'POST', v, 'Transition recorded. Aftercare follow-ups are scheduled.'); }}
        message="The child's record is kept and marked Discharged, with this transition in the discharge history. The aftercare plan (week 1, month 1, month 3, month 6) is created." />
    </div>
  );
}

// ---------------------------------------------------------------- 8. Aftercare

function VisitModal({ review, visit, onClose, onSaved }) {
  const c = review.config;
  const [v, setV] = useState({ visit_date: today(), contact_type: '', ...(visit?.visit_date ? visit : {}) });
  const { busy, errors, error, run } = useStageSave(review, onSaved);
  const set = (k) => (e) => setV((o) => ({ ...o, [k]: e?.target ? e.target.value : e }));
  const save = async () => { if (await run('save', '/aftercare', 'POST', { ...v, visit_id: visit?.visit_id || null }, 'Follow-up recorded.')) onClose(); };
  const req = ['person_contacted', 'progress', 'next_steps'];
  return (
    <Modal open onClose={onClose} title={visit ? `${visit.round} follow-up` : 'Custom follow-up'} size="wide"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy === 'save'} onClick={save}>Save follow-up</Button></>}>
      <div className="space-y-3">
        <ErrorNote error={error && !Object.keys(errors).length ? error : null} />
        <div className="grid gap-3 sm:grid-cols-3">
          <F name="visit_date" label="Date" required errors={errors}><input type="date" className="input" max={today()} value={v.visit_date} onChange={set('visit_date')} /></F>
          <F name="contact_type" label="Contact type" required errors={errors}><Select value={v.contact_type} options={c.contact_types} onChange={set('contact_type')} /></F>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {c.visit_fields.map(([k, label]) => (
            <F key={k} name={k} label={label} required={req.includes(k)} errors={errors}>
              {['location', 'person_contacted'].includes(k) ? <input className="input" maxLength={300} value={v[k] || ''} onChange={set(k)} /> : <textarea rows={2} maxLength={3000} className="input" value={v[k] || ''} onChange={set(k)} />}
            </F>
          ))}
        </div>
      </div>
    </Modal>
  );
}

export function AftercareStage({ review, onSaved, onView }) {
  const w = review.workflow;
  const [open, setOpen] = useState(null);
  const [shown, setShown] = useState(null);
  const can = writable(review) && Boolean(w.aftercare);
  if (!w.aftercare) return <p className="text-sm text-slate-600">The aftercare plan is created automatically when the transition is recorded.</p>;
  const recorded = w.visits.filter((x) => x.visit_date).length;
  return (
    <div className="space-y-4">
      <Progress value={(w.visits.filter((x) => x.round !== 'Custom' && x.visit_date).length / 4) * 100} label={`Aftercare plan ${w.aftercare.status.toLowerCase()} · ${recorded} follow-up${recorded === 1 ? '' : 's'} recorded`} />
      <ul className="space-y-2">
        {w.visits.map((x) => {
          const overdue = !x.visit_date && x.scheduled_date && x.scheduled_date < today();
          return (
            <li key={x.visit_id} className="rounded-lg border border-slate-200 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-navy-900">{x.round}{x.scheduled_date && <span className="font-normal text-slate-500"> · due {formatDate(x.scheduled_date)}</span>}</p>
                <span className="flex items-center gap-2">
                  {x.visit_date ? <Badge tone="green">Recorded {formatDate(x.visit_date)}</Badge> : <Badge tone={overdue ? 'red' : 'slate'}>{overdue ? 'Overdue' : 'Scheduled'}</Badge>}
                  {x.visit_date ? <Button size="sm" variant="ghost" onClick={() => setShown(shown === x.visit_id ? null : x.visit_id)}>{shown === x.visit_id ? 'Hide' : 'Details'}</Button>
                    : can && <Button size="sm" onClick={() => setOpen(x)}>Record</Button>}
                </span>
              </div>
              {shown === x.visit_id && (
                <div className="mt-2 space-y-2 border-t border-slate-100 pt-2">
                  <dl className="grid gap-2 sm:grid-cols-2">
                    <Row label="Contact type">{x.contact_type}</Row>
                    {review.config.visit_fields.filter(([k]) => x[k]).map(([k, l]) => <Row key={k} label={l}>{x[k]}</Row>)}
                  </dl>
                  <SavedBy name={x.recorded_by_name} at={x.recorded_at} prefix="Recorded" />
                  <StageDocuments review={review} stage="aftercare" visitId={x.visit_id} canUpload={writable(review)} onSaved={onSaved} onView={onView} title="Supporting documents" />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {can && <Button variant="secondary" onClick={() => setOpen('custom')}><Plus className="h-4 w-4" aria-hidden /> Add custom follow-up</Button>}
      {open && <VisitModal review={review} visit={open === 'custom' ? null : open} onClose={() => setOpen(null)} onSaved={onSaved} />}
    </div>
  );
}

// ---------------------------------------------------------------- 9. Closure (Admin)

export function ClosureStage({ review, onSaved }) {
  const c = review.config;
  const list = review.closure_checklist;
  const [v, setV] = useState({ final_outcome: '', final_assessment: '', closure_date: today(), closure_notes: '', retained: false, approved: false });
  const [ask, setAsk] = useState(false);
  const { busy, errors, error, run } = useStageSave(review, onSaved);
  const set = (k) => (e) => setV((o) => ({ ...o, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }));
  const prereq = list.filter((x) => ['transition', 'documents', 'aftercare'].includes(x.key)).every((x) => x.done);
  if (review.closed_at) {
    return (
      <div className="space-y-3">
        <dl className="grid gap-3 rounded-lg border border-slate-200 p-4 sm:grid-cols-2">
          <Row label="Final outcome">{review.final_outcome}</Row>
          <Row label="Closure date">{formatDate(review.closure_date)}</Row>
          <Row label="Closing social worker">{review.assigned_staff?.name || review.assigned_staff_name}</Row>
          <Row label="Closed by">{review.closed_by_name} on {formatDateTime(review.closed_at)}</Row>
          <Row label="Final assessment">{review.final_assessment}</Row>
          <Row label="Closure notes">{review.closure_notes}</Row>
        </dl>
        <ul className="space-y-1">{list.map((x) => <Check key={x.key} done={x.done} label={x.label} />)}</ul>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <ul className="space-y-1">{list.map((x) => <Check key={x.key} done={x.done || (x.key === 'outcome' && v.final_outcome) || (x.key === 'final_assessment' && v.final_assessment.length >= 10) || (x.key === 'retained' && v.retained) || (x.key === 'approved' && v.approved)} label={x.label} />)}</ul>
      {!review.permissions.admin && <AdminOnly what="the case closure" />}
      {review.permissions.admin && !prereq && <p className="text-sm text-slate-600">Closing needs the transition, the required documents and the aftercare follow-ups first.</p>}
      {review.permissions.admin && prereq && (
        <Card className="space-y-3 p-4 shadow-none">
          <ErrorNote error={error && !Object.keys(errors).length ? error : null} />
          <div className="grid gap-3 sm:grid-cols-3">
            <F name="final_outcome" label="Final outcome" required errors={errors}><Select value={v.final_outcome} options={c.outcomes} onChange={set('final_outcome')} /></F>
            <F name="closure_date" label="Closure date" required errors={errors}><input type="date" className="input" max={today()} value={v.closure_date} onChange={set('closure_date')} /></F>
            <div><p className="text-sm font-medium text-navy-800">Closing social worker</p><p className="mt-2 text-sm text-navy-900">{review.assigned_staff?.name || 'Not assigned'}</p></div>
          </div>
          <F name="final_assessment" label="Final assessment" required errors={errors}><textarea rows={3} maxLength={5000} className="input" value={v.final_assessment} onChange={set('final_assessment')} /></F>
          <F name="closure_notes" label="Closure notes" errors={errors}><textarea rows={2} maxLength={5000} className="input" value={v.closure_notes} onChange={set('closure_notes')} /></F>
          {[['retained', 'Records are retained (nothing is deleted when the case closes).'], ['approved', 'I approve the closure of this transition case.']].map(([k, l]) => (
            <div key={k} data-field={k}>
              <label className="flex items-start gap-2 text-sm text-navy-900"><input type="checkbox" className="mt-0.5" checked={v[k]} onChange={set(k)} /> {l}</label>
              {errors[k] && <p className="mt-1 text-xs text-red-700">{errors[k]}</p>}
            </div>
          ))}
          <Button loading={busy === 'save'} onClick={() => setAsk(true)}>Close Transition Case</Button>
        </Card>
      )}
      <ConfirmModal open={ask} title="Close this transition case?" confirmLabel="Close Transition Case" onClose={() => setAsk(false)} loading={busy === 'save'}
        onConfirm={async () => { setAsk(false); await run('save', '/close', 'POST', v, 'Transition case closed.'); }}
        message="The review becomes read-only (administrators can still correct it). The child's record and every record of this review are kept." />
    </div>
  );
}

export const STAGE_PANELS = {
  identify: IdentifyStage, assessment: AssessmentStage, conference: ConferenceStage, decision: DecisionStage, plan: PlanStage,
  preparation: PreparationStage, discharge: DischargeStage, aftercare: AftercareStage, closure: ClosureStage,
};
export { ClosedNote };
