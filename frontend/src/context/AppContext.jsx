import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../api/client';
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
    if (!user || !['Admin', 'Staff'].includes(user.role)) return;
    try {
      const res = await api('/inventory/low-stock-count');
      setLowStock(res.count);
    } catch { /* badge is non-critical */ }
  }, [user]);

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
    lowStock, refreshLowStock, orgName, setOrgName, toast,
  }), [search, setSearch, query, commitSearch, collapsed, mobileOpen, lowStock, refreshLowStock, orgName, toast]);

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
