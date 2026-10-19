import { useId, useRef, useState } from 'react';
import { CheckCircle2, FileText, Plus, Trash2, Upload, X } from 'lucide-react';
import { formatBytes, isRequired } from './formLogic';

/** Label + control + hint/error, wired with ids for screen readers. */
export function FieldShell({ id, label, required, hint, error, children }) {
  return (
    <div>
      <label htmlFor={id} className="cs-label">{label}{required && <span className="cs-req" aria-hidden="true">*</span>}</label>
      {children}
      {error ? <p id={`${id}-error`} className="cs-error" role="alert">{error}</p> : hint ? <p id={`${id}-hint`} className="cs-hint">{hint}</p> : null}
    </div>
  );
}

export function StatusChip({ status }) {
  const cls = { Done: 'cs-chip-done', Missing: 'cs-chip-missing', Optional: 'cs-chip-optional' }[status] || 'cs-chip-info';
  return <span className={`cs-chip ${cls}`}>{status}</span>;
}

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Household members: name, age, relationship. Rows can be added and removed. */
function HouseholdEditor({ id, value, onChange, error }) {
  const rows = Array.isArray(value) ? value : [];
  const set = (i, patch) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-2" id={id}>
      {rows.length === 0 && <p className="cs-hint">No household members added. Add everyone who lives with you.</p>}
      {rows.map((r, i) => (
        <div key={i} className="cs-card cs-surface-2 grid gap-2 p-3 sm:grid-cols-[1fr_6rem_1fr_auto] sm:items-end">
          <div>
            <label className="cs-label" htmlFor={`${id}-${i}-name`}>Name<span className="cs-req" aria-hidden="true">*</span></label>
            <input id={`${id}-${i}-name`} className="cs-input" maxLength={150} value={r.full_name} onChange={(e) => set(i, { full_name: e.target.value })} />
          </div>
          <div>
            <label className="cs-label" htmlFor={`${id}-${i}-age`}>Age<span className="cs-req" aria-hidden="true">*</span></label>
            <input id={`${id}-${i}-age`} className="cs-input" inputMode="numeric" maxLength={3} value={r.age} onChange={(e) => set(i, { age: e.target.value.replace(/\D/g, '') })} />
          </div>
          <div>
            <label className="cs-label" htmlFor={`${id}-${i}-rel`}>Relationship to you<span className="cs-req" aria-hidden="true">*</span></label>
            <input id={`${id}-${i}-rel`} className="cs-input" maxLength={60} value={r.relationship} onChange={(e) => set(i, { relationship: e.target.value })} />
          </div>
          <button type="button" className="cs-btn cs-btn-sm cs-btn-danger" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label={`Remove household member ${i + 1}`}>
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ))}
      {error && <p className="cs-error" role="alert">{error}</p>}
      {rows.length < 20 && (
        <button type="button" className="cs-btn cs-btn-sm" onClick={() => onChange([...rows, { full_name: '', age: '', relationship: '' }])}>
          <Plus className="h-4 w-4" aria-hidden /> Add household member
        </button>
      )}
    </div>
  );
}

const CLEARANCE_KINDS = ['NBI clearance', 'Police clearance', 'Court clearance'];

/** Clearances: whose, which kind, the reference number and the date issued. No screenshot is needed. */
function ClearancesEditor({ id, value, onChange, error }) {
  const rows = Array.isArray(value) ? value : [];
  const set = (i, patch) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-2" id={id}>
      {rows.length === 0 && <p className="cs-hint">No clearance added yet.</p>}
      {rows.map((r, i) => (
        <div key={i} className="cs-card cs-surface-2 grid gap-2 p-3 sm:grid-cols-[1.2fr_1fr_1fr_1fr_auto] sm:items-end">
          <div><label className="cs-label" htmlFor={`${id}-${i}-holder`}>Whose clearance<span className="cs-req" aria-hidden="true">*</span></label>
            <input id={`${id}-${i}-holder`} className="cs-input" maxLength={150} value={r.holder || ''} placeholder="Full name" onChange={(e) => set(i, { holder: e.target.value })} /></div>
          <div><label className="cs-label" htmlFor={`${id}-${i}-kind`}>Kind<span className="cs-req" aria-hidden="true">*</span></label>
            <select id={`${id}-${i}-kind`} className="cs-input" value={r.kind || ''} onChange={(e) => set(i, { kind: e.target.value })}>
              <option value="">Select...</option>{CLEARANCE_KINDS.map((k) => <option key={k}>{k}</option>)}</select></div>
          <div><label className="cs-label" htmlFor={`${id}-${i}-number`}>Reference number<span className="cs-req" aria-hidden="true">*</span></label>
            <input id={`${id}-${i}-number`} className="cs-input" maxLength={50} value={r.number || ''} onChange={(e) => set(i, { number: e.target.value.toUpperCase() })} /></div>
          <div><label className="cs-label" htmlFor={`${id}-${i}-date`}>Date issued<span className="cs-req" aria-hidden="true">*</span></label>
            <input id={`${id}-${i}-date`} type="date" className="cs-input" max={todayIso()} value={r.issue_date || ''} onChange={(e) => set(i, { issue_date: e.target.value })} /></div>
          <button type="button" className="cs-btn cs-btn-sm cs-btn-danger" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label={`Remove clearance ${i + 1}`}>
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ))}
      {error && <p className="cs-error" role="alert">{error}</p>}
      {rows.length < 6 && (
        <button type="button" className="cs-btn cs-btn-sm" onClick={() => onChange([...rows, { holder: '', kind: '', number: '', issue_date: '' }])}>
          <Plus className="h-4 w-4" aria-hidden /> Add clearance
        </button>
      )}
    </div>
  );
}

/**
 * One form field from the config. `form` holds all answers (conditions and the
 * province/city pair need them). Changing the province clears the city.
 */
export function FormField({ name, def, form, onChange, error, config }) {
  const id = `f-${name}`;
  const value = form[name] ?? '';
  const req = isRequired(def, form);
  const label = !req && def.optionalLabel ? def.optionalLabel : def.label;
  const describedBy = error ? `${id}-error` : undefined;
  const common = { id, className: 'cs-input', 'aria-invalid': error ? 'true' : undefined, 'aria-describedby': describedBy, 'aria-required': req || undefined };
  const set = (v) => onChange({ [name]: v });

  if (def.type === 'household') {
    return <FieldShell id={id} label={label} required={req} hint="Names, ages and relationship to you."><HouseholdEditor id={id} value={value} onChange={set} error={error} /></FieldShell>;
  }
  if (def.type === 'clearances') {
    return <FieldShell id={id} label={label} required={req} hint="Issued within the last 12 months. One for you, and one for your spouse if you are married."><ClearancesEditor id={id} value={value} onChange={set} error={error} /></FieldShell>;
  }

  let control;
  switch (def.type) {
    case 'textarea':
      control = <textarea {...common} rows={4} maxLength={def.max} value={value} onChange={(e) => set(e.target.value)} />;
      break;
    case 'select':
      control = (
        <select {...common} value={value} onChange={(e) => set(e.target.value)}>
          <option value="">Select...</option>
          {def.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
      break;
    case 'province':
      control = (
        <select {...common} value={value} onChange={(e) => onChange({ province: e.target.value, city: '', city_other: '' })}>
          <option value="">Select...</option>
          {config.address.provinces.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      );
      break;
    case 'city': {
      const list = config.address.city_lists[form.province];
      if (!form.province) {
        control = <select {...common} disabled value=""><option value="">Select a province first</option></select>;
      } else if (list) {
        control = (
          <div className="space-y-2">
            <select {...common} value={value} onChange={(e) => onChange({ city: e.target.value, ...(e.target.value !== config.address.other_city ? { city_other: '' } : {}) })}>
              <option value="">Select...</option>
              {list.map((c) => <option key={c} value={c}>{c}</option>)}
              <option value={config.address.other_city}>Other (type it in)</option>
            </select>
            {value === config.address.other_city && (
              <>
                <label htmlFor={`${id}-other`} className="cs-label">Municipality / city name<span className="cs-req" aria-hidden="true">*</span></label>
                <input id={`${id}-other`} className="cs-input" maxLength={100} value={form.city_other || ''} aria-required="true"
                  aria-invalid={error ? 'true' : undefined} onChange={(e) => onChange({ city_other: e.target.value })} />
              </>
            )}
          </div>
        );
      } else {
        control = <input {...common} type="text" maxLength={def.max} value={value} onChange={(e) => set(e.target.value)} />;
      }
      break;
    }
    case 'date':
      control = <input {...common} type="date" {...(def.future ? { min: todayIso() } : { max: todayIso() })} value={value} onChange={(e) => set(e.target.value)} />;
      break;
    case 'idnumber':
      control = <input {...common} type="text" autoComplete="off" spellCheck={false} maxLength={def.max} value={value} onChange={(e) => set(e.target.value.toUpperCase())} />;
      break;
    case 'zip':
      control = <input {...common} inputMode="numeric" maxLength={4} placeholder="0000" value={value} onChange={(e) => set(e.target.value.replace(/\D/g, '').slice(0, 4))} />;
      break;
    case 'phone':
      control = <input {...common} type="tel" inputMode="tel" maxLength={16} placeholder={def.placeholder} value={value} onChange={(e) => set(e.target.value)} />;
      break;
    case 'email':
      control = <input {...common} type="email" autoComplete="email" maxLength={def.max} value={value} onChange={(e) => set(e.target.value)} />;
      break;
    default:
      control = <input {...common} type="text" maxLength={def.max} placeholder={def.placeholder} value={value} onChange={(e) => set(e.target.value)} />;
  }
  return <FieldShell id={id} label={label} required={req} error={error}>{control}</FieldShell>;
}

/**
 * Upload field for one document type. "No file chosen" until a file is uploaded, then the
 * file name(s) in a green state with Replace (single file) or Add another (multiple).
 */
export function DocumentField({ docType, def, files, required, rules, onUpload, onRemove, canRemove = true, disabled = false, requiredError = null }) {
  const inputRef = useRef(null);
  const id = useId();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState('');
  const has = files.length > 0;
  const needsDate = Boolean(def.validity_months);

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!rules.types.includes(file.type)) { setError('Only PDF, PNG or JPG files are accepted.'); return; }
    if (file.size > rules.maxBytes) { setError(`The file is larger than ${Math.round(rules.maxBytes / (1024 * 1024))} MB.`); return; }
    if (file.size === 0) { setError('The file is empty.'); return; }
    if (needsDate && !issued) { setError(`Enter the ${def.issued_label.toLowerCase()} first.`); return; }
    setError(null); setBusy(true);
    try { await onUpload(docType, file, issued || undefined); setIssued(''); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const buttonLabel = busy ? 'Uploading...' : !has ? 'Choose file' : def.multiple ? 'Add another file' : 'Replace';

  return (
    <div className={`cs-file ${has ? 'has-file' : ''} ${requiredError && !has ? 'cs-file-error' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p id={`${id}-label`} className="cs-title text-sm">{def.label}{required && <span className="cs-req" aria-hidden="true">*</span>}{!required && <span className="cs-muted font-normal"> (optional)</span>}</p>
          <p className="cs-hint">{def.hint ? `${def.hint} ` : ''}{needsDate ? `Must be from the last ${def.validity_months} months. ` : ''}PDF, PNG or JPG, up to {Math.round(rules.maxBytes / (1024 * 1024))} MB{def.multiple ? ' each. You can add more than one file.' : '.'}</p>
          {needsDate && (
            <label className="mt-1 flex flex-wrap items-center gap-2 text-sm">
              <span>{def.issued_label}<span className="cs-req" aria-hidden="true">*</span></span>
              <input type="date" className="cs-input" style={{ width: 'auto', minHeight: '2rem' }} value={issued} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setIssued(e.target.value)} />
            </label>
          )}
        </div>
        <button type="button" id={`f-doc:${docType}`} className="cs-btn cs-btn-sm" onClick={() => inputRef.current?.click()} disabled={busy || disabled}
          aria-describedby={`${id}-label${requiredError && !has ? ` ${id}-req` : ''}`} aria-invalid={requiredError && !has ? true : undefined}>
          <Upload className="h-4 w-4" aria-hidden /> {buttonLabel}
        </button>
        <input ref={inputRef} type="file" className="sr-only" tabIndex={-1} aria-hidden="true" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" onChange={pick} />
      </div>
      {has ? (
        <ul className="mt-2 space-y-1">
          {files.map((f) => (
            <li key={f.document_id} className="flex items-center gap-2 text-sm" style={{ color: 'var(--ad-success)' }}>
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
              <FileText className="h-4 w-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--ad-text)' }}>{f.original_name}</span>
              <span className="cs-muted shrink-0 text-xs">{formatBytes(f.size_bytes)}</span>
              {f.verification_status && <span className="cs-chip shrink-0 text-xs" title={f.review_note || undefined}>{f.verification_status}</span>}
              {canRemove && (
                <button type="button" className="cs-btn cs-btn-sm cs-btn-danger" onClick={() => onRemove(f)} aria-label={`Remove ${f.original_name}`}>
                  <X className="h-4 w-4" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : <p className="cs-muted mt-2 text-sm">No file chosen</p>}
      {error && <p className="cs-error" role="alert">{error}</p>}
      {requiredError && !has && !error && <p id={`${id}-req`} className="cs-error">{requiredError}</p>}
    </div>
  );
}
