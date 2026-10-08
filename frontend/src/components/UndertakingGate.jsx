import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { Button, Card, ErrorNote, Spinner } from './ui';

/**
 * Confidentiality undertaking for an area (adoption | transition), the first time each sign-in
 * session opens it, by any route (sidebar, typed URL, notification, deep link). Mounted only as a
 * route guard in App.jsx; it replaces the whole page content with the card alone. Accepting shows the
 * page that was asked for, at the same URL. Decline returns to the Dashboard. The server enforces
 * the same rule on every request for the area's data; this screen only lets the user accept.
 */
export default function UndertakingGate({ area, children }) {
  const { user, acceptedAreas, markAreaAccepted } = useAuth();
  const { toast } = useApp();
  const navigate = useNavigate();
  const staff = ['Admin', 'Staff'].includes(user?.role);
  const known = !staff || acceptedAreas.has(area);
  const [u, setU] = useState(null);
  const [error, setError] = useState(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(null);
  const box = useRef(null);

  const load = () => api(`/compliance/undertaking?area=${area}`).then((r) => {
    if (r.data.accepted) markAreaAccepted(area); else setU(r.data);
  }).catch(setError);
  useEffect(() => { if (!known) load(); }, [area, known]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (u) box.current?.focus(); }, [u]);

  if (known) return children;
  if (error) return <ErrorNote error={error} onRetry={load} />;
  if (!u) return <Spinner />;

  const accept = async () => {
    setBusy('accept'); setError(null);
    try { await api('/compliance/undertaking', { method: 'POST', body: { area, version: u.version } }); markAreaAccepted(area); }
    catch (err) { if (err.status === 409) { setChecked(false); load(); } setError(err); }
    finally { setBusy(null); }
  };
  const decline = async () => {
    setBusy('decline');
    await api('/compliance/undertaking/decline', { method: 'POST', body: { area } }).catch(() => {});
    toast('You need to accept the undertaking to open these records.');
    navigate('/', { replace: true });
  };

  return (
    <div className="flex justify-center py-4">
      <Card className="w-full max-w-2xl space-y-4 p-6">
        <div className="flex items-center gap-2 text-navy-900"><ShieldAlert className="h-5 w-5 text-red-600" aria-hidden /><h1 className="text-lg font-semibold">{u.title}</h1></div>
        <p className="text-sm text-slate-600">Accept this each time you sign in, before opening {u.records}. It is recorded with the date, time, and version ({u.version}).</p>
        <div className="max-h-[50vh] space-y-2 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          {u.paragraphs.map((p) => <p key={p}>{p}</p>)}
        </div>
        <ErrorNote error={error} />
        <label className="flex items-start gap-2 text-sm">
          <input ref={box} type="checkbox" className="mt-0.5 h-5 w-5 accent-brand" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          <span>I have read and accept this confidentiality undertaking.<span className="ml-0.5 text-red-600" aria-hidden="true">*</span></span>
        </label>
        <div className="flex flex-col items-start gap-3">
          <Button className="h-11 w-full sm:w-auto" disabled={!checked} loading={busy === 'accept'} onClick={accept}>Accept and continue</Button>
          <button type="button" disabled={Boolean(busy)} onClick={decline} className="text-sm font-medium text-slate-600 underline-offset-2 hover:text-navy-900 hover:underline">Decline</button>
        </div>
      </Card>
    </div>
  );
}
