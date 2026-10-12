import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { api } from '../api/client';
import { hasDuty } from '../lib/duties';
import { useAuth } from './AuthContext';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const { user } = useAuth();
  const location = useLocation();
  // `search` is what the user is typing; `query` is what pages filter by.
  // query follows search after 300 ms, immediately on Enter, and immediately when cleared.
  const [search, setSearchRaw] = useState('');
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [lowStock, setLowStock] = useState(0);
  // Unread notifications: total (bell badge) and per chip. Donors' "My applications" count = the Applications chip.
  const [notifCounts, setNotifCounts] = useState({ all: 0 });
  const openRequests = notifCounts.applications || 0;
  const [orgName, setOrgName] = useState('CareSphere');
  const [toasts, setToasts] = useState([]);
  const toastId = useRef(0);

  const setSearch = useCallback((value) => {
    setSearchRaw(value);
    if (!String(value).trim()) setQuery(''); // clearing restores the full list at once
  }, []);
  const commitSearch = useCallback(() => setQuery(search.trim()), [search]);

  useEffect(() => {
    const id = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  // Search is page-scoped: clear it when navigating.
  useEffect(() => { setSearchRaw(''); setQuery(''); setMobileOpen(false); }, [location.pathname]);

  const refreshLowStock = useCallback(async () => {
    if (!user || !['Admin', 'Staff'].includes(user.role) || !hasDuty(user, 'inventory')) return;
    try {
      // X-Background: polling must not count as activity for the idle-session timeout.
      const res = await api('/inventory/low-stock-count', { headers: { 'X-Background': '1' } });
      setLowStock(res.count);
    } catch { /* badge is non-critical */ }
  }, [user]);

  const refreshRequests = useCallback(async () => {
    if (!user) return;
    try {
      const res = await api('/notifications/unread-count', { headers: { 'X-Background': '1' } });
      setNotifCounts(res.data.counts || { all: res.data.unread });
    } catch { /* badge is non-critical */ }
  }, [user]);
  // Every 30 seconds while the tab is visible; paused when hidden, refreshed when it becomes visible again.
  useEffect(() => {
    if (!user) return undefined;
    let id = null;
    const start = () => { if (!id) id = setInterval(refreshRequests, 30000); };
    const stop = () => { clearInterval(id); id = null; };
    const onVisibility = () => { if (document.hidden) stop(); else { refreshRequests(); start(); } };
    refreshRequests();
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [user, refreshRequests]);
  useEffect(() => { refreshRequests(); }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user) return undefined;
    api('/settings').then((r) => setOrgName(r.data.org_name || 'CareSphere')).catch(() => {});
    refreshLowStock();
    const id = setInterval(refreshLowStock, 30000);
    return () => clearInterval(id);
  }, [user, refreshLowStock]);

  const toast = useCallback((message, tone = 'success') => {
    toastId.current += 1;
    const id = toastId.current;
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  const value = useMemo(() => ({
    search, setSearch, query, commitSearch, collapsed, setCollapsed, mobileOpen, setMobileOpen,
    lowStock, refreshLowStock, orgName, setOrgName, toast, openRequests, refreshRequests, notifCounts,
  }), [search, setSearch, query, commitSearch, collapsed, mobileOpen, lowStock, refreshLowStock, orgName, toast, openRequests, refreshRequests, notifCounts]);

  return (
    <AppContext.Provider value={value}>
      {children}
      {/* Toasts: icon + text (not colour alone); errors are announced at once, the rest politely. */}
      <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col gap-2 sm:left-auto sm:right-4 sm:w-96" aria-live="polite">
        {toasts.map((t) => {
          const error = t.tone === 'error';
          const Icon = error ? AlertCircle : t.tone === 'info' ? Info : CheckCircle2;
          return (
            <div key={t.id} role={error ? 'alert' : 'status'}
              className={`pointer-events-auto flex animate-toast items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-modal ${
                error ? 'border-red-300 bg-red-50 text-red-900' : 'border-brand-200 bg-white text-navy-900'}`}>
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${error ? 'text-red-700' : t.tone === 'info' ? 'text-brand' : 'text-emerald-700'}`} aria-hidden />
              <span className="min-w-0 flex-1"><span className="sr-only">{error ? 'Error: ' : ''}</span>{t.message}</span>
              <button type="button" onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))} className="-mr-1 rounded p-0.5 text-slate-500 hover:bg-slate-100 hover:text-navy-900" aria-label="Dismiss">
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </AppContext.Provider>
  );
}

export const useApp = () => useContext(AppContext);
