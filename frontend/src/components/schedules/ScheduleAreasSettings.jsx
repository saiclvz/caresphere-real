import { useState } from 'react';
import useApi from '../../hooks/useApi';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { Button, Card, ErrorNote, Field } from '../ui';

/**
 * Settings > Schedule areas (Admin): the area dropdown for shifts, and older shift areas that matched
 * no area (map each to an area; the shifts' original text is kept).
 */
export default function ScheduleAreasSettings() {
  const { toast } = useApp();
  const areas = useApi('/schedule-areas');
  const unmapped = useApi('/schedule-areas/unmapped');
  const list = areas.data?.data || [];
  const [name, setName] = useState('');
  const [edits, setEdits] = useState({});
  const [mapTo, setMapTo] = useState({});
  const call = async (fn, msg) => { try { await fn(); toast(msg); areas.reload(); unmapped.reload(); } catch (err) { toast(err.message, 'error'); } };
  const add = () => call(async () => { await api('/schedule-areas', { method: 'POST', body: { name, sort_order: (list.length + 1) * 10 } }); setName(''); }, 'Area added.');
  const save = (a) => call(() => api(`/schedule-areas/${a.area_id}`, { method: 'PUT', body: { ...a, ...edits[a.area_id] } }).then(() => setEdits((e) => ({ ...e, [a.area_id]: undefined }))), 'Area saved.');
  const map = (text) => call(() => api('/schedule-areas/map', { method: 'POST', body: { text, area_id: Number(mapTo[text]) } }), 'Shifts mapped.');
  return (
    <Card className="space-y-4 p-5">
      <h2 className="font-semibold text-navy-900">Schedule areas</h2>
      <p className="text-xs text-slate-500">The choices for a shift's area. Hidden areas stay on old shifts but can't be chosen for new ones.</p>
      <ErrorNote error={areas.error} onRetry={areas.reload} />
      <ul className="divide-y divide-slate-100">
        {list.map((a) => {
          const e = { ...a, ...edits[a.area_id] };
          const set = (k, v) => setEdits((x) => ({ ...x, [a.area_id]: { ...x[a.area_id], [k]: v } }));
          return (
            <li key={a.area_id} className="flex flex-wrap items-end gap-2 py-2">
              <Field label="Name"><input className="input w-48" maxLength={60} value={e.name} onChange={(ev) => set('name', ev.target.value)} /></Field>
              <Field label="Order"><input className="input w-20" type="number" min="0" max="999" value={e.sort_order} onChange={(ev) => set('sort_order', Number(ev.target.value))} /></Field>
              <label className="flex items-center gap-1.5 pb-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand" checked={e.is_active} onChange={(ev) => set('is_active', ev.target.checked)} /> Shown</label>
              <Button size="sm" variant="secondary" disabled={!edits[a.area_id]} onClick={() => save(a)}>Save</Button>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="New area"><input className="input w-48" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Laundry" /></Field>
        <Button size="sm" disabled={name.trim().length < 2} onClick={add}>Add area</Button>
      </div>
      {(unmapped.data?.data || []).length > 0 && (
        <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-medium text-amber-900">Older shifts whose area didn't match the list</p>
          <p className="text-xs text-amber-900">Choose the area each one means. The shifts keep their original text; nothing is deleted.</p>
          <ul className="space-y-1">
            {unmapped.data.data.map((u) => (
              <li key={u.text} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="min-w-[8rem] font-medium">"{u.text}"</span><span className="text-xs text-slate-600">{u.shifts} shift{u.shifts === 1 ? '' : 's'}</span>
                <select className="input h-9 w-44" value={mapTo[u.text] || ''} onChange={(e) => setMapTo((m) => ({ ...m, [u.text]: e.target.value }))} aria-label={`Area for "${u.text}"`}>
                  <option value="">Choose an area</option>{list.filter((a) => a.is_active).map((a) => <option key={a.area_id} value={a.area_id}>{a.name}</option>)}
                </select>
                <Button size="sm" variant="secondary" disabled={!mapTo[u.text]} onClick={() => map(u.text)}>Map</Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
