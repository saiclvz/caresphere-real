import { Bell, CalendarClock, ClipboardList, GraduationCap, HandHeart, Home, Package, Settings, ShieldCheck, UserCheck, UserCog, Users, UtensilsCrossed } from 'lucide-react';

/**
 * The navigation section each signed-in page belongs to. Shown above the page title (PageHeader) and used for the
 * sidebar headings, so the two always agree. Presentation only: access is decided by the routes and the API.
 */
const SECTIONS = [
  ['/children', 'Children Management'], ['/admissions', 'Children Management'], ['/adoptions', 'Children Management'],
  ['/transitions', 'Children Management'], ['/transition-reviews', 'Children Management'], ['/protected', 'Children Management'],
  ['/inventory', 'Operations'], ['/donations/history', 'Giving'], ['/donations', 'Operations'], ['/donors', 'Operations'], ['/visitors', 'Operations'],
  ['/meals', 'Operations'], ['/schedules', 'Operations'], ['/my-schedule', 'Operations'],
  ['/users', 'Administration'], ['/settings', 'Administration'], ['/audit-log', 'Administration'], ['/data-protection', 'Compliance'],
  ['/notifications', 'Account'],
  ['/adopt', 'Adoption'], ['/applications', 'Adoption'], ['/donate', 'Giving'],
];

export function sectionFor(pathname) {
  const hit = SECTIONS.find(([p]) => pathname === p || pathname.startsWith(`${p}/`));
  return hit ? hit[1] : null;
}

/** The faint decorative icon in a page's header band (aria-hidden): one per module. */
const ICONS = [
  ['/children', Users], ['/admissions', Users], ['/protected', Users], ['/adoptions', Home], ['/adopt', Home], ['/applications', Home],
  ['/transitions', GraduationCap], ['/transition-reviews', GraduationCap], ['/inventory', Package],
  ['/donations', HandHeart], ['/donors', HandHeart], ['/donate', HandHeart], ['/visitors', UserCheck], ['/meals', UtensilsCrossed],
  ['/schedules', CalendarClock], ['/my-schedule', CalendarClock], ['/users', UserCog], ['/settings', Settings],
  ['/audit-log', ClipboardList], ['/data-protection', ShieldCheck], ['/notifications', Bell],
];

export function iconFor(pathname) {
  const hit = ICONS.find(([p]) => pathname === p || pathname.startsWith(`${p}/`));
  return hit ? hit[1] : null;
}
