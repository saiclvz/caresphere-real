import { useState } from 'react';
import { MessageSquarePlus } from 'lucide-react';
import { api } from '../../../api/client';
import { useApp } from '../../../context/AppContext';
import { formatDateTime } from '../../../lib/format';
import { Button, Card, Field } from '../../../components/ui';
import { headersFor, TabState, useTab } from './common';

/**
 * Notes: "Message to the applicant" (the applicant sees it; written in Update status) apart from
 * "Internal notes" (never shown to the applicant). As before, a note can be added only after you save a
 * status update, and it is attached to that update.
 */
export default function NotesTab({ app, version, sessionUpdate, onChanged }) {
  const { toast } = useApp();
  const state = useTab(app.application_id, 'notes', version);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    try {
      await api(`/adoptions/${app.application_id}/notes`, { method: 'POST', body: { history_id: sessionUpdate.history_id, note: note.trim() }, headers: headersFor(app.application_id) });
      setNote(''); toast('Internal note added.'); onChanged();
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <TabState state={state} rows={6}>
      {(d) => (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-4">
            <h3 className="font-semibold text-navy-900">Messages to the applicant</h3>
            <p className="text-xs text-slate-500">The applicant sees these on their timeline. Write one in Update status.</p>
            {d.messages.length === 0 ? <p className="mt-3 text-sm text-slate-500">No messages sent.</p> : (
              <ul className="mt-3 space-y-2">{d.messages.map((m) => (
                <li key={m.history_id} className="rounded-lg border border-slate-100 p-3 text-sm">
                  <p className="text-xs text-slate-500">{formatDateTime(m.created_at)}{m.by_name ? ` · ${m.by_name}${m.by_role ? ` (${m.by_role})` : ''}` : ''}{m.to_status ? ` · with "${m.to_status}"` : ''}</p>
                  <p className="mt-1 whitespace-pre-line text-navy-900">{m.message}</p>
                </li>
              ))}</ul>
            )}
          </Card>
          <Card className="p-4">
            <h3 className="font-semibold text-navy-900">Internal notes</h3>
            <p className="text-xs text-slate-500">Admin and assigned staff only. Never shown to the applicant.</p>
            <div className="mt-3 space-y-2">
              <Field label="Add internal note" hint={sessionUpdate ? `Attached to your update "${sessionUpdate.status}" at ${formatDateTime(sessionUpdate.at)}.` : 'Save a status update first. Notes are attached to the status update you just saved.'}>
                <textarea className="input" rows={3} maxLength={5000} disabled={!sessionUpdate} value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
              <Button size="sm" variant="secondary" disabled={!sessionUpdate || !note.trim()} loading={busy} onClick={add}><MessageSquarePlus className="h-4 w-4" aria-hidden /> Add note</Button>
            </div>
            {d.internal_notes.length === 0 ? <p className="mt-3 text-sm text-slate-500">No internal notes.</p> : (
              <ul className="mt-3 space-y-2">{d.internal_notes.map((n) => (
                <li key={n.note_id} className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
                  <p className="text-xs text-amber-800">{formatDateTime(n.created_at)} · {n.author_name}{n.author_role ? ` (${n.author_role})` : ''}{n.status ? ` · on "${n.status}"` : ''}</p>
                  <p className="mt-1 whitespace-pre-line">{n.note}</p>
                </li>
              ))}</ul>
            )}
          </Card>
        </div>
      )}
    </TabState>
  );
}
