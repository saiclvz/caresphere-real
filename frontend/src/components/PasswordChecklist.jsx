import { Check, X } from 'lucide-react';
import { checks } from '../lib/passwordPolicy';

/** Live checklist under a password field: each rule ticks off as the user types. */
export default function PasswordChecklist({ password, email, name, id }) {
  const items = checks(password, { email, name });
  return (
    <ul id={id} className="mt-2 grid gap-1 text-xs sm:grid-cols-2" aria-label="Password requirements">
      {items.map((c) => (
        <li key={c.key} className={`flex items-center gap-1.5 ${c.ok ? 'text-emerald-700' : 'text-slate-500'}`}>
          {c.ok ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <X className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />}
          <span>{c.label}<span className="sr-only">{c.ok ? ': met' : ': not met'}</span></span>
        </li>
      ))}
    </ul>
  );
}
