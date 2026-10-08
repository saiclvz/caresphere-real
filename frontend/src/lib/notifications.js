import { AlertTriangle, Bell, Box, Calendar, FileText, Gift, Shield, ShieldAlert, User, UserCheck, Users, Baby } from 'lucide-react';

/** Icon per category (keys match backend/src/config/notificationEvents.js). */
export const CATEGORY_ICON = {
  action_required: ShieldAlert, warnings: AlertTriangle, applications: FileText, donations: Gift, inventory: Box, children: Baby,
  staff_accounts: Users, security: Shield, assignments: UserCheck, schedule: Calendar, account: User,
};
export const iconFor = (n) => (n.priority === 'action' ? ShieldAlert : n.priority === 'warning' ? AlertTriangle : CATEGORY_ICON[n.category] || Bell);
export const PRIORITY_LABEL = { action: 'Action required', warning: 'Warning', info: 'Info' };

/** "5 min ago", "2 h ago", "3 days ago", then the date. */
export function relativeTime(value) {
  const t = new Date(value).getTime();
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) { const d = Math.floor(s / 86400); return `${d} day${d === 1 ? '' : 's'} ago`; }
  return new Date(value).toLocaleDateString();
}
export const isToday = (value) => new Date(value).toDateString() === new Date().toDateString();
export const badgeText = (n) => (n > 99 ? '99+' : String(n));
