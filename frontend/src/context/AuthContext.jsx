import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { clearAllGrants } from '../lib/grants';
import { api, onUnauthorized, setSession } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const clear = useCallback(() => {
    setSession(false);
    setUser(null);
  }, []);

  useEffect(() => {
    onUnauthorized(clear);
    // The session is an HttpOnly cookie: ask the server whether this browser is signed in.
    api('/auth/me')
      .then((res) => { setSession(true, res.csrf_token); setUser(res.user); })
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
    setSession(true, res.csrf_token);
    setUser(res.user);
    return { user: res.user };
  }, []);

  /** Finishes sign-in after two-step verification. */
  const completeSession = useCallback((res) => {
    setSession(true, res.csrf_token);
    setUser(res.user);
  }, []);

  /** After the user chose a new password (also the forced change of a temporary password): a fresh session. */
  const passwordChanged = useCallback(async (res) => {
    setSession(true, res?.csrf_token);
    const me = await api('/auth/me');
    setUser(me.user);
  }, []);

  const register = useCallback(async (payload) => {
    const res = await api('/auth/register', { method: 'POST', body: payload });
    setSession(true, res.csrf_token);
    setUser(res.user);
    return res.user;
  }, []);

  const logout = useCallback(async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* session already invalid */ }
    clearAllGrants(); // sensitive sections lock again
    clear();
  }, [clear]);

  const value = useMemo(() => ({ user, loading, login, completeSession, passwordChanged, register, logout }), [user, loading, login, completeSession, passwordChanged, register, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
