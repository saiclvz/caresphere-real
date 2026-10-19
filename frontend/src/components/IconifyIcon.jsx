import { FileCheck, ShieldCheck, UsersRound } from 'lucide-react';

/**
 * An Iconify "lucide:*" icon, bundled with the app (no CDN script). Iconify's lucide set is the Lucide icon set, the
 * same artwork as lucide-react, so the icon is drawn from the app's own bundle: it works on a local network without
 * internet and no third-party script runs on the page. Add an entry to LOCAL when a new lucide:* name is used.
 */
const LOCAL = {
  'lucide:shield-check': ShieldCheck,
  'lucide:users-round': UsersRound,
  'lucide:file-check': FileCheck,
};

export default function IconifyIcon({ icon, fallback, size = 24, className = '' }) {
  const Icon = LOCAL[icon] || fallback;
  if (!Icon) return null;
  return <Icon className={className} style={{ width: size, height: size }} aria-hidden strokeWidth={2} />;
}
