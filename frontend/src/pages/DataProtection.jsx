import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import useApi from '../hooks/useApi';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Modal, PageHeader, Spinner, Table } from '../components/ui';
import { formatDateTime } from '../lib/format';
import { MessageSquareWarning, ShieldCheck } from 'lucide-react';

const DSR_TONE = { Open: 'amber', 'In progress': 'blue', Resolved: 'green', Rejected: 'slate' };
const SEV_TONE = { Low: 'slate', Medium: 'blue', High: 'amber', Serious: 'red' };

/** Data subject request queue (Admin, Staff): requests must be answered. */
function RequestsTab() {
  const { toast } = useApp();
  const [status, setStatus] = useState('');
  const { data, loading, error, reload } = useApi(`/privacy-requests${status ? `?status=${encodeURIComponent(status)}` : ''}`);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ status: 'In progress', response: '' });
  const [fieldError, setFieldError] = useState(null);
  const [busy, setBusy] = useState(false);
  const rows = data?.data || [];
  const save = async () => {
    if (['Resolved', 'Rejected'].includes(form.status) && form.response.trim().length < 5) { setFieldError('Write a response to the requester.'); return; }
    setBusy(true);
    try { await api(`/privacy-requests/${editing.request_id}`, { method: 'PUT', body: form }); toast('Request updated.'); setEditing(null); reload(); }
    catch (err) { setFieldError(err.message); } finally { setBusy(false); }
  };
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2">
        {['', 'Open', 'In progress', 'Resolved', 'Rejected'].map((s) => (
          <button key={s || 'all'} type="button" onClick={() => setStatus(s)} aria-pressed={status === s}
            className={`rounded-full px-3 py-1 text-sm ${status === s ? 'bg-navy-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}>{s || 'All'}</button>
        ))}
      </div>
      <Card>
        {loading && !data ? <Spinner /> : error ? <div className="p-4"><ErrorNote error={error} onRetry={reload} /></div> : rows.length === 0 ? <EmptyState icon={ShieldCheck} title="No requests" /> : (
          <Table>
            <thead className="bg-slate-50"><tr><th className="th">Received</th><th className="th">Requester</th><th className="th">Request</th><th className="th">Status</th><th className="th"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.request_id}>
                  <td className="td whitespace-nowrap">{formatDateTime(r.created_at)}</td>
                  <td className="td">{r.requester_name}<p className="text-xs text-slate-500">{r.requester_email}{r.reference_no && ` · ${r.reference_no}`}</p></td>
                  <td className="td max-w-md"><p className="font-medium">{r.kind}</p><p className="whitespace-pre-line text-sm text-slate-600">{r.details}</p>
                    {r.response && <p className="mt-1 text-xs text-slate-500">Reply: {r.response}</p>}</td>
                  <td className="td"><Badge tone={DSR_TONE[r.status]}>{r.status}</Badge></td>
                  <td className="td text-right"><Button size="sm" variant="secondary" onClick={() => { setEditing(r); setForm({ status: r.status === 'Open' ? 'In progress' : r.status, response: r.response || '' }); setFieldError(null); }}>Respond</Button></td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Respond to request"
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
        {editing && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600"><strong>{editing.kind}</strong> from {editing.requester_name}: {editing.details}</p>
            <Field label="Status" required>
              <select className="input" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                {['Open', 'In progress', 'Resolved', 'Rejected'].map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Response to the requester" required={['Resolved', 'Rejected'].includes(form.status)} error={fieldError} hint="The requester sees this on their application page.">
              <textarea className="input" rows={4} maxLength={3000} value={form.response} onChange={(e) => { setForm((f) => ({ ...f, response: e.target.value })); setFieldError(null); }} />
            </Field>
          </div>
        )}
      </Modal>
    </>
  );
}

const blankIncident = { discovered_at: '', occurred_at: '', severity: 'Low', description: '', affected: '', actions_taken: '', npc_notified_at: '', subjects_notified_at: '' };

/** Security incident log (Admin) with the 72-hour NPC reminder. */
function IncidentsTab() {
  const { toast } = useApp();
  const { data, loading, error, reload } = useApi('/security-incidents');
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [saveError, setSaveError] = useState(null);
  const [busy, setBusy] = useState(false);
  const rows = data?.data || [];
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async () => {
    const found = {};
    if (!form.discovered_at) found.discovered_at = 'Discovery date is required.';
    if (form.description.trim().length < 10) found.description = 'Describe the incident (at least 10 characters).';
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true); setSaveError(null);
    try {
      const body = Object.fromEntries(Object.entries(form).filter(([k]) => k !== 'incident_id').map(([k, v]) => [k, v === '' ? null : v]));
      if (form.incident_id) await api(`/security-incidents/${form.incident_id}`, { method: 'PUT', body });
      else await api('/security-incidents', { method: 'POST', body });
      toast('Incident saved.'); setForm(null); reload();
    } catch (err) { setSaveError(err); } finally { setBusy(false); }
  };
  const toInput = (v) => (v ? String(v).replace(' ', 'T').slice(0, 16) : '');
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">{data?.reminder || 'Serious breaches must be reported to the National Privacy Commission and affected people within 72 hours.'}</p>
        <Button onClick={() => { setForm({ ...blankIncident }); setErrors({}); setSaveError(null); }}>Log incident</Button>
      </div>
      <Card>
        {loading && !data ? <Spinner /> : error ? <div className="p-4"><ErrorNote error={error} onRetry={reload} /></div> : rows.length === 0 ? <EmptyState icon={ShieldCheck} title="No incidents logged" /> : (
          <Table>
            <thead className="bg-slate-50"><tr><th className="th">Discovered</th><th className="th">Severity</th><th className="th">Description</th><th className="th">NPC notified</th><th className="th"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.incident_id}>
                  <td className="td whitespace-nowrap">{formatDateTime(r.discovered_at)}</td>
                  <td className="td"><Badge tone={SEV_TONE[r.severity]}>{r.severity}</Badge></td>
                  <td className="td max-w-md text-sm">{r.description}</td>
                  <td className="td">{r.npc_notified_at ? formatDateTime(r.npc_notified_at) : r.npc_overdue ? <Badge tone="red">Overdue (72 h)</Badge> : <span className="text-slate-400">-</span>}</td>
                  <td className="td text-right"><Button size="sm" variant="secondary" onClick={() => {
                    setForm({ ...blankIncident, ...Object.fromEntries(Object.keys(blankIncident).map((k) => [k, ['discovered_at', 'occurred_at', 'npc_notified_at', 'subjects_notified_at'].includes(k) ? toInput(r[k]) : (r[k] ?? '')])), incident_id: r.incident_id });
                    setErrors({}); setSaveError(null);
                  }}>Edit</Button></td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.incident_id ? 'Edit incident' : 'Log security incident'} size="lg"
        footer={<><Button variant="secondary" onClick={() => setForm(null)}>Cancel</Button><Button loading={busy} onClick={save}>Save</Button></>}>
        {form && (
          <div className="space-y-3">
            <ErrorNote error={saveError} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Discovered" required error={errors.discovered_at}><input className="input" type="datetime-local" value={form.discovered_at} onChange={set('discovered_at')} /></Field>
              <Field label="Occurred (if known)"><input className="input" type="datetime-local" value={form.occurred_at} onChange={set('occurred_at')} /></Field>
            </div>
            <Field label="Severity" required>
              <select className="input" value={form.severity} onChange={set('severity')}>{['Low', 'Medium', 'High', 'Serious'].map((s) => <option key={s}>{s}</option>)}</select>
            </Field>
            <Field label="What happened" required error={errors.description}><textarea className="input" rows={3} maxLength={3000} value={form.description} onChange={set('description')} /></Field>
            <Field label="People or records affected"><textarea className="input" rows={2} maxLength={1000} value={form.affected} onChange={set('affected')} /></Field>
            <Field label="Actions taken"><textarea className="input" rows={2} maxLength={3000} value={form.actions_taken} onChange={set('actions_taken')} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="NPC notified"><input className="input" type="datetime-local" value={form.npc_notified_at} onChange={set('npc_notified_at')} /></Field>
              <Field label="Affected people notified"><input className="input" type="datetime-local" value={form.subjects_notified_at} onChange={set('subjects_notified_at')} /></Field>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

function SecurityEventsTab() {
  const { data, loading, error, reload } = useApi('/security-events');
  const rows = data?.data || [];
  return (
    <Card>
      {loading && !data ? <Spinner /> : error ? <div className="p-4"><ErrorNote error={error} onRetry={reload} /></div> : rows.length === 0 ? <EmptyState icon={ShieldCheck} title="No security events" /> : (
        <Table>
          <thead className="bg-slate-50"><tr><th className="th">When</th><th className="th">Event</th><th className="th">User</th><th className="th">Detail</th><th className="th">IP</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.event_id}>
                <td className="td whitespace-nowrap">{formatDateTime(r.created_at)}</td>
                <td className="td"><Badge tone={/LOCK|DENIED|FAILED/.test(r.event_type) ? 'red' : 'slate'}>{r.event_type}</Badge></td>
                <td className="td">{r.user_name || <span className="text-slate-400">Unknown</span>}</td>
                <td className="td max-w-md text-xs text-slate-600">{r.detail || '-'}</td>
                <td className="td text-xs">{r.ip_address}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

/**
 * Admin: files under retired document types, archived (hidden everywhere, no view or download). Only the
 * reference number, type and upload date are shown. "Securely dispose" overwrites and removes the file
 * (confirmation and reason required, logged); the record that it existed stays.
 */
function ArchivedDocumentsTab() {
  const { toast } = useApp();
  const { data, loading, error, reload } = useApi('/archived-documents');
  const [target, setTarget] = useState(null);
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const d = data?.data;
  const close = () => { setTarget(null); setReason(''); setConfirmed(false); setSaveError(null); };
  const dispose = async () => {
    setBusy(true); setSaveError(null);
    try {
      await api(`/archived-documents/${target.document_id}/dispose`, { method: 'POST', body: { confirm: true, reason: reason.trim() } });
      toast('The file was securely disposed of. This is recorded in the activity log.'); close(); reload();
    } catch (err) { setSaveError(err); } finally { setBusy(false); }
  };
  return (
    <Card>
      <div className="border-b border-slate-100 p-4 text-sm text-slate-600">
        Files uploaded under document types that are no longer used. They are hidden everywhere and can't be opened. Dispose of a file when it is no longer needed (data minimization, RA 10173).
        {d?.disposed_count ? <span className="block text-xs text-slate-500">{d.disposed_count} already disposed of.</span> : null}
      </div>
      {loading && !data ? <Spinner /> : error ? <div className="p-4"><ErrorNote error={error} onRetry={reload} /></div> : !d.pending.length ? <EmptyState icon={ShieldCheck} title="No archived documents" description="Nothing is waiting to be disposed of." /> : (
        <Table>
          <thead className="bg-slate-50"><tr><th className="th">Application</th><th className="th">Document type</th><th className="th">Uploaded</th><th className="th"><span className="sr-only">Action</span></th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {d.pending.map((r) => (
              <tr key={r.document_id}>
                <td className="td font-mono">{r.reference_no}</td>
                <td className="td">{r.document_type}</td>
                <td className="td whitespace-nowrap">{formatDateTime(r.uploaded_at)}</td>
                <td className="td text-right"><Button size="sm" variant="danger" onClick={() => setTarget(r)}>Securely dispose</Button></td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Modal open={Boolean(target)} onClose={close} title="Securely dispose of this file?" size="sm"
        footer={<><Button variant="secondary" onClick={close}>Cancel</Button><Button variant="danger" loading={busy} disabled={!confirmed || reason.trim().length < 10} onClick={dispose}>Dispose permanently</Button></>}>
        {target && (
          <div className="space-y-3 text-sm">
            <ErrorNote error={saveError} />
            <p className="text-slate-700">{target.document_type} for {target.reference_no}, uploaded {formatDateTime(target.uploaded_at)}. The file is overwritten and removed. This can't be undone.</p>
            <Field label="Reason" required hint="At least 10 characters. Recorded with your name and the time."><textarea className="input" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> I understand the file will be permanently removed.</label>
          </div>
        )}
      </Modal>
    </Card>
  );
}

const TOPICS = ['Someone saw a record they should not have', 'A record was shared or printed', 'Wrong access or a missing lock', 'Other'];

/** Staff (and Admin): "Report a privacy concern". Admin and the Data Protection Officer are told (no details in the notification). */
function ReportConcern({ onClose }) {
  const { toast } = useApp();
  const [f, setF] = useState({ topic: '', details: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const errs = error?.details?.errors || {};
  const send = async () => {
    setBusy(true); setError(null);
    try { const res = await api('/privacy-concerns', { method: 'POST', body: f }); toast(res.message); onClose(); }
    catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Report a privacy concern" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={send}>Send</Button></>}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">Tell the Admin and the Data Protection Officer about something that may have exposed a child's or another person's data. Use case numbers, not names.</p>
        <ErrorNote error={error && !Object.keys(errs).length ? error : null} />
        <Field label="What is it about?" required error={errs.topic}>
          <select className="input" value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value })}><option value="">Choose…</option>{TOPICS.map((t) => <option key={t}>{t}</option>)}</select>
        </Field>
        <Field label="What happened?" required error={errs.details}><textarea className="input" rows={4} maxLength={2000} value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

/** Admin: privacy concerns reported by staff. */
function ConcernsTab() {
  const { toast } = useApp();
  const { data, loading, error, reload, setData } = useApi('/privacy-concerns');
  const rows = data?.data || [];
  const review = async (c) => {
    try { setData(await api(`/privacy-concerns/${c.concern_id}/review`, { method: 'POST' })); toast('Marked as reviewed.'); }
    catch (err) { toast(err.message, 'error'); }
  };
  return (
    <Card>
      {loading && !data ? <Spinner /> : error ? <div className="p-4"><ErrorNote error={error} onRetry={reload} /></div> : rows.length === 0 ? <EmptyState icon={ShieldCheck} title="No privacy concerns" /> : (
        <Table label="Privacy concerns">
          <thead className="bg-slate-50"><tr><th className="th">Reported</th><th className="th">By</th><th className="th">About</th><th className="th">Details</th><th className="th">Status</th><th className="th"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody className="divide-y divide-slate-100">{rows.map((c) => (
            <tr key={c.concern_id}>
              <td className="td whitespace-nowrap text-xs">{formatDateTime(c.created_at)}</td><td className="td">{c.reported_by_name}</td><td className="td text-sm">{c.topic}</td>
              <td className="td max-w-md whitespace-pre-wrap text-sm">{c.details}</td>
              <td className="td"><Badge tone={c.status === 'Open' ? 'amber' : 'green'}>{c.status}</Badge>{c.reviewed_by_name && <p className="text-xs text-slate-500">{c.reviewed_by_name}</p>}</td>
              <td className="td text-right">{c.status === 'Open' && <Button size="sm" variant="secondary" onClick={() => review(c)}>Mark reviewed<span className="sr-only"> concern from {c.reported_by_name}</span></Button>}</td>
            </tr>))}</tbody>
        </Table>
      )}
    </Card>
  );
}

/** Data protection (RA 10173): requests (Admin, Staff), incidents and security events (Admin). */
export default function DataProtection() {
  const { user } = useAuth();
  const isAdmin = user.role === 'Admin';
  const tabs = [['requests', 'Data subject requests'], ...(isAdmin ? [['concerns', 'Privacy concerns'], ['incidents', 'Incident log'], ['events', 'Security events'], ['archived', 'Archived documents']] : [])];
  const [params] = useSearchParams();
  const [tab, setTab] = useState(() => (tabs.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'requests'));
  const [reporting, setReporting] = useState(false);
  return (
    <>
      <PageHeader title="Data protection" description="Requests from people to see or correct their data, privacy concerns, security incidents, and security events. The Data Protection Officer contact is set in Settings."
        actions={<Button variant="secondary" onClick={() => setReporting(true)}><MessageSquareWarning className="h-4 w-4" aria-hidden /> Report a privacy concern</Button>} />
      {reporting && <ReportConcern onClose={() => setReporting(false)} />}
      <div className="mb-4 inline-flex rounded-lg bg-white p-1 shadow-card" role="tablist">
        {tabs.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${tab === k ? 'bg-brand text-white' : 'text-slate-600 hover:text-navy-900'}`}>{l}</button>
        ))}
      </div>
      {tab === 'requests' && <RequestsTab />}
      {tab === 'concerns' && isAdmin && <ConcernsTab />}
      {tab === 'incidents' && isAdmin && <IncidentsTab />}
      {tab === 'events' && isAdmin && <SecurityEventsTab />}
      {tab === 'archived' && isAdmin && <ArchivedDocumentsTab />}
    </>
  );
}
