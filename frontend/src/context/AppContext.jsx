import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
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
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} role="status"
            className={`pointer-events-auto rounded-lg px-4 py-3 text-sm shadow-modal ${
              t.tone === 'error' ? 'bg-red-600 text-white' : 'bg-navy-900 text-white'}`}>
            {t.message}
          </div>
        ))}
      </div>
    </AppContext.Provider>
  );
}

export const useApp = () => useContext(AppContext);
