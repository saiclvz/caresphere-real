import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { clearAllGrants } from '../lib/grants';
import { api, getToken, onUnauthorized, setToken } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(getToken()));

  const clear = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    onUnauthorized(clear);
    if (!getToken()) return;
    api('/auth/me')
      .then((res) => setUser(res.user))
      .catch(clear)
      .finally(() => setLoading(false));
  }, [clear]);

  /**
   * Step 1 of sign-in. Staff and Donor get a session right away.
   * Admins get { mfa_required, mfa_setup, mfa_token } instead, and no session
   * until the code step (completeSession) succeeds.
   */
  const login = useCallback(async (email, password) => {
    const res = await api('/auth/login', { method: 'POST', body: { email, password } });
    if (res.mfa_required) return { mfa: { token: res.mfa_token, setup: res.mfa_setup, name: res.name } };
    setToken(res.token);
    setUser(res.user);
    return { user: res.user };
  }, []);

  /** Finishes sign-in after two-step verification. */
  const completeSession = useCallback((res) => {
    setToken(res.token);
    setUser(res.user);
  }, []);

  const register = useCallback(async (payload) => {
    const res = await api('/auth/register', { method: 'POST', body: payload });
    setToken(res.token);
    setUser(res.user);
    return res.user;
  }, []);

  const logout = useCallback(async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* session already invalid */ }
    clearAllGrants(); // sensitive sections lock again
    clear();
  }, [clear]);

  // Undertaking areas accepted in this sign-in (only to skip the screen; the server checks every request).
  const [acceptedAreas, setAcceptedAreas] = useState(() => new Set());
  const markAreaAccepted = useCallback((area) => setAcceptedAreas((a) => new Set(a).add(area)), []);
  useEffect(() => { if (!user) setAcceptedAreas(new Set()); }, [user]);

  const value = useMemo(() => ({ user, loading, login, completeSession, register, logout, acceptedAreas, markAreaAccepted }),
    [user, loading, login, completeSession, register, logout, acceptedAreas, markAreaAccepted]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
