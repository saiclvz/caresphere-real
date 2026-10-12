import { Link } from 'react-router-dom';
import { ShieldOff } from 'lucide-react';

/** Generic "no access" page. It never says whether the record exists. */
export default function NoAccess() {
  return (
    <div className="mx-auto mt-10 max-w-md animate-pop rounded-2xl border border-slate-200/70 bg-white p-8 text-center shadow-card" role="alert">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-50"><ShieldOff className="h-7 w-7 text-red-700" aria-hidden /></span>
      <h1 className="mt-3 text-xl font-semibold text-navy-900">Access denied</h1>
      <p className="mt-2 text-sm text-slate-600">Access denied – You are not authorized to view this information.</p>
      <Link to="/" className="mt-5 inline-flex h-11 items-center justify-center rounded-lg bg-brand px-5 text-sm font-medium text-white transition-colors hover:bg-brand-dark">Go to dashboard</Link>
    </div>
  );
}
