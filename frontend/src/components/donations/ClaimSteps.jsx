import { Check, Circle, CircleSlash, X } from 'lucide-react';

/** Reported → Confirmed by the home → Acknowledged (or "Not matched yet"). */
export default function ClaimSteps({ steps }) {
  if (!steps?.length) return null;
  const look = {
    completed: { Icon: Check, dot: 'bg-brand text-white', text: 'text-navy-900' },
    current: { Icon: Circle, dot: 'border-2 border-brand bg-white text-brand', text: 'font-semibold text-navy-900' },
    blocked: { Icon: X, dot: 'bg-red-600 text-white', text: 'font-semibold text-red-700' },
    skipped: { Icon: CircleSlash, dot: 'bg-slate-200 text-slate-500', text: 'text-slate-500 line-through' },
    pending: { Icon: Circle, dot: 'border border-slate-300 bg-white text-slate-300', text: 'text-slate-500' },
  };
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" aria-label="Progress">
      {steps.map((s, i) => {
        const l = look[s.state] || look.pending;
        return (
          <li key={s.key} className="flex items-center gap-1.5">
            <span className={`flex h-5 w-5 items-center justify-center rounded-full ${l.dot}`}><l.Icon className="h-3 w-3" aria-hidden /></span>
            <span className={l.text}>{s.label}<span className="sr-only"> ({s.state === 'current' ? 'in progress' : s.state})</span></span>
            {i < steps.length - 1 && <span className="mx-1 h-px w-4 bg-slate-300" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}
