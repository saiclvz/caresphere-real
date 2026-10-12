import { Plus, X } from 'lucide-react';
import { Button } from '../ui';
import { formatMoney } from '../../lib/format';

export const blankAllocation = (program = '') => ({ program, amount: '', intended_use: '' });

/**
 * Allocation lines. Cash: program + amount, adding up to the donation amount. In-kind: program + intended use.
 * "Other" always needs a description. Errors come from the server as allocation / allocation_N.
 */
export default function AllocationEditor({ lines, onChange, inKind, amount, programs, errors = {}, idPrefix = 'alloc' }) {
  const set = (i, patch) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const sum = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const left = Math.round(((Number(amount) || 0) - sum) * 100) / 100;
  return (
    <fieldset className="space-y-2" data-field="allocation">
      <legend className="text-sm font-medium text-navy-800">Allocation<span className="ml-0.5 text-red-600" aria-hidden="true">*</span></legend>
      <p className="text-xs text-slate-500">{inKind ? 'What the items will be used for.' : 'How the amount is split between programs. The lines must add up to the amount.'} Required before the donation can be accepted.</p>
      {lines.map((l, i) => (
        <div key={i} className="flex flex-wrap items-start gap-2" data-field={`allocation_${i}`}>
          <label className="sr-only" htmlFor={`${idPrefix}-p-${i}`}>Program {i + 1}</label>
          <select id={`${idPrefix}-p-${i}`} className="input w-44" value={l.program} onChange={(e) => set(i, { program: e.target.value })} aria-invalid={errors[`allocation_${i}`] ? 'true' : undefined}>
            <option value="">Program...</option>{programs.map((p) => <option key={p}>{p}</option>)}
          </select>
          {!inKind && (
            <>
              <label className="sr-only" htmlFor={`${idPrefix}-a-${i}`}>Amount for line {i + 1}</label>
              <input id={`${idPrefix}-a-${i}`} className="input w-32" type="number" min="0.01" step="0.01" placeholder="Amount" value={l.amount} onChange={(e) => set(i, { amount: e.target.value })} />
            </>
          )}
          {(inKind || l.program === 'Other') && (
            <>
              <label className="sr-only" htmlFor={`${idPrefix}-u-${i}`}>Intended use for line {i + 1}</label>
              <input id={`${idPrefix}-u-${i}`} className="input min-w-[10rem] flex-1" maxLength={500} placeholder={l.program === 'Other' ? 'Describe the use' : 'Intended use, e.g. kitchen stock'} value={l.intended_use} onChange={(e) => set(i, { intended_use: e.target.value })} />
            </>
          )}
          {lines.length > 1 && <Button size="sm" variant="ghost" onClick={() => onChange(lines.filter((_, j) => j !== i))} aria-label={`Remove allocation line ${i + 1}`}><X className="h-4 w-4" aria-hidden /></Button>}
          {errors[`allocation_${i}`] && <p className="w-full text-xs text-red-600">{errors[`allocation_${i}`]}</p>}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="secondary" onClick={() => onChange([...lines, blankAllocation()])}><Plus className="h-4 w-4" aria-hidden /> Add line</Button>
        {!inKind && Number(amount) > 0 && <span className={`text-xs ${Math.abs(left) < 0.005 ? 'text-emerald-700' : 'text-amber-700'}`}>{Math.abs(left) < 0.005 ? 'Adds up to the amount.' : `${formatMoney(Math.abs(left))} ${left > 0 ? 'still to allocate' : 'over the amount'}`}</span>}
      </div>
      {errors.allocation && <p className="text-xs text-red-600" role="alert">{errors.allocation}</p>}
    </fieldset>
  );
}

/** Lines as the API expects them. */
export const allocationBody = (lines, inKind) => lines.filter((l) => l.program || l.amount || l.intended_use).map((l) => ({
  program: l.program, amount: inKind ? undefined : (l.amount === '' ? undefined : Number(l.amount)), intended_use: l.intended_use?.trim() || undefined,
}));
