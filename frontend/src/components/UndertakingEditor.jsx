import { useEffect, useState } from 'react';
import { History, ShieldAlert } from 'lucide-react';
import useApi from '../hooks/useApi';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { Button, Card, ErrorNote, Field } from './ui';
import { formatDateTime } from '../lib/format';

const AREAS = [{ key: 'adoption', label: 'Adoption' }, { key: 'transition', label: 'Transition Review' }];

/**
 * Admin: the confidentiality undertaking text for each area. Saving creates a new version (CU-2026-2,
 * CU-TR-2026-2), shown the next time someone opens that area in a new session. Earlier versions stay
 * exactly as saved, so the log always shows what was accepted.
 */
export default function UndertakingEditor() {
  const { toast } = useApp();
  const [area, setArea] = useState('adoption');
  const { data, error, reload } = useApi(`/compliance/undertaking/versions?area=${area}`);
  const versions = data?.data || [];
  const current = versions[0];
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(null);
  useEffect(() => { setEditing(false); setConfirm(false); }, [area]);

  const start = () => { setTitle(current.title); setText(current.paragraphs.join('\n\n')); setEditing(true); setSaveError(null); };
  const save = async () => {
    setBusy(true); setSaveError(null);
    try {
      await api('/compliance/undertaking', { method: 'PUT', body: { area, title, paragraphs: text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean) } });
      toast('New version saved. It shows the next time someone opens this area in a new session.'); setEditing(false); setConfirm(false); reload();
    } catch (err) { setSaveError(err); setConfirm(false); } finally { setBusy(false); }
  };

  return (
    <Card className="mt-6 space-y-4 p-5">
      <h2 className="flex items-center gap-2 font-semibold text-navy-900"><ShieldAlert className="h-4 w-4 text-red-600" aria-hidden /> Confidentiality undertaking</h2>
      <p className="text-xs text-slate-500">Admin and Staff accept it the first time they open each area in a sign-in session. Check legal wording with your adviser before changing it.</p>
      <div className="inline-flex rounded-lg bg-slate-100 p-1" role="tablist" aria-label="Area">
        {AREAS.map((a) => (
          <button key={a.key} type="button" role="tab" aria-selected={area === a.key} onClick={() => setArea(a.key)}
            className={`rounded-md px-3 py-1 text-sm font-medium ${area === a.key ? 'bg-white text-navy-900 shadow-sm' : 'text-slate-600'}`}>{a.label}</button>
        ))}
      </div>
      <ErrorNote error={error} onRetry={reload} />
      {current && !editing && (
        <>
          <p className="text-sm text-slate-600">Current version <strong>{current.version}</strong>{current.created_by_name ? `, saved by ${current.created_by_name}` : ''} on {formatDateTime(current.created_at)}.</p>
          <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <p className="font-medium">{current.title}</p>
            {current.paragraphs.map((p) => <p key={p}>{p}</p>)}
          </div>
          <Button variant="secondary" onClick={start}>Edit text (new version)</Button>
        </>
      )}
      {editing && (
        <div className="space-y-3">
          <ErrorNote error={saveError} />
          <Field label="Title"><input className="input" maxLength={150} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Text" hint="Leave a blank line between paragraphs. Saved exactly as typed.">
            <textarea className="input font-[inherit]" rows={10} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          {confirm ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              <span className="flex-1">Save as a new version? It replaces the current text for this area.</span>
              <Button size="sm" loading={busy} onClick={save}>Save new version</Button>
              <Button size="sm" variant="secondary" onClick={() => setConfirm(false)}>Back</Button>
            </div>
          ) : (
            <div className="flex gap-2"><Button onClick={() => setConfirm(true)}>Save</Button><Button variant="secondary" onClick={() => setEditing(false)}>Cancel</Button></div>
          )}
        </div>
      )}
      {versions.length > 0 && (
        <div className="border-t border-slate-100 pt-3">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-navy-800"><History className="h-4 w-4" aria-hidden /> Change history</h3>
          <ul className="divide-y divide-slate-100 text-sm">
            {versions.map((v) => (
              <li key={v.version_id} className="py-2">
                <p><strong>{v.version}</strong>{v.previous_version ? ` (replaced ${v.previous_version})` : ' (first version)'}{v.created_by_name ? `, by ${v.created_by_name}` : ''} · {formatDateTime(v.created_at)}</p>
                <p className="text-xs text-slate-500">{v.acceptances} acceptance{v.acceptances === 1 ? '' : 's'} recorded</p>
                <details className="mt-1 text-xs text-slate-600"><summary className="cursor-pointer text-brand">Show the text as saved</summary>
                  <div className="mt-1 space-y-1 rounded bg-slate-50 p-2"><p className="font-medium">{v.title}</p>{v.paragraphs.map((p) => <p key={p}>{p}</p>)}</div>
                </details>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
