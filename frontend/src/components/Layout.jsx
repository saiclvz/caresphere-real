import { useEffect, useState } from 'react';
import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Contact,
  Baby, Boxes, CalendarClock, ChevronDown, ClipboardList, FileHeart, Gift, GraduationCap, HandCoins, HeartHandshake,
  LayoutDashboard, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Receipt, Search, Settings, ShieldCheck, UserCog, Users, UtensilsCrossed, X, FolderHeart,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import NotificationBell from './NotificationBell';
import DisplaySettings from './DisplaySettings';
import Logo, { LogoMark } from './Logo';
import { useApp } from '../context/AppContext';
import { hasDuty, PAGE_DUTY } from '../lib/duties';
import ProtectedContent from './ProtectedContent';
import MonitoringBar from './children/MonitoringBar';
import useApi from '../hooks/useApi';

// Admin and Staff share the Children Management group.
const CHILDREN_GROUP = {
  label: 'Children Management', icon: Baby, match: ['/children', '/admissions', '/adoptions', '/transitions'],
  items: [
    { to: '/children', label: 'Children', icon: Baby },
    { to: '/adoptions', label: 'Adoption', icon: FileHeart },
    { to: '/transitions', label: 'Transition Review (18+)', icon: GraduationCap },
  ],
};

// Admin and Staff: donations are one module; walk-in donations are logged from Visitors.
const DONATIONS_GROUP = {
  label: 'Donations', icon: HandCoins, match: ['/donations', '/donors', '/visitors'],
  items: [
    { to: '/donations', label: 'Donations', icon: HandCoins, end: true },
    { to: '/donors', label: 'Donors', icon: Contact },
    { to: '/visitors', label: 'Visitors', icon: Users },
  ],
};

const NAV = {
  Admin: [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
    CHILDREN_GROUP,
    { to: '/inventory', label: 'Inventory', icon: Boxes, badge: true },
    DONATIONS_GROUP,
    { to: '/meals', label: 'Meals', icon: UtensilsCrossed },
    { to: '/schedules', label: 'Staff schedules', icon: CalendarClock },
    { to: '/users', label: 'User accounts', icon: UserCog },
    { to: '/settings', label: 'Settings', icon: Settings },
    { to: '/audit-log', label: 'Audit log', icon: ClipboardList },
  ],
  Staff: [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
    CHILDREN_GROUP,
    { to: '/inventory', label: 'Inventory', icon: Boxes, badge: true },
    DONATIONS_GROUP,
    { to: '/meals', label: 'Meals', icon: UtensilsCrossed },
    { to: '/my-schedule', label: 'My schedule', icon: CalendarClock },
    // Staff have no Audit log, so their Data protection link opens only that tab of the Audit log page.
    { to: '/data-protection', label: 'Data protection', icon: ShieldCheck },
  ],
  Donor: [
    { to: '/', label: 'Dashboard', icon: HeartHandshake, end: true },
    { to: '/adopt', label: 'Adopt a Child', icon: FolderHeart },
    { to: '/applications', label: 'My applications', icon: FileHeart, badge: 'requests' },
    { to: '/donate', label: 'Donate', icon: Gift },
    { to: '/donations/history', label: 'Donation history', icon: Receipt },
  ],
};

// Role chip: brand tints only (the role is also written out, so colour isn't the only cue).
const ROLE_TONE = {
  Admin: 'bg-navy-900 text-white', Staff: 'bg-brand text-white',
  Donor: 'bg-brand-100 text-navy-900',
};

// Active page: brand blue with a white bar on the left (shape + colour); hover: lighter navy.
const linkClass = (isActive, nested = false) => `group relative flex items-center gap-3 rounded-lg px-3 ${nested ? 'py-2' : 'py-2.5'} text-sm font-medium transition-colors duration-150
  focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300
  ${isActive ? 'bg-brand text-white shadow-sm before:absolute before:-left-3 before:top-1.5 before:bottom-1.5 before:w-1 before:rounded-r before:bg-white' : 'text-slate-200 hover:bg-navy-800 hover:text-white'}`;

function NavItem({ item, nested = false }) {
  const { collapsed: c, mobileOpen, lowStock, openRequests } = useApp();
  const collapsed = c && !mobileOpen; // the mobile menu always shows labels
  const { to, label, icon: Icon, end, badge } = item;
  // badge: true = low-stock count (Inventory), 'requests' = documents requested from a donor.
  const count = badge === 'requests' ? openRequests : badge ? lowStock : 0;
  const tone = badge === 'requests' ? 'bg-blue-400' : 'bg-amber-400';
  const countLabel = badge === 'requests' ? `${count} unread application notification${count === 1 ? '' : 's'}` : `${count} items low on stock`;
  return (
    <NavLink to={to} end={end} title={collapsed ? label : undefined} className={({ isActive }) => linkClass(isActive, nested)}>
      <span className="relative">
        <Icon className={`${nested ? 'h-4 w-4' : 'h-5 w-5'} shrink-0`} aria-hidden />
        {count > 0 && collapsed && <span className={`absolute -right-1.5 -top-1.5 h-2.5 w-2.5 rounded-full ${tone} ring-2 ring-navy-900`} />}
      </span>
      {!collapsed && <span className="flex-1 truncate whitespace-nowrap">{label}</span>}
      {!collapsed && count > 0 && (
        <span className={`rounded-full ${tone} px-2 py-0.5 text-xs font-semibold text-navy-900`} aria-label={countLabel}>
          {count}
        </span>
      )}
    </NavLink>
  );
}

function NavGroup({ group }) {
  const { collapsed: c, mobileOpen } = useApp();
  const collapsed = c && !mobileOpen;
  const location = useLocation();
  const inGroup = group.match.some((p) => location.pathname === p || location.pathname.startsWith(`${p}/`));
  const [open, setOpen] = useState(inGroup);
  useEffect(() => { if (inGroup) setOpen(true); }, [inGroup]);
  const Icon = group.icon;

  if (collapsed) {
    // Icon-only sidebar: show the sub-menu entries directly.
    return <div className="space-y-1 border-y border-white/5 py-1">{group.items.map((i) => <NavItem key={i.to} item={i} nested />)}</div>;
  }
  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors hover:bg-navy-800 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 ${inGroup ? 'bg-navy-800 text-white' : 'text-slate-200'}`}>
        <Icon className={`h-5 w-5 shrink-0 ${inGroup ? 'text-brand-300' : ''}`} aria-hidden />
        <span className="flex-1 truncate whitespace-nowrap text-left">{group.label}</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && <div className="ml-4 mt-1 animate-slide-down space-y-1 border-l border-white/15 pl-2">{group.items.map((i) => <NavItem key={i.to} item={i} nested />)}</div>}
    </div>
  );
}

function Sidebar({ monitoring }) {
  const { user, logout } = useAuth();
  const { collapsed, orgName, mobileOpen, setMobileOpen } = useApp();
  const location = useLocation();
  // Mobile menu: closes on navigation and with Esc.
  useEffect(() => { setMobileOpen(false); }, [location.pathname, setMobileOpen]);
  useEffect(() => {
    if (!mobileOpen) return undefined;
    const onKey = (e) => e.key === 'Escape' && setMobileOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileOpen, setMobileOpen]);
  const showFull = !collapsed || mobileOpen;
  // Staff see only the areas in their duties; a group with nothing left is hidden.
  const allowed = (i) => !PAGE_DUTY[i.to] || hasDuty(user, PAGE_DUTY[i.to]);
  // A monitoring visit (Admin) shows the selected child records only.
  const items = monitoring ? [{ to: '/children', label: 'Children (monitoring visit)', icon: Baby }] : (NAV[user.role] || [])
    .map((i) => (i.items ? { ...i, items: i.items.filter(allowed) } : i))
    .filter((i) => (i.items ? i.items.length > 0 : allowed(i)));

  return (
    <>
      {mobileOpen && <div className="fixed inset-0 z-30 animate-fade bg-navy-950/55 lg:hidden" onClick={() => setMobileOpen(false)} aria-hidden />}
      <aside
        id="cs-sidebar"
        className={`fixed inset-y-0 left-0 z-40 flex flex-col bg-navy-900 text-slate-200 transition-[width,transform] duration-200 ease-out
          ${collapsed ? 'lg:w-[76px]' : 'lg:w-64'} w-72 ${mobileOpen ? 'translate-x-0 shadow-modal' : '-translate-x-full'} lg:translate-x-0`}
      >
        <div className={`flex h-16 items-center gap-3 border-b border-white/10 ${collapsed && !mobileOpen ? 'lg:justify-center lg:px-2' : ''} px-4`}>
          {showFull ? (
            <div className="min-w-0">
              <Logo variant="compact" theme="dark" />
              <p className="mt-1 truncate pl-[48px] text-[11px] text-slate-300">{orgName}</p>
            </div>
          ) : <LogoMark size={40} theme="dark" />}
          <button type="button" className="ml-auto rounded p-1 text-slate-300 hover:bg-white/10 hover:text-white lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close menu">
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4" aria-label="Main">
          {items.map((item) => (item.items ? <NavGroup key={item.label} group={item} /> : <NavItem key={item.to} item={item} />))}
        </nav>

        <div className="border-t border-white/10 p-3">
          <button type="button" onClick={logout} title={!showFull ? 'Logout' : undefined} aria-label={!showFull ? 'Logout' : undefined}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:bg-navy-800 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300">
            <LogOut className="h-5 w-5 shrink-0" aria-hidden />
            {showFull && 'Logout'}
          </button>
        </div>
      </aside>
    </>
  );
}

function Header({ monitoring }) {
  const { user } = useAuth();
  const { search, setSearch, commitSearch, collapsed, setCollapsed, setMobileOpen } = useApp();
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6">
      <button type="button" className="rounded-lg p-2 text-slate-500 hover:bg-brand-50 hover:text-navy-900 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu" aria-controls="cs-sidebar">
        <Menu className="h-5 w-5" />
      </button>
      <LogoMark size={32} className="lg:hidden" />
      <button type="button" className="hidden rounded-lg p-2 text-slate-500 hover:bg-brand-50 hover:text-navy-900 lg:block"
        onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-controls="cs-sidebar" aria-expanded={!collapsed}>
        {collapsed ? <PanelLeftOpen className="h-5 w-5" aria-hidden /> : <PanelLeftClose className="h-5 w-5" aria-hidden />}
      </button>
      <div className="relative max-w-md flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') commitSearch(); if (e.key === 'Escape') setSearch(''); }}
          placeholder="Search this page" aria-label="Search this page"
          className="w-full rounded-lg border border-slate-200 bg-page py-2 pl-9 pr-3 text-sm transition-colors hover:border-slate-300 focus:border-brand focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand/20" />
      </div>
      <div className="ml-auto flex items-center gap-1.5 sm:gap-3">
        <DisplaySettings />
        {!monitoring && <NotificationBell />}
        <span className="hidden text-sm text-slate-600 sm:inline">{user.full_name}</span>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${ROLE_TONE[user.role]}`}>{user.role}</span>
      </div>
    </header>
  );
}

// Page names for the capture log (the guard now covers every page, so the log says which one).
const AREA_BY_PATH = [
  ['/children', 'Child records'], ['/admissions', 'Child records'], ['/adoptions', 'Adoption records'], ['/transitions', 'Transition records'], ['/transition-reviews', 'Transition records'],
  ['/protected', 'Protected records'], ['/donations', 'Donor records'], ['/visitors', 'Visitor records'], ['/users', 'Account records'],
  ['/audit-log', 'Audit log'], ['/data-protection', 'Data protection'], ['/applications', 'Your application'], ['/donate', 'Donation'],
  ['/adopt', 'Children available for adoption'], ['/inventory', 'Inventory'], ['/meals', 'Meals'], ['/my-schedule', 'My schedule'],
  ['/schedules', 'Staff schedules'], ['/notifications', 'Notifications'], ['/settings', 'Settings'],
];
const areaFor = (path) => (AREA_BY_PATH.find(([p]) => path === p || path.startsWith(`${p}/`)) || [null, 'Dashboard'])[1];

export default function Layout() {
  const { collapsed } = useApp();
  const { user } = useAuth();
  const location = useLocation();
  // Admin monitoring visit (NACC, DSWD): read-only, selected records only; the server enforces it.
  const mon = useApi(user.role === 'Admin' ? '/monitoring' : null);
  const monitoring = mon.data?.data || null;
  if (monitoring && !location.pathname.startsWith('/children')) return <Navigate to="/children" replace />;
  return (
    <div className="min-h-screen bg-page">
      <a href="#cs-main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-navy-900 focus:shadow-modal">Skip to main content</a>
      <Sidebar monitoring={monitoring} />
      <div className={`transition-[padding] duration-200 ${collapsed ? 'lg:pl-[76px]' : 'lg:pl-64'}`}>
        <Header monitoring={monitoring} />
        {monitoring && <MonitoringBar monitoring={monitoring} adminName={user.full_name} />}
        <main id="cs-main" tabIndex={-1} className="mx-auto max-w-7xl px-4 py-6 focus:outline-none sm:px-6 lg:py-8">
          {/* Every signed-in page is inside the one protection guard, so Staff and Donors get the same
              screenshot deterrents on every page (Admin is exempt by policy; see ProtectedContent). */}
          <ProtectedContent area={areaFor(location.pathname)}>
            <Outlet />
          </ProtectedContent>
        </main>
      </div>
    </div>
  );
}
