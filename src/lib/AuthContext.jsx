/**
 * Auth, backed by Supabase.
 *
 * Replaces the Base44 version, which hand-rolled an axios client against
 * /api/apps/public/... and inferred auth state from HTTP 403 reason codes.
 * The public contract is unchanged — App.jsx and every consumer of useAuth()
 * still read { user, isAuthenticated, isLoadingAuth, isLoadingPublicSettings,
 * authError, logout, navigateToLogin, checkAppState } — so nothing downstream
 * had to be touched.
 *
 * Two real fixes over the original:
 *  1. It subscribes to auth state changes. The Base44 version checked once on
 *     mount, so a token expiring mid-session left the UI in a signed-in state
 *     that failed every request until a manual refresh.
 *  2. Sign-out clears React state before redirecting, so a cancelled redirect
 *     can't leave a stale user object behind.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { base44, supabase } from '@/api/base44Client';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);

  const loadUser = useCallback(async (session) => {
    if (!session) {
      if (!mounted.current) return;
      setUser(null);
      setIsLoadingAuth(false);
      setAuthError({ type: 'auth_required', message: 'Authentication required' });
      return;
    }
    try {
      const profile = await base44.auth.me();
      if (!mounted.current) return;
      setUser(profile);
      setAuthError(null);
    } catch (error) {
      if (!mounted.current) return;
      setUser(null);
      // A signed-in Supabase user with no profile row means they were removed
      // from the app — the same case Base44 called `user_not_registered`.
      setAuthError(
        error.status === 401 || error.status === 403
          ? { type: 'auth_required', message: 'Authentication required' }
          : { type: 'user_not_registered', message: error.message }
      );
    } finally {
      if (mounted.current) setIsLoadingAuth(false);
    }
  }, []);

  const checkAppState = useCallback(async () => {
    setIsLoadingAuth(true);
    const { data: { session } } = await supabase.auth.getSession();
    await loadUser(session);
  }, [loadUser]);

  useEffect(() => {
    checkAppState();
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setUser(null);
        setAuthError({ type: 'auth_required', message: 'Signed out' });
        return;
      }
      if (event === 'TOKEN_REFRESHED' && user) return; // no reload needed
      loadUser(session);
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logout = useCallback(async (shouldRedirect = true) => {
    setUser(null);
    setAuthError(null);
    await base44.auth.logout(shouldRedirect ? '/login' : undefined);
  }, []);

  const navigateToLogin = useCallback(() => {
    base44.auth.redirectToLogin(window.location.href);
  }, []);

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: Boolean(user),
      isLoadingAuth,
      // Kept for API compatibility with the Base44 version; there is no
      // separate public-settings round trip any more, so it is never pending.
      isLoadingPublicSettings: false,
      appPublicSettings: null,
      authError,
      logout,
      navigateToLogin,
      checkAppState,
    }),
    [user, isLoadingAuth, authError, logout, navigateToLogin, checkAppState]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
