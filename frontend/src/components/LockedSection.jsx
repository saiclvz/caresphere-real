import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { Button, Card } from './ui';

/**
 * Placeholder for an Adoption or Transition Review section shown outside those areas (for example on
 * the child page). The data isn't sent until the area's undertaking is accepted; the button opens the
 * area, where the undertaking appears first.
 */
export default function LockedSection({ title, area, to, note }) {
  const label = area === 'transition' ? 'Open in Transition Review' : 'Open in Adoption';
  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 font-semibold text-navy-900"><Lock className="h-4 w-4 text-amber-700" aria-hidden /> {title}</h2>
      <p className="mt-1 text-sm text-slate-600">{note || `Locked. Open ${area === 'transition' ? 'Transition Review' : 'Adoption'} first to accept the confidentiality undertaking for this session.`}</p>
      <Link to={to} className="mt-3 inline-block"><Button size="sm" variant="secondary">{label}</Button></Link>
    </Card>
  );
}
