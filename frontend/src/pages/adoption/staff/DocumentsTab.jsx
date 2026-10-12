import { useState } from 'react';
import { CheckCircle2, ChevronDown, Download, Eye, Lock, RotateCcw, Send, Upload, XCircle } from 'lucide-react';
import { api } from '../../../api/client';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import { downloadFile } from '../../../lib/openFile';
import { readFile } from '../../../lib/files';
import { formatDate, formatDateTime } from '../../../lib/format';
import { Badge, Button, EmptyState, Field } from '../../../components/ui';
import { headersFor, REQ_TONE, StatusChip, TabState, useTab } from './common';

const NEEDS_REVIEW = ['Uploaded', 'Submitted', 'Under validation', 'Manual verification required'];
const FILTERS = [['all', 'All'], ['blocking', 'Blocking'], ['review', 'Needs review']];
const RESTRICTED_TIP = 'Restricted record: Staff can open it only while this application is unlocked, and download it only if Admin allows it. Every view is logged.';

function RestrictedChip() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700" title={RESTRICTED_TIP} tabIndex={0}>
      <Lock className="h-3 w-3" aria-hidden /> Restricted<span className="sr-only">. {RESTRICTED_TIP}</span>
    </span>
  );
}

/** Verify, Reject (reason required) or Request correction (message to the applicant) for one file. */
function ReviewActions({ appId, file, onDone }) {
  const { toast } = useApp();
  const [mode, setMode] = useState(null); // 'reject' | 'correction'
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (status, msg = '') => {
    setBusy(true);
    try {
      await api(`/adoptions/${appId}/documents/${file.document_id}/review`, { method: 'POST', body: { status, note: msg }, headers: headersFor(appId) });
      toast(status === 'Verified' ? 'Marked verified.' : status === 'Rejected' ? 'Rejected. The applicant was told why.' : 'Correction requested from the applicant.');
      setMode(null); setNote(''); onDone();
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  if (mode) {
    return (
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <Field label={mode === 'reject' ? 'Reason for rejecting (sent to the applicant)' : 'What to correct (sent to the applicant)'} className="min-w-[16rem] flex-1">
          <input className="input h-9" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
        </Field>
        <Button size="sm" variant={mode === 'reject' ? 'danger' : 'primary'} loading={busy} disabled={note.trim().length < 5}
          onClick={() => send(mode === 'reject' ? 'Rejected' : 'Requires correction', note.trim())}>{mode === 'reject' ? 'Reject' : 'Send request'}</Button>
        <Button size="sm" variant="ghost" onClick={() => { setMode(null); setNote(''); }}>Cancel</Button>
      </div>
    );
  }
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {file.verification_status !== 'Verified' && !file.expired && (
        <Button size="sm" variant="secondary" loading={busy} onClick={() => send('Verified')}><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden /> Verify</Button>
      )}
      <Button size="sm" variant="secondary" onClick={() => setMode('correction')}><RotateCcw className="h-3.5 w-3.5" aria-hidden /> Request correction</Button>
      <Button size="sm" variant="secondary" onClick={() => setMode('reject')}><XCircle className="h-3.5 w-3.5 text-red-600" aria-hidden /> Reject</Button>
    </div>
  );
}

/** Requests for this document: one thread (duplicates merged), Open first, Closed collapsed. */
function Thread({ appId, thread, onDone }) {
  const { toast } = useApp();
  const open = thread.requests.filter((r) => r.status === 'Open');
  const done = thread.requests.filter((r) => r.status !== 'Open');
  const close = async (r) => {
    try { await api(`/adoptions/${appId}/requests/${r.request_id}/close`, { method: 'PUT', headers: headersFor(appId) }); toast('Request closed.'); onDone(); }
    catch (err) { toast(err.message, 'error'); }
  };
  const Row = ({ r }) => (
    <li className="flex flex-wrap items-start justify-between gap-2 py-1">
      <span className="min-w-0 text-xs text-slate-600">Requested {formatDateTime(r.requested_at)}{r.requested_by_name ? ` by ${r.requested_by_name}` : ''}{r.message ? <span className="block text-slate-700">"{r.message}"</span> : null}</span>
      <span className="flex items-center gap-1.5"><StatusChip status={r.status} />{r.status === 'Open' && <Button size="sm" variant="ghost" onClick={() => close(r)}>Close</Button>}</span>
    </li>
  );
  return (
    <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2">
      <p className="text-xs font-medium text-slate-700">Requests to the applicant{thread.merged > 1 ? ` (${thread.merged}, merged)` : ''}</p>
      {open.length > 0 && <ul className="divide-y divide-slate-200">{open.map((r) => <Row key={r.request_id} r={r} />)}</ul>}
      {done.length > 0 && (
        <details className="mt-1 text-xs"><summary className="cursor-pointer text-brand">{done.length} closed or fulfilled</summary>
          <ul className="divide-y divide-slate-200">{done.map((r) => <Row key={r.request_id} r={r} />)}</ul>
        </details>
      )}
    </div>
  );
}

function DocumentRow({ appId, row, isAdmin, onOpen, onRequest, canRequest, onDone }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const upload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!['application/pdf', 'image/png', 'image/jpeg'].includes(file.type)) { toast('Only PDF, PNG or JPG files are accepted.', 'error'); return; }
    if (file.size > 10 * 1024 * 1024) { toast('The file is larger than 10 MB.', 'error'); return; }
    setBusy(true);
    try {
      const f = await readFile(file);
      await api(`/adoptions/${appId}/documents`, { method: 'POST', body: { doc_type: row.doc_type, file: { name: f.name, data: f.data } } });
      toast('Document uploaded.'); onDone();
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  const download = (f) => downloadFile(`/adoptions/${appId}/documents/${f.document_id}?download=1`, f.display_name, headersFor(appId)).catch((err) => toast(err.message, 'error'));
  const restrict = async (f) => {
    try { await api(`/adoptions/${appId}/documents/${f.document_id}/protect`, { method: 'POST' }); toast('The document is now restricted.'); onDone(); }
    catch (err) { toast(err.message, 'error'); }
  };
  const toggleDownload = async (f) => {
    try {
      await api(`/protected-records/${f.record_id}`, { method: 'PUT', body: { allow_download: !f.allow_staff_download } });
      toast(!f.allow_staff_download ? 'Staff can now download a watermarked copy. Each download is logged.' : 'Staff downloads are off for this document.'); onDone();
    } catch (err) { toast(err.message, 'error'); }
  };
  const restricted = row.files.some((f) => f.restricted) || row.restricted_type;
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-navy-900">{row.label}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge tone={REQ_TONE[row.requirement] || 'slate'}>{row.requirement}</Badge>
            <StatusChip status={row.status} />
            {row.blocking && <Badge tone="red">Blocking</Badge>}
            {restricted && <RestrictedChip />}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {row.can_upload && (
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-navy-900 focus-within:ring-2 focus-within:ring-brand hover:bg-slate-50">
              <Upload className="h-3.5 w-3.5" aria-hidden /> {busy ? 'Uploading...' : row.files.length && !row.multiple ? 'Replace' : 'Upload'}
              <input type="file" className="sr-only" accept=".pdf,.png,.jpg,.jpeg" onChange={upload} disabled={busy} aria-label={`Upload ${row.label}`} />
            </label>
          )}
          {!row.files.length && canRequest && row.group === 'applicant' && (
            <Button size="sm" variant="secondary" onClick={() => onRequest(row)}><Send className="h-3.5 w-3.5" aria-hidden /> Request</Button>
          )}
        </div>
      </div>
      {row.files.length === 0 ? <p className="mt-1 text-sm text-slate-400">No file uploaded.</p> : (
        <ul className="mt-2 space-y-2">
          {row.files.map((f) => (
            <li key={f.document_id} className="rounded-lg border border-slate-200 p-2 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium text-navy-900">{f.display_name}</p>
                  <p className="text-xs text-slate-500">Uploaded by {f.uploaded_by_name || 'the applicant'} on {formatDate(f.uploaded_at)}
                    {f.issued_date ? ` · issued ${formatDate(f.issued_date)}` : ''}{f.expires_on ? ` · valid to ${formatDate(f.expires_on)}` : ''}</p>
                  {f.reviewed_at && <p className="text-xs text-slate-500">{f.verification_status} by {f.reviewed_by_name || 'staff'} on {formatDate(f.reviewed_at)}</p>}
                  {f.review_note && <p className="text-xs text-amber-800">Note to the applicant: {f.review_note}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusChip status={f.expired ? 'Expired' : !row.reviewable ? 'Uploaded' : f.verification_status || 'Uploaded'} />
                  <Button size="sm" variant="secondary" onClick={() => onOpen(f)}><Eye className="h-3.5 w-3.5" aria-hidden /> View</Button>
                  {f.can_download && <Button size="sm" variant="ghost" onClick={() => download(f)} aria-label={`Download ${f.display_name}`}><Download className="h-3.5 w-3.5" aria-hidden /></Button>}
                </div>
              </div>
              {row.reviewable && <ReviewActions appId={appId} file={f} onDone={onDone} />}
              {isAdmin && (
                <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-slate-600">
                  {f.restricted ? (
                    <label className="inline-flex items-center gap-2">
                      <input type="checkbox" className="h-3.5 w-3.5 accent-brand" checked={f.allow_staff_download} onChange={() => toggleDownload(f)} />
                      Allow Staff to download (watermarked)
                    </label>
                  ) : <button type="button" className="text-slate-500 underline-offset-2 hover:text-navy-900 hover:underline" onClick={() => restrict(f)}>Mark as restricted</button>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {row.thread && <Thread appId={appId} thread={row.thread} onDone={onDone} />}
    </li>
  );
}

/**
 * Documents tab: one list of every document (the applicant's, the child's, case and legal, post-placement),
 * each once, with clear actions, and the requests to the applicant shown as one thread per document.
 */
export default function DocumentsTab({ app, version, initialFilter = 'all', onOpenDoc, onRequest, onChanged }) {
  const { user } = useAuth();
  const isAdmin = user.role === 'Admin';
  const state = useTab(app.application_id, 'documents', version);
  const [filter, setFilter] = useState(initialFilter);
  const canRequest = (app.allowed_statuses || []).includes('Documents requested');
  return (
    <TabState state={state} rows={8}>
      {(d) => {
        const match = (r) => filter === 'all' || (filter === 'blocking' ? r.blocking : NEEDS_REVIEW.includes(r.status) || r.files.some((f) => NEEDS_REVIEW.includes(f.verification_status) && !f.expired));
        const shown = d.rows.filter(match);
        return (
          <div className="space-y-4">
            <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">No official verification service is connected, so each document is verified by a person and the result is logged.</p>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-slate-700"><span className="font-medium text-navy-900">{d.summary.verified} of {d.summary.required}</span> required items verified{d.open_requests ? ` · ${d.open_requests} open request${d.open_requests === 1 ? '' : 's'}` : ''}</p>
              <div role="radiogroup" aria-label="Show" className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
                {FILTERS.map(([k, label]) => (
                  <button key={k} type="button" role="radio" aria-checked={filter === k} onClick={() => setFilter(k)}
                    className={`rounded-md px-3 py-1 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${filter === k ? 'bg-navy-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
                    {label} <span className="opacity-70">({d.rows.filter((r) => k === 'all' || (k === 'blocking' ? r.blocking : NEEDS_REVIEW.includes(r.status) || r.files.some((f) => NEEDS_REVIEW.includes(f.verification_status) && !f.expired))).length})</span>
                  </button>
                ))}
              </div>
            </div>
            {shown.length === 0 && <EmptyState title={filter === 'blocking' ? 'Nothing is blocking' : 'Nothing needs review'} description="Choose All to see every document." />}
            {d.groups.map((g) => {
              const rows = shown.filter((r) => r.group === g.key);
              if (!rows.length) return null;
              return (
                <section key={g.key} aria-labelledby={`dg-${g.key}`}>
                  <h3 id={`dg-${g.key}`} className="flex items-baseline gap-2 border-b border-slate-200 pb-1 font-semibold text-navy-900">{g.label} <span className="text-xs font-normal text-slate-500">{g.hint}</span></h3>
                  <ul className="divide-y divide-slate-100">
                    {rows.map((r) => <DocumentRow key={`${r.group}-${r.doc_type}`} appId={app.application_id} row={r} isAdmin={isAdmin} onOpen={onOpenDoc} onRequest={onRequest} canRequest={canRequest} onDone={onChanged} />)}
                  </ul>
                </section>
              );
            })}
            {d.other_threads.length > 0 && (
              <details className="rounded-lg border border-slate-200 p-3 text-sm"><summary className="cursor-pointer font-medium text-navy-900">Other requests <ChevronDown className="inline h-4 w-4" aria-hidden /></summary>
                {d.other_threads.map((t) => <div key={t.doc_type}><p className="mt-2 text-sm font-medium">{t.label}</p><Thread appId={app.application_id} thread={t} onDone={onChanged} /></div>)}
              </details>
            )}
          </div>
        );
      }}
    </TabState>
  );
}
