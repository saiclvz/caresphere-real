import { Link } from 'react-router-dom';
import { Card } from '../components/ui';

export default function NotFound() {
  return (
    <Card className="mx-auto max-w-md p-8 text-center">
      <p className="font-semibold text-navy-900">This page doesn't exist</p>
      <p className="mt-1 text-sm text-slate-500">Check the address or go back to your dashboard.</p>
      <Link to="/" className="mt-4 inline-block text-sm font-medium text-brand hover:underline">Go to dashboard</Link>
    </Card>
  );
}
