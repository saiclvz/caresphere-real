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
    { to: '/children', label: 'Children', icon: Baby, end: true },
    { to: '/children/intake', label: 'Intake', icon: ClipboardList },
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
    { heading: 'Operations' },
    { to: '/inventory', label: 'Inventory', icon: Boxes, badge: true },
    DONATIONS_GROUP,
    { to: '/meals', label: 'Meals', icon: UtensilsCrossed },
    { to: '/schedules', label: 'Staff schedules', icon: CalendarClock },
    { heading: 'Administration' },
    { to: '/users', label: 'User accounts', icon: UserCog },
    { to: '/settings', label: 'Settings', icon: Settings },
    { to: '/audit-log', label: 'Audit log', icon: ClipboardList },
  ],
  Staff: [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
    CHILDREN_GROUP,
    { heading: 'Operations' },
    { to: '/inventory', label: 'Inventory', icon: Boxes, badge: true },
    DONATIONS_GROUP,
    { to: '/meals', label: 'Meals', icon: UtensilsCrossed },
    { to: '/my-schedule', label: 'My schedule', icon: CalendarClock },
    { heading: 'Compliance' },
    // Staff have no Audit log, so their Data protection link opens only that tab of the Audit log page.
    { to: '/data-protection', label: 'Data protection', icon: ShieldCheck },
  ],
  Donor: [
    { to: '/', label: 'Dashboard', icon: HeartHandshake, end: true },
    { heading: 'Adoption' },
    { to: '/adopt', label: 'Adopt a Child', icon: FolderHeart },
    { to: '/applications', label: 'My applications', icon: FileHeart, badge: 'requests' },
    { heading: 'Giving' },
    { to: '/donate', label: 'Donate', icon: Gift },
    { to: '/donations/history', label: 'Donation history', icon: Receipt },
  ],
};

// Role badge in the header: the role is written out (colour isn't the only cue).
const ROLE_TONE = {
  Admin: 'bg-navy-900 text-white ring-navy-900', Staff: 'bg-brand text-white ring-brand',
  Donor: 'bg-brand-100 text-navy-900 ring-brand-200',
};

// Sidebar colours come from tokens (--cs-sb-*): white by default, navy when chosen in Display settings.
const SB = {
  text: 'text-[rgb(var(--cs-sb-text))]',
  hover: 'hover:bg-[rgb(var(--cs-sb-hover))]',
  muted: 'text-[rgb(var(--cs-sb-muted))]',
  line: 'border-[rgb(var(--cs-sb-line))]',
};
// Active page: blue with white text and a bar on the left (shape + colour).
const linkClass = (isActive, nested = false) => `group relative flex items-center gap-3 rounded-xl px-3 ${nested ? 'py-2' : 'py-2.5'} text-sm font-medium transition-colors duration-150
  focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1
  ${isActive ? 'bg-brand text-white shadow-sm before:absolute before:-left-3 before:top-1.5 before:bottom-1.5 before:w-1 before:rounded-r before:bg-brand' : `${SB.text} ${SB.hover}`}`;

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
        {count > 0 && collapsed && <span className={`absolute -right-1.5 -top-1.5 h-2.5 w-2.5 rounded-full ${tone} ring-2 ring-white`} />}
      </span>
      {/* Collapsed: the label stays for screen readers (and as a tooltip), only the icon shows. */}
      <span className={collapsed ? 'sr-only' : 'flex-1 truncate whitespace-nowrap'}>{label}{collapsed && count > 0 ? ` (${countLabel})` : ''}</span>
      {!collapsed && count > 0 && (
        <span className={`rounded-full ${tone} px-2 py-0.5 text-xs font-semibold text-navy-950`} aria-label={countLabel}>
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
  const listId = `nav-${group.label.replace(/\W+/g, '-').toLowerCase()}`;

  if (collapsed) {
    // Icon-only sidebar: show the sub-menu entries directly (each keeps its name for screen readers).
    return <div role="group" aria-label={group.label} className={`space-y-1 border-y ${SB.line} py-1`}>{group.items.map((i) => <NavItem key={i.to} item={i} nested />)}</div>;
  }
  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={listId}
        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${SB.text} ${SB.hover} focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 ${inGroup ? 'bg-[rgb(var(--cs-sb-group))]' : ''}`}>
        <Icon className="h-5 w-5 shrink-0" aria-hidden />
        <span className="flex-1 truncate whitespace-nowrap text-left">{group.label}</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && <div id={listId} className={`ml-4 mt-1 animate-slide-down space-y-1 border-l ${SB.line} pl-2`}>{group.items.map((i) => <NavItem key={i.to} item={i} nested />)}</div>}
    </div>
  );
}

function Sidebar({ monitoring }) {
  const { user, logout } = useAuth();
  const { collapsed, mobileOpen, setMobileOpen } = useApp();
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
    .filter((i) => (i.heading || (i.items ? i.items.length > 0 : allowed(i))))
    .filter((i, n, all) => !i.heading || (all[n + 1] && !all[n + 1].heading)); // a heading only above something

  return (
    <>
      {mobileOpen && <div className="fixed inset-0 z-40 animate-fade bg-navy-950/55 lg:hidden" onClick={() => setMobileOpen(false)} aria-hidden />}
      <aside
        id="cs-sidebar"
        aria-label="Sidebar"
        className={`fixed bottom-0 left-0 top-0 z-50 flex flex-col border-r ${SB.line} bg-[rgb(var(--cs-sb-bg))] ${SB.text} transition-[width,transform] duration-200 ease-out lg:top-16 lg:z-20
          ${collapsed ? 'lg:w-[76px]' : 'lg:w-[17rem]'} w-72 ${mobileOpen ? 'translate-x-0 shadow-modal' : '-translate-x-full'} lg:translate-x-0`}
      >
        {/* Phones: the drawer has its own logo row and close button (the header sits behind it). */}
        <div className={`flex h-16 items-center gap-3 border-b ${SB.line} px-4 lg:hidden`}>
          <Logo variant="compact" theme="auto" />
          <button type="button" className={`ml-auto rounded-lg p-1.5 ${SB.text} ${SB.hover} focus:outline-none focus-visible:ring-2 focus-visible:ring-brand`} onClick={() => setMobileOpen(false)} aria-label="Close menu">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4" aria-label="Main">
          {items.map((item) => (item.heading
            ? (showFull
              ? <p key={item.heading} className={`px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wider ${SB.muted}`}>{item.heading}</p>
              : <div key={item.heading} className={`mx-2 my-2 border-t ${SB.line}`} aria-hidden />)
            : item.items ? <NavGroup key={item.label} group={item} /> : <NavItem key={item.to} item={item} />))}
        </nav>

        <div className={`border-t ${SB.line} p-3`}>
          <button type="button" onClick={logout} title={!showFull ? 'Logout' : undefined}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${SB.text} ${SB.hover} focus:outline-none focus-visible:ring-2 focus-visible:ring-brand`}>
            <LogOut className="h-5 w-5 shrink-0" aria-hidden />
            <span className={showFull ? '' : 'sr-only'}>Logout</span>
          </button>
        </div>
      </aside>
    </>
  );
}

/** White top bar: menu and logo on the left; page search, display settings, notifications and the signed-in user. */
function Header({ monitoring }) {
  const { user } = useAuth();
  const { search, setSearch, commitSearch, collapsed, setCollapsed, setMobileOpen, orgName } = useApp();
  const home = String(orgName || '').replace(/^CareSphere\s*/i, '').trim() || 'Child Welfare Home';
  return (
    <header className="fixed inset-x-0 top-0 z-30 flex h-16 items-center gap-2 border-b border-brand-200 bg-white px-3 sm:gap-3 sm:px-5">
      <button type="button" className="rounded-xl p-2 text-slate-600 hover:bg-brand-50 hover:text-navy-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu" aria-controls="cs-sidebar">
        <Menu className="h-5 w-5" aria-hidden />
      </button>
      <button type="button" className="hidden rounded-xl p-2 text-slate-600 hover:bg-brand-50 hover:text-navy-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand lg:block"
        onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-controls="cs-sidebar" aria-expanded={!collapsed}>
        {collapsed ? <PanelLeftOpen className="h-5 w-5" aria-hidden /> : <PanelLeftClose className="h-5 w-5" aria-hidden />}
      </button>
      <NavLink to="/" className="flex min-w-0 items-center gap-3 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-brand" aria-label="CareSphere home">
        <span className="hidden sm:block"><Logo variant="compact" theme="auto" /></span>
        <LogoMark size={34} theme="auto" decorative className="sm:hidden" />
        <span className="hidden min-w-0 border-l border-brand-200 pl-3 text-sm font-medium text-slate-600 xl:block"><span className="block truncate">{home}</span></span>
      </NavLink>
      <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-2">
        <div className="relative hidden w-48 md:block lg:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden />
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commitSearch(); if (e.key === 'Escape') setSearch(''); }}
            placeholder="Search this page" aria-label="Search this page"
            className="w-full rounded-xl border border-slate-300 bg-page py-2 pl-9 pr-3 text-sm text-navy-900 placeholder:text-slate-500 transition-colors hover:border-slate-400 focus:border-brand focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand/25" />
        </div>
        <DisplaySettings sidebarOption />
        {!monitoring && <NotificationBell />}
        <div className="ml-1 flex min-w-0 items-center gap-2 border-l border-brand-200 pl-2 sm:pl-3" role="group" aria-label={`Signed in as ${user.full_name}, ${user.role}`}>
          <span className="hidden max-w-[11rem] truncate text-sm font-medium text-navy-900 md:block">{user.full_name}</span>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${ROLE_TONE[user.role]}`}>{user.role}</span>
        </div>
      </div>
    </header>
  );
}

/** Page search on phones (the header has no room for it): same search state, shown above the page. */
function MobileSearch() {
  const { search, setSearch, commitSearch } = useApp();
  return (
    <div className="relative mb-4 md:hidden">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden />
      <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') commitSearch(); if (e.key === 'Escape') setSearch(''); }}
        placeholder="Search this page" aria-label="Search this page"
        className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-sm text-navy-900 placeholder:text-slate-500 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25" />
    </div>
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
// eslint-disable-next-line no-undef
const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '';
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
      <Header monitoring={monitoring} />
      <div className={`pt-16 transition-[padding] duration-200 ${collapsed ? 'lg:pl-[76px]' : 'lg:pl-[17rem]'}`}>
        {monitoring && <MonitoringBar monitoring={monitoring} adminName={user.full_name} />}
        <main id="cs-main" tabIndex={-1} className="mx-auto w-full max-w-[1300px] px-4 py-6 focus:outline-none sm:px-6 lg:py-8">
          <MobileSearch />
          {/* Every signed-in page is inside the one protection guard, so Staff and Donors get the same
              screenshot deterrents on every page (Admin is exempt by policy; see ProtectedContent). */}
          <ProtectedContent area={areaFor(location.pathname)}>
            <Outlet />
          </ProtectedContent>
          {/* The app version from frontend/package.json (set at build time in vite.config.js). */}
          {APP_VERSION && <p className="mt-10 text-center text-xs text-slate-500">CareSphere version {APP_VERSION}</p>}
        </main>
      </div>
    </div>
  );
}
