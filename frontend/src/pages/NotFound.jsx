import { Link } from 'react-router-dom';
import { SearchX } from 'lucide-react';
import { Card } from '../components/ui';

/** Unknown address inside the app (the routes are unchanged; this only styles the message). */
export default function NotFound() {
  return (
    <Card className="mx-auto mt-10 max-w-md p-8 text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-100"><SearchX className="h-7 w-7 text-brand" aria-hidden /></span>
      <h1 className="mt-3 text-xl font-semibold text-navy-900">This page doesn't exist</h1>
      <p className="mt-1 text-sm text-slate-600">Check the address or go back to your dashboard.</p>
      <Link to="/" className="mt-5 inline-flex min-h-[2.75rem] items-center justify-center rounded-xl bg-brand px-5 text-sm font-medium text-white transition-colors hover:bg-brand-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2">Go to dashboard</Link>
    </Card>
  );
}
