import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api';

const AdminContext = createContext(null);

export function AdminProvider({ children }) {
  const [admin, setAdmin] = useState(null);
  const [loading, setLoading] = useState(true);

  const token = typeof window !== 'undefined' ? window.localStorage.getItem('admin_token') : null;

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      setLoading(true);
      try {
        const t = window.localStorage.getItem('admin_token');
        if (!t) {
          if (!cancelled) setAdmin(null);
          return;
        }
        const me = await api.admin.me();
        if (!cancelled) setAdmin(me);
      } catch (e) {
        window.localStorage.removeItem('admin_token');
        if (!cancelled) setAdmin(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = async ({ username, password }) => {
    const res = await api.admin.login({ username, password });
    window.localStorage.setItem('admin_token', res.token);
    setAdmin(res.admin);
    return res.admin;
  };

  const logout = async () => {
    try {
      await api.admin.logout();
    } catch (_) {
      // ignore
    }
    window.localStorage.removeItem('admin_token');
    setAdmin(null);
  };

  const value = useMemo(
    () => ({
      admin,
      loading,
      login,
      logout,
    }),
    [admin, loading],
  );

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

export function useAdmin() {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error('useAdmin must be used within AdminProvider');
  return ctx;
}

