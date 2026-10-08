import { useState } from 'react';
import useApi from '../../hooks/useApi';
import { api } from '../../api/client';
import { formatDate } from '../../lib/format';

/** Data subject requests (RA 10173): ask to see or correct your own data. Staff resolve them. */
export default function PrivacyRequests({ applicationId }) {
  const list = useApi('/privacy-requests/mine');
  const [kind, setKind] = useState('');
  const [details, setDetails] = useState('');
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const rows = (list.data?.data || []).filter((r) => !applicationId || !r.application_id || r.application_id === applicationId);

  const submit = async (e) => {
    e.preventDefault();
    const found = {};
    if (!kind) found.kind = 'Choose what you are asking for.';
    if (details.trim().length < 10) found.details = 'Describe your request (at least 10 characters).';
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true); setError(null);
    try {
      await api('/privacy-requests', { method: 'POST', body: { kind, details: details.trim(), application_id: applicationId } });
      setKind(''); setDetails(''); setSent(true); list.reload();
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  return (
    <section className="cs-card p-4" aria-labelledby="dsr-title">
      <h2 id="dsr-title" className="cs-title">Your data</h2>
      <p className="cs-muted mb-3 text-xs">Ask the home for a copy of your personal data, or to correct it. The home will reply here.</p>
      <form onSubmit={submit} noValidate className="space-y-3">
        {error && <div className="cs-notice cs-notice-error" role="alert">{error.message}</div>}
        {sent && <div className="cs-notice cs-notice-success" role="status">Request sent. The home will reply here.</div>}
        <fieldset>
          <legend className="cs-label">Request<span className="cs-req" aria-hidden="true">*</span></legend>
          <div className="flex flex-wrap gap-4 text-sm">
            {[['Access', 'See my data'], ['Correction', 'Correct my data']].map(([v, l]) => (
              <label key={v} className="flex items-center gap-2"><input type="radio" name="dsr-kind" checked={kind === v} onChange={() => { setKind(v); setSent(false); }} /> {l}</label>
            ))}
          </div>
          {errors.kind && <p className="cs-error" role="alert">{errors.kind}</p>}
        </fieldset>
        <div>
          <label htmlFor="dsr-details" className="cs-label">Details<span className="cs-req" aria-hidden="true">*</span></label>
          <textarea id="dsr-details" className="cs-input" rows={3} maxLength={3000} value={details} aria-invalid={errors.details ? 'true' : undefined}
            onChange={(e) => { setDetails(e.target.value); setSent(false); }} placeholder="For corrections, say what is wrong and what it should be." />
          {errors.details && <p className="cs-error" role="alert">{errors.details}</p>}
        </div>
        <button type="submit" className="cs-btn cs-btn-sm" disabled={busy}>{busy ? 'Sending...' : 'Send request'}</button>
      </form>
      {rows.length > 0 && (
        <ul className="mt-3 space-y-2">
          {rows.map((r) => (
            <li key={r.request_id} className="cs-card cs-surface-2 p-3 text-sm">
              <p><span className="cs-title">{r.kind}</span> <span className="cs-muted">· {formatDate(r.created_at)} · {r.status}</span></p>
              <p className="cs-muted mt-1 whitespace-pre-line">{r.details}</p>
              {r.response && <p className="mt-1 whitespace-pre-line"><span className="cs-muted">Reply: </span>{r.response}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
