import { Link } from 'react-router-dom';
import { ShieldOff } from 'lucide-react';

/** Generic "no access" page. It never says whether the record exists. */
export default function NoAccess() {
  return (
    <div className="mx-auto mt-10 max-w-md rounded-2xl bg-white p-8 text-center shadow-card">
      <ShieldOff className="mx-auto h-10 w-10 text-slate-400" aria-hidden />
      <h1 className="mt-3 text-xl font-semibold text-navy-900">You don't have access</h1>
      <p className="mt-2 text-sm text-slate-600">This link is for authorized staff of the home.</p>
      <Link to="/" className="mt-5 inline-flex h-11 items-center justify-center rounded-lg bg-brand px-5 text-sm font-medium text-white">Go to dashboard</Link>
    </div>
  );
}
