import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, CalendarClock, FileText, Heart, Pencil, Printer } from 'lucide-react';
import useApi from '../hooks/useApi';
import { api } from '../api/client';
import { openFileInNewTab } from '../lib/openFile';
import { useApp } from '../context/AppContext';
import { Modal, Spinner } from '../components/ui';
import { readFile } from '../lib/files';
import { formatDate, formatDateTime } from '../lib/format';
import { DocumentField } from './adoption/FieldControls';
import PhaseTracker from './adoption/PhaseTracker';
import VerificationList from '../components/adoption/VerificationList';
import PrivacyRequests from './adoption/PrivacyRequests';
import { AFTER_ORDER } from './adoption/formLogic';
import './adoption/adoption.css';

export const THANK_YOU = 'Thank you for opening your heart and home. The Order of Adoption has been issued, and the CareSphere team will contact you about the remaining steps.';

const CHIP = { Draft: 'cs-chip-optional', 'Documents requested': 'cs-chip-warn', Declined: 'cs-chip-missing', Withdrawn: 'cs-chip-optional', 'Placement ended': 'cs-chip-warn' };
export function StatusBadge({ status, label }) {
  const cls = CHIP[status] || (AFTER_ORDER.includes(status) ? 'cs-chip-done' : 'cs-chip-info');
  return <span className={`cs-chip ${cls}`}>{label || status}</span>;
}

/** Opens one of the applicant's own files in a new tab (the server checks ownership and logs the view). */
const openDocument = (applicationId, doc) => openFileInNewTab(`/adoptions/${applicationId}/documents/${doc.document_id}`);

/**
 * Submission slip: the reference to keep. The printed slip shows only the home name, the
 * reference and the submitted date. QR links are for authorized staff only, so donors get no QR.
 */
function SubmissionSlip({ app, orgName }) {
  return (
    <section className="cs-card p-4" aria-labelledby="slip-title">
      <h2 id="slip-title" className="cs-title mb-3">Submission slip</h2>
      <p className="cs-muted text-xs">Reference number</p>
      <p className="cs-title font-mono text-lg">{app.reference_no}</p>
      <p className="cs-muted text-xs">Submitted {formatDate(app.submitted_at)}</p>
      <p className="cs-hint">Keep this reference for any follow-up with the home.</p>
      <button type="button" className="cs-btn cs-btn-sm mt-2" onClick={() => window.print()}><Printer className="h-4 w-4" aria-hidden /> Print</button>
      <div className="cs-print-slip is-active" aria-hidden="true">
        <p style={{ fontSize: 20, fontWeight: 700, marginBottom: 24 }}>{orgName}</p>
        <p style={{ fontSize: 14, marginBottom: 8 }}>Adoption application</p>
        <p style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 26, fontWeight: 700 }}>{app.reference_no}</p>
        <p style={{ fontSize: 13, marginTop: 8 }}>Submitted {formatDate(app.submitted_at)}</p>
      </div>
    </section>
  );
}

/** /applications/:id: the donor's own application. Only remarks to the applicant are shown, never internal notes. */
export default function MyApplicationDetail() {
  const { id } = useParams();
  const { toast, orgName, refreshRequests } = useApp();
  const configReq = useApi('/adoptions/form-config');
  const [app, setApp] = useState(null);
  const [error, setError] = useState(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api(`/adoptions/${id}`).then((r) => setApp(r.data)).catch(setError), [id]);
  useEffect(() => { load(); }, [load]);
  // Opening the application marks its notifications read.
  useEffect(() => { api(`/notifications/read-application/${id}`, { method: 'POST' }).then(() => refreshRequests?.()).catch(() => {}); }, [id, refreshRequests]);

  const config = configReq.data?.data;
  if (error) {
    return <div className="cs-theme cs-page"><div className="cs-notice cs-notice-error" role="alert">{error.message}</div><Link to="/applications" className="cs-link mt-3 inline-block text-sm">Back to My applications</Link></div>;
  }
  if (!app || !config) return <div className="cs-theme cs-page"><Spinner label="Loading your application" /></div>;

  const openRequests = app.requests.filter((r) => r.status === 'Open');
  const upcoming = app.interviews.filter((i) => new Date(String(i.scheduled_at).replace(' ', 'T')) >= new Date(Date.now() - 86400000));
  const docLabel = (t) => config.documents[t]?.label || config.retired_documents?.[t] || t;

  const uploadRequested = async (docType, file, issuedDate) => {
    const f = await readFile(file);
    const res = await api(`/adoptions/${app.application_id}/documents`, { method: 'POST', body: { doc_type: docType, file: { name: f.name, data: f.data }, issued_date: issuedDate } });
    setApp(res.data);
    refreshRequests?.();
    toast(docType === 'forum_certificate' ? 'Forum certificate sent to the home.' : 'Document sent to the home.');
  };

  const withdraw = async () => {
    setBusy(true);
    try {
      const res = await api(`/adoptions/${app.application_id}/withdraw`, { method: 'POST' });
      setApp(res.data); setWithdrawing(false); refreshRequests?.();
      toast('Your application was withdrawn. It stays on file.');
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };

  return (
    <div className="cs-theme cs-page space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/applications" className="cs-link text-sm">My applications</Link>
          <h1 className="cs-title mt-1 text-2xl">{app.reference_no || 'Draft application'}</h1>
          <p className="cs-muted text-sm">
            {app.submitted_at ? `Submitted ${formatDate(app.submitted_at)}` : `Started ${formatDate(app.created_at)}`}
            {app.matched_child && <> · Matched child: {app.matched_child.display_name}</>}
          </p>
        </div>
        <StatusBadge status={app.status} label={app.status_label} />
      </div>

      <PhaseTracker app={app} />

      {AFTER_ORDER.includes(app.status) && (
        <div className="cs-notice cs-notice-success flex gap-3"><Heart className="h-5 w-5 shrink-0" style={{ color: 'var(--cs-success)' }} aria-hidden /><p>{THANK_YOU}</p></div>
      )}

      {app.status === 'Draft' && (
        <div className="cs-card flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm">This application is a draft. Continue where you left off and submit it when everything is ready.</p>
          <Link to={`/applications/${app.application_id}/edit`} className="cs-btn cs-btn-primary"><Pencil className="h-4 w-4" aria-hidden /> Continue application</Link>
        </div>
      )}

      {openRequests.length > 0 && (
        <section className="cs-notice cs-notice-warn space-y-3" aria-labelledby="requests-title">
          <div className="flex gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0" style={{ color: 'var(--cs-warning)' }} aria-hidden />
            <div>
              <h2 id="requests-title" className="cs-title">The home requested {openRequests.length === 1 ? 'a document' : `${openRequests.length} documents`}</h2>
              <p className="text-sm">Upload {openRequests.length === 1 ? 'it' : 'them'} below. This notice stays until you upload or the home closes the request.</p>
            </div>
          </div>
          {openRequests.map((r) => (
            <div key={r.request_id} className="space-y-1">
              {r.message && <p className="text-sm"><span className="cs-muted">Note from the home:</span> {r.message}</p>}
              <DocumentField docType={r.doc_type} def={{ ...(config.documents[r.doc_type] || { label: docLabel(r.doc_type), multiple: true }), multiple: true }}
                required rules={config.file_rules} canRemove={false}
                files={app.documents.filter((d) => d.request_id === r.request_id)} onUpload={uploadRequested} onRemove={() => {}} />
            </div>
          ))}
        </section>
      )}

      <VerificationList app={app} config={config} mode="donor" onUpdated={setApp} />
      {app.can_upload_forum_certificate && config.stage_documents?.forum_certificate && (
        <section className="cs-card space-y-2 p-4" aria-labelledby="forum-title">
          <h2 id="forum-title" className="cs-title">Adoption forum certificate</h2>
          <p className="cs-muted text-sm">After you attend the adoption forum, upload your certificate here. A social worker will check it.</p>
          <DocumentField docType="forum_certificate" def={config.stage_documents.forum_certificate} required rules={config.file_rules} canRemove={false}
            files={app.documents.filter((d) => d.doc_type === 'forum_certificate' && d.status !== 'Replaced')} onUpload={uploadRequested} onRemove={() => {}} />
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
          {upcoming.length > 0 && (
            <section className="cs-card p-4" aria-labelledby="visits-title">
              <h2 id="visits-title" className="cs-title mb-2">Scheduled interview or home visit</h2>
              <ul className="space-y-2">
                {upcoming.map((i) => (
                  <li key={i.interview_id} className="flex gap-3 text-sm">
                    <CalendarClock className="h-5 w-5 shrink-0" style={{ color: 'var(--cs-primary)' }} aria-hidden />
                    <span><span className="cs-title">{i.kind}</span>, {formatDateTime(i.scheduled_at)}{i.details && <span className="cs-muted block">{i.details}</span>}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="cs-card p-4" aria-labelledby="timeline-title">
            <h2 id="timeline-title" className="cs-title mb-3">Status timeline</h2>
            {app.history.length === 0 ? <p className="cs-muted text-sm">No updates yet.</p> : (
              <ol className="cs-timeline space-y-4">
                {app.history.map((h) => (
                  <li key={h.history_id} className="relative">
                    <span className="cs-timeline-dot" aria-hidden />
                    <p className="text-sm">
                      {h.to_status ? <span className="cs-title">{config.status_labels[h.to_status] || h.to_status}</span> : <span className="cs-title">Message from the home</span>}
                      <span className="cs-muted"> · {formatDateTime(h.created_at)}</span>
                    </p>
                    {h.remark_to_applicant && <p className="mt-1 whitespace-pre-line text-sm">{h.remark_to_applicant}</p>}
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="cs-card p-4" aria-labelledby="docs-title">
            <h2 id="docs-title" className="cs-title mb-2">Your documents</h2>
            {app.documents.filter((d) => d.status !== 'Replaced').length === 0 ? <p className="cs-muted text-sm">No documents uploaded.</p> : (
              <ul className="space-y-1">
                {app.documents.filter((d) => d.status !== 'Replaced').map((d) => (
                  <li key={d.document_id} className="flex flex-wrap items-center gap-2 text-sm">
                    <FileText className="h-4 w-4 shrink-0 cs-muted" aria-hidden />
                    <span className="cs-muted">{docLabel(d.doc_type)}:</span>
                    <button type="button" className="cs-link min-w-0 truncate" onClick={() => openDocument(app.application_id, d).catch((e) => toast(e.message, 'error'))}>{d.original_name}</button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          {app.status !== 'Draft' && app.reference_no && <SubmissionSlip app={app} orgName={orgName} />}
          <PrivacyRequests applicationId={app.application_id} />
          {app.can_withdraw && (
            <section className="cs-card p-4">
              <h2 className="cs-title mb-1 text-sm">{app.status === 'Draft' ? 'Discard this draft' : 'Withdraw application'}</h2>
              <p className="cs-muted mb-3 text-xs">You can withdraw at any stage before the Order of Adoption is issued. It stays on file as Withdrawn and you can apply again later.</p>
              <button type="button" className="cs-btn cs-btn-sm cs-btn-danger" onClick={() => setWithdrawing(true)}>Withdraw application</button>
            </section>
          )}
        </aside>
      </div>

      <Modal open={withdrawing} onClose={() => setWithdrawing(false)} title="Withdraw this application?" size="sm"
        footer={<>
          <button type="button" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium" onClick={() => setWithdrawing(false)}>Keep application</button>
          <button type="button" className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={busy} onClick={withdraw}>{busy ? 'Withdrawing...' : 'Withdraw'}</button>
        </>}>
        <p className="text-sm text-slate-600">The home will stop reviewing {app.reference_no || 'this draft'}. This can't be undone, but the application stays on file and you can start a new one later.</p>
      </Modal>
    </div>
  );
}
