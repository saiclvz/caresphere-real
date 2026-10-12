import { useState } from 'react';
import { Link } from 'react-router-dom';
import useApi from '../../../hooks/useApi';
import { api } from '../../../api/client';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import QrCode from '../../../components/QrCode';
import { publicBaseUrl } from '../../../lib/publicUrl';
import { formatDate } from '../../../lib/format';
import { Button, Card, ErrorNote, Field, Modal } from '../../../components/ui';
import { iso, TabState, useTab } from './common';
import { LinkSection, MatchingSection } from './MatchingPanel';

const MILESTONES = [
  ['forum_verified_at', 'Forum certificate verified'], ['case_study_completed_at', 'Case study completed'], ['cleared_at', 'Cleared for matching'],
  ['matched_at', 'Child matched'], ['trial_start', 'Trial custody started'], ['trial_end', 'Trial custody ends'], ['trial_completed_at', 'Trial custody completed'],
  ['placement_ended_at', 'Placement ended'], ['petition_date', 'Petition filed'], ['racco_office', 'RACCO office'], ['published_at', 'Published'],
  ['appearance_date', 'Mandatory appearance'], ['endorsed_date', 'Endorsed to NACC'], ['nacc_deadline', 'NACC 60-day deadline'],
  ['order_number', 'Order of Adoption number'], ['order_date', 'Order date'], ['civil_registry_ref', 'LCR / PSA reference'], ['closed_at', 'Closed'],
];

/** Admin: release of information to a third party (NACC authorization required). */
export function ReleaseOfInformation({ app }) {
  const { toast } = useApp();
  const list = useApi(`/releases?application_id=${app.application_id}`);
  const [open, setOpen] = useState(false);
  const blank = { requester_name: '', requester_org: '', purpose: '', nacc_authorization: '', released_items: '' };
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async () => {
    const e = {};
    if (!form.requester_name.trim()) e.requester_name = 'Requester is required.';
    if (form.purpose.trim().length < 5) e.purpose = 'State the purpose.';
    if (!form.nacc_authorization.trim()) e.nacc_authorization = 'The NACC authorization reference is required.';
    if (form.released_items.trim().length < 3) e.released_items = 'List what was released.';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true); setError(null);
    try { await api(`/adoptions/${app.application_id}/releases`, { method: 'POST', body: form }); toast('Release recorded.'); setOpen(false); setForm(blank); list.reload(); }
    catch (err) { setError(err); } finally { setBusy(false); }
  };
  const rows = list.data?.data || [];
  return (
    <Card className="space-y-2 p-4">
      <div className="flex items-center justify-between"><h3 className="font-semibold text-navy-900">Release of information</h3><Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Record release</Button></div>
      {rows.length === 0 ? <p className="text-xs text-slate-500">Nothing released.</p> : (
        <ul className="space-y-1 text-xs text-slate-600">{rows.map((r) => <li key={r.release_id}>{formatDate(r.released_at)}: {r.released_items} to {r.requester_name} (NACC ref {r.nacc_authorization})</li>)}</ul>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Record a release of information"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} onClick={save}>Record release</Button></>}>
        <div className="space-y-3">
          <ErrorNote error={error} />
          <p className="text-sm text-slate-600">Adoption information may be released only with NACC authorization, and only for the stated purpose. This is recorded in the audit log.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Requester" required error={errors.requester_name}><input className="input" maxLength={150} value={form.requester_name} onChange={set('requester_name')} /></Field>
            <Field label="Organization"><input className="input" maxLength={150} value={form.requester_org} onChange={set('requester_org')} /></Field>
          </div>
          <Field label="Purpose" required error={errors.purpose}><textarea className="input" rows={2} maxLength={1000} value={form.purpose} onChange={set('purpose')} /></Field>
          <Field label="NACC authorization reference" required error={errors.nacc_authorization}><input className="input font-mono" maxLength={120} value={form.nacc_authorization} onChange={set('nacc_authorization')} /></Field>
          <Field label="What was released" required error={errors.released_items}><textarea className="input" rows={2} maxLength={2000} value={form.released_items} onChange={set('released_items')} /></Field>
        </div>
      </Modal>
    </Card>
  );
}

const show = (k, v) => (/_at$/.test(k) ? formatDate(v) : /date|trial_|deadline/.test(k) ? iso(v) : v);

/** Matching and placement: milestones, the matched child, trial custody, petition, order and finality, releases (Admin). */
export default function MatchingTab({ app, version, onChanged }) {
  const { user } = useAuth();
  const state = useTab(app.application_id, 'matching', version);
  return (
    <TabState state={state} rows={6}>
      {(d) => {
        const m = d.milestones;
        const group = (keys) => MILESTONES.filter(([k]) => keys.includes(k) && m[k]);
        const sections = [
          ['Trial custody', group(['matched_at', 'trial_start', 'trial_end', 'trial_completed_at', 'placement_ended_at'])],
          ['Petition', group(['petition_date', 'racco_office', 'published_at', 'appearance_date', 'endorsed_date', 'nacc_deadline'])],
          ['Order of Adoption and finality', group(['order_number', 'order_date', 'civil_registry_ref', 'closed_at'])],
          ['Earlier steps', group(['forum_verified_at', 'case_study_completed_at', 'cleared_at'])],
        ];
        return (
          <div className="space-y-4">
            {d.matching && <MatchingSection app={app} data={d} onChanged={onChanged} />}
            {d.link && <LinkSection app={app} data={d} onChanged={onChanged} />}
            <Card className="p-4">
              <h3 className="mb-2 font-semibold text-navy-900">Matched child</h3>
              {d.matched_child ? (
                <div className="flex items-center gap-3">
                  <Link to={`/children/${d.matched_child.child_id}`} aria-label="Open the matched child's profile">
                    <QrCode value={`${publicBaseUrl()}/children/${encodeURIComponent(d.matched_child.child_id)}`} size={56} label={`QR code for child ${d.matched_child.child_id}`} />
                  </Link>
                  <div className="min-w-0 text-sm">
                    <Link to={`/children/${d.matched_child.child_id}`} className="font-medium text-navy-900 hover:text-brand">{d.matched_child.full_name}</Link>
                    <p className="font-mono text-xs text-slate-500">{d.matched_child.child_id}{d.matched_child.age != null && ` · ${d.matched_child.age} yrs`}</p>
                    <p className="text-xs text-slate-500">{d.matched_child.status}{d.matched_child.placement_status !== 'None' && ` · ${d.matched_child.placement_status === 'Trial custody' ? 'Matched / Trial custody' : 'Matched'}`}{d.matched_child.cdclaa_verified ? ' · CDCLAA verified' : ' · CDCLAA not verified'}</p>
                  </div>
                </div>
              ) : <p className="text-sm text-slate-500">{d.track !== 'Regular' ? 'Relative or stepchild adoption: no registry child is needed.' : 'No child matched yet. Propose a match above; an administrator approves it.'}</p>}
            </Card>
            <Card className="p-4">
              <h3 className="mb-2 font-semibold text-navy-900">Milestones</h3>
              {!MILESTONES.some(([k]) => m[k]) ? <p className="text-sm text-slate-500">No milestones recorded yet.</p> : (
                <div className="space-y-3">
                  {sections.filter(([, rows]) => rows.length).map(([title, rows]) => (
                    <div key={title}>
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
                      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                        {rows.map(([k, label]) => <div key={k} className="flex justify-between gap-2 border-b border-slate-50 py-1"><dt className="text-slate-500">{label}</dt><dd className="text-right text-navy-900">{show(k, m[k])}</dd></div>)}
                      </dl>
                    </div>
                  ))}
                  {m.order_number && <p className="text-xs text-slate-500">Certificate of Finality {d.finality_uploaded ? 'uploaded (see Documents)' : 'not uploaded yet'}.</p>}
                </div>
              )}
            </Card>
            {user.role === 'Admin' && <ReleaseOfInformation app={app} />}
          </div>
        );
      }}
    </TabState>
  );
}
