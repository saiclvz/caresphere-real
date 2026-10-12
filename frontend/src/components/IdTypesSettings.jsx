import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import useApi from '../hooks/useApi';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { Badge, Button, Card, ErrorNote, Field, Modal, Spinner } from './ui';

const FIELD_LABELS = { full_name: 'Full name', date_of_birth: 'Date of birth', id_number: 'ID number', address: 'Address', date_issued: 'Date issued', expiry_date: 'Expiry date' };
const joinList = (a) => (Array.isArray(a) ? a.join(', ') : '');

const toForm = (t) => ({
  key: t?.key || '', label: t?.label || '', number_regex: t?.number_regex || '', number_example: t?.example || '', expires: t ? t.expires : true,
  needs_back: t ? t.needsBack : true, front_fields: t?.frontFields || ['full_name', 'date_of_birth'], back_fields: t?.backFields || [],
  front_keywords: joinList(t?.frontKeywords), back_keywords: joinList(t?.backKeywords), date_formats: joinList(t?.dateFormats),
  machine: t?.machine || 'none', machine_side: t?.machineSide || 'back', adapter: t?.adapter || 'manual', active: t ? t.active : true,
});

function FieldPicker({ label, value, fields, onChange }) {
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-medium text-navy-800">{label}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {fields.map((f) => (
          <label key={f} className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={value.includes(f)} onChange={(e) => onChange(e.target.checked ? [...value, f] : value.filter((x) => x !== f))} />
            {FIELD_LABELS[f] || f}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Settings > ID types and scanning rules (Admin). Changes apply within a minute, without redeploying. The
 * adapter only says how an ID can be verified officially; "Verified – real and valid" still needs an
 * official result.
 */
export default function IdTypesSettings() {
  const { toast } = useApp();
  const { data, loading, error, reload } = useApi('/id-types');
  const [editing, setEditing] = useState(null); // { isNew, form }
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const d = data?.data;

  const save = async () => {
    const f = editing.form;
    setSaving(true); setSaveError(null);
    try {
      if (f.number_regex) new RegExp(f.number_regex); // eslint-disable-line no-new
      await api(`/id-types/${encodeURIComponent(f.key.trim())}`, { method: 'PUT', body: f });
      toast('ID type saved. It applies within a minute.'); setEditing(null); reload();
    } catch (err) { setSaveError(err instanceof SyntaxError ? new Error('The number format is not a valid regular expression.') : err); } finally { setSaving(false); }
  };
  const set = (k) => (v) => setEditing((e) => ({ ...e, form: { ...e.form, [k]: v } }));
  const f = editing?.form;

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-navy-900">ID types and scanning rules</h2>
          <p className="text-xs text-slate-500">Used by the automatic ID scan on page 3 of the adoption application. Turning a type off removes it from the ID type list for new answers.</p>
        </div>
        <Button size="sm" onClick={() => { setSaveError(null); setEditing({ isNew: true, form: toForm(null) }); }}><Plus className="h-4 w-4" aria-hidden /> Add ID type</Button>
      </div>
      {loading && !d ? <Spinner /> : error ? <ErrorNote error={error} onRetry={reload} /> : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-slate-500"><tr><th className="py-1 pr-3 font-medium">ID type</th><th className="py-1 pr-3 font-medium">Number format</th><th className="py-1 pr-3 font-medium">Back</th><th className="py-1 pr-3 font-medium">Expires</th><th className="py-1 pr-3 font-medium">QR / MRZ</th><th className="py-1 pr-3 font-medium">Verification</th><th className="py-1" /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {d.types.map((t) => (
                <tr key={t.key}>
                  <td className="py-1.5 pr-3"><span className="font-medium text-navy-900">{t.key}</span>{!t.active && <Badge className="ml-2">Off</Badge>}<span className="block text-xs text-slate-500">{t.label}</span></td>
                  <td className="py-1.5 pr-3 text-xs">{t.example || (t.number_regex ? <code>{t.number_regex}</code> : <span className="text-slate-400">not checked</span>)}</td>
                  <td className="py-1.5 pr-3">{t.needsBack ? 'Required' : 'Optional'}</td>
                  <td className="py-1.5 pr-3">{t.expires ? 'Yes' : 'No'}</td>
                  <td className="py-1.5 pr-3">{t.machine === 'none' ? '–' : `${t.machine.toUpperCase()} (${t.machineSide})`}</td>
                  <td className="py-1.5 pr-3 text-xs">{d.adapters.find((a) => a.key === t.adapter)?.label || t.adapter}</td>
                  <td className="py-1.5 text-right"><button type="button" className="rounded p-1 text-slate-500 hover:text-navy-900" aria-label={`Edit ${t.key}`} onClick={() => { setSaveError(null); setEditing({ isNew: false, form: toForm(t) }); }}><Pencil className="h-4 w-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <Modal open onClose={() => setEditing(null)} title={editing.isNew ? 'Add ID type' : `Edit ${f.key}`} size="lg"
          footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button loading={saving} disabled={!f.key.trim()} onClick={save}>Save</Button></>}>
          <div className="space-y-3">
            <ErrorNote error={saveError} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="ID type (as shown in the list)" required hint={editing.isNew ? 'Cannot be changed later.' : undefined}>
                <input className="input" maxLength={60} value={f.key} disabled={!editing.isNew} onChange={(e) => set('key')(e.target.value)} />
              </Field>
              <Field label="Full name of the ID"><input className="input" maxLength={80} value={f.label} onChange={(e) => set('label')(e.target.value)} /></Field>
              <Field label="Number format (regular expression)" hint="Leave empty to skip the format check. Example: ^\d{7}$">
                <input className="input font-mono" maxLength={255} value={f.number_regex} onChange={(e) => set('number_regex')(e.target.value)} />
              </Field>
              <Field label="Example shown to applicants"><input className="input" maxLength={80} value={f.number_example} onChange={(e) => set('number_example')(e.target.value)} /></Field>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={f.needs_back} onChange={(e) => set('needs_back')(e.target.checked)} /> Back photo required</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={f.expires} onChange={(e) => set('expires')(e.target.checked)} /> Has an expiry date</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={f.active} onChange={(e) => set('active')(e.target.checked)} /> On (offered to applicants)</label>
            </div>
            <FieldPicker label="Required on the front" value={f.front_fields} fields={d.fields} onChange={set('front_fields')} />
            <FieldPicker label="Required on the back" value={f.back_fields} fields={d.fields} onChange={set('back_fields')} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Words printed on the front" hint="Comma-separated, used to recognise the ID and its side."><input className="input" value={f.front_keywords} onChange={(e) => set('front_keywords')(e.target.value)} /></Field>
              <Field label="Words printed on the back" hint="Comma-separated."><input className="input" value={f.back_keywords} onChange={(e) => set('back_keywords')(e.target.value)} /></Field>
              <Field label="Date formats" hint="Comma-separated, for example YYYY-MM-DD, MMMM DD, YYYY"><input className="input" value={f.date_formats} onChange={(e) => set('date_formats')(e.target.value)} /></Field>
              <Field label="Machine-readable part">
                <div className="flex gap-2">
                  <select className="input" value={f.machine} onChange={(e) => set('machine')(e.target.value)}><option value="none">None</option><option value="qr">QR code</option><option value="mrz">MRZ (passport lines)</option></select>
                  <select className="input" value={f.machine_side} disabled={f.machine === 'none'} onChange={(e) => set('machine_side')(e.target.value)} aria-label="Side"><option value="front">Front</option><option value="back">Back</option></select>
                </div>
              </Field>
              <Field label="Verification" hint="Only an official result gives “Verified – real and valid”.">
                <select className="input" value={f.adapter} onChange={(e) => set('adapter')(e.target.value)}>{d.adapters.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}</select>
              </Field>
            </div>
          </div>
        </Modal>
      )}
    </Card>
  );
}
