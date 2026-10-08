import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { DUTY_LABELS, hasDuty } from '../lib/duties';
import { Card } from './ui';

/** Shows the page only if the signed-in Staff member has this duty (the server checks it too). */
export default function RequireDuty({ duty, children }) {
  const { user } = useAuth();
  if (hasDuty(user, duty)) return children;
  return (
    <Card className="mx-auto mt-8 max-w-lg p-6 text-center">
      <ShieldAlert className="mx-auto h-8 w-8 text-red-600" aria-hidden />
      <h1 className="mt-2 font-semibold text-navy-900">ACCESS DENIED – You are not authorized to view this information.</h1>
      <p className="mt-1 text-sm text-slate-600">{DUTY_LABELS[duty] || duty} is not one of your duties. Ask an administrator if you need it.</p>
      <Link to="/" className="mt-4 inline-block text-sm font-medium text-brand hover:underline">Back to the dashboard</Link>
    </Card>
  );
}
