import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Baby, Boxes, CalendarClock, ChevronDown, ClipboardList, FileHeart, Gift, GraduationCap, HandCoins, HeartHandshake,
  LayoutDashboard, LogOut, Menu, Receipt, Search, Settings, ShieldCheck, UserCog, Users, UtensilsCrossed, X, FolderHeart,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';

// Admin and Staff share the Children Management group.
const CHILDREN_GROUP = {
  label: 'Children Management', icon: Baby, match: ['/children', '/adoptions', '/transitions'],
  items: [
    { to: '/children', label: 'Children', icon: Baby },
    { to: '/adoptions', label: 'Adoption', icon: FileHeart },
    { to: '/transitions', label: 'Transition Review (18+)', icon: GraduationCap },
  ],
};

const NAV = {
  Admin: [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
    CHILDREN_GROUP,
    { to: '/inventory', label: 'Inventory', icon: Boxes, badge: true },
    { to: '/donations', label: 'Donations', icon: HandCoins },
    { to: '/visitors', label: 'Visitors', icon: Users },
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
    { to: '/donations', label: 'Donations', icon: HandCoins },
    { to: '/visitors', label: 'Visitors', icon: Users },
    { to: '/meals', label: 'Meals', icon: UtensilsCrossed },
    { to: '/my-schedule', label: 'My schedule', icon: CalendarClock },
  ],
  Donor: [
    { to: '/', label: 'Dashboard', icon: HeartHandshake, end: true },
    { to: '/adopt', label: 'Adopt a Child', icon: FolderHeart },
    { to: '/applications', label: 'My applications', icon: FileHeart },
    { to: '/donate', label: 'Donate', icon: Gift },
    { to: '/donations/history', label: 'Donation history', icon: Receipt },
  ],
};

const ROLE_TONE = {
  Admin: 'bg-brand text-white', Staff: 'bg-emerald-600 text-white',
  Donor: 'bg-amber-500 text-navy-900',
};

const linkClass = (isActive, nested = false) => `group flex items-center gap-3 rounded-lg px-3 ${nested ? 'py-2' : 'py-2.5'} text-sm font-medium transition-colors
  ${isActive ? 'bg-brand text-white' : 'hover:bg-navy-800 hover:text-white'}`;

function NavItem({ item, nested = false }) {
  const { collapsed, lowStock } = useApp();
  const { to, label, icon: Icon, end, badge } = item;
  return (
    <NavLink to={to} end={end} title={collapsed ? label : undefined} className={({ isActive }) => linkClass(isActive, nested)}>
      <span className="relative">
        <Icon className={`${nested ? 'h-4 w-4' : 'h-5 w-5'} shrink-0`} aria-hidden />
        {badge && lowStock > 0 && collapsed && <span className="absolute -right-1.5 -top-1.5 h-2.5 w-2.5 rounded-full bg-amber-400 ring-2 ring-navy-900" />}
      </span>
      {!collapsed && <span className="flex-1">{label}</span>}
      {!collapsed && badge && lowStock > 0 && (
        <span className="rounded-full bg-amber-400 px-2 py-0.5 text-xs font-semibold text-navy-900" aria-label={`${lowStock} items low on stock`}>
          {lowStock}
        </span>
      )}
    </NavLink>
  );
}

function NavGroup({ group }) {
  const { collapsed } = useApp();
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
        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors hover:bg-navy-800 hover:text-white ${inGroup ? 'text-white' : ''}`}>
        <Icon className="h-5 w-5 shrink-0" aria-hidden />
        <span className="flex-1 text-left">{group.label}</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && <div className="ml-4 mt-1 space-y-1 border-l border-white/10 pl-2">{group.items.map((i) => <NavItem key={i.to} item={i} nested />)}</div>}
    </div>
  );
}

function Sidebar() {
  const { user, logout } = useAuth();
  const { collapsed, orgName, mobileOpen, setMobileOpen } = useApp();
  const items = NAV[user.role] || [];

  return (
    <>
      {mobileOpen && <div className="fixed inset-0 z-30 bg-navy-900/50 lg:hidden" onClick={() => setMobileOpen(false)} aria-hidden />}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex flex-col bg-navy-900 text-slate-300 transition-[width,transform] duration-200
          ${collapsed ? 'lg:w-[72px]' : 'lg:w-64'} w-64 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0`}
      >
        <div className="flex h-16 items-center gap-3 border-b border-white/5 px-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-navy-800">
            <ShieldCheck className="h-5 w-5 text-brand" aria-hidden />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="font-semibold text-white">CareSphere</p>
              <p className="truncate text-xs text-slate-400">{orgName}</p>
            </div>
          )}
          <button type="button" className="ml-auto rounded p-1 text-slate-400 hover:text-white lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close menu">
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4" aria-label="Main">
          {items.map((item) => (item.items ? <NavGroup key={item.label} group={item} /> : <NavItem key={item.to} item={item} />))}
        </nav>

        <div className="border-t border-white/5 p-3">
          <button type="button" onClick={logout} title={collapsed ? 'Logout' : undefined}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium hover:bg-navy-800 hover:text-white">
            <LogOut className="h-5 w-5 shrink-0" aria-hidden />
            {!collapsed && 'Logout'}
          </button>
        </div>
      </aside>
    </>
  );
}

function Header() {
  const { user } = useAuth();
  const { search, setSearch, commitSearch, collapsed, setCollapsed, setMobileOpen } = useApp();
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6">
      <button type="button" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-navy-900 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
        <Menu className="h-5 w-5" />
      </button>
      <button type="button" className="hidden rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-navy-900 lg:block"
        onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-pressed={collapsed}>
        <Menu className="h-5 w-5" />
      </button>
      <div className="relative max-w-md flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') commitSearch(); if (e.key === 'Escape') setSearch(''); }}
          placeholder="Search this page" aria-label="Search this page"
          className="w-full rounded-lg border border-slate-200 bg-page py-2 pl-9 pr-3 text-sm focus:border-brand focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand/20" />
      </div>
      <div className="ml-auto flex items-center gap-3">
        <span className="hidden text-sm text-slate-600 sm:inline">{user.full_name}</span>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${ROLE_TONE[user.role]}`}>{user.role}</span>
      </div>
    </header>
  );
}

export default function Layout() {
  const { collapsed } = useApp();
  return (
    <div className="min-h-screen bg-page">
      <Sidebar />
      <div className={`transition-[padding] duration-200 ${collapsed ? 'lg:pl-[72px]' : 'lg:pl-64'}`}>
        <Header />
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
