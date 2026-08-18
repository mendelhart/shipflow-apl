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
  // The auth listener closes over state once. Reading `user` from a ref keeps
  // the TOKEN_REFRESHED guard honest — as a closure variable it was always
  // null, so every hourly refresh re-ran a full profile fetch, and any
  // transient failure during one ejected the user mid-edit.
  const userRef = useRef(null);
  // Discards the result of a stale in-flight load when two run concurrently.
  const loadSeq = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const applyUser = (profile) => {
    userRef.current = profile;
    setUser(profile);
  };

  const loadUser = useCallback(async (session) => {
    const seq = ++loadSeq.current;
    const isCurrent = () => mounted.current && seq === loadSeq.current;

    if (!session) {
      if (!isCurrent()) return;
      applyUser(null);
      setIsLoadingAuth(false);
      setAuthError({ type: 'auth_required', message: 'Authentication required' });
      return;
    }
    try {
      const profile = await base44.auth.me();
      if (!isCurrent()) return;
      applyUser(profile);
      // A signed-in user whose profile has not been activated is a real
      // "not registered" case, and the only one.
      setAuthError(
        profile?.is_active === false
          ? {
              type: 'user_not_registered',
              message: 'Your account is awaiting approval by an administrator.',
            }
          : null
      );
    } catch (error) {
      if (!isCurrent()) return;
      applyUser(null);
      // Anything that is not an explicit auth rejection is treated as
      // retryable. Previously a two-second network blip fell through to
      // "You are not registered to use this application" — a dead end with
      // no retry, for the rest of the session.
      setAuthError(
        error?.status === 401 || error?.status === 403
          ? { type: 'auth_required', message: 'Authentication required' }
          : {
              type: 'network_error',
              message:
                error?.message || 'Could not reach the server. Check your connection.',
            }
      );
    } finally {
      if (mounted.current && seq === loadSeq.current) setIsLoadingAuth(false);
    }
  }, []);

  const checkAppState = useCallback(async () => {
    setIsLoadingAuth(true);
    try {
      const { data: { session } = {} } = await supabase.auth.getSession();
      await loadUser(session);
    } catch (error) {
      // getSession() can reject (cross-tab lock contention, a corrupt stored
      // session). Unhandled, it left isLoadingAuth true forever and the app
      // showed a spinner with no way out.
      if (!mounted.current) return;
      applyUser(null);
      setAuthError({
        type: 'network_error',
        message: error?.message || 'Could not restore your session.',
      });
      setIsLoadingAuth(false);
    }
  }, [loadUser]);

  useEffect(() => {
    // No manual bootstrap call: onAuthStateChange fires INITIAL_SESSION on
    // subscribe. Calling both raced two profile loads whose results could
    // land in either order.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        applyUser(null);
        setIsLoadingAuth(false);
        setAuthError({ type: 'auth_required', message: 'Signed out' });
        return;
      }
      if (event === 'TOKEN_REFRESHED' && userRef.current) return;
      loadUser(session);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadUser]);

  const logout = useCallback(async (shouldRedirect = true) => {
    applyUser(null);
    setAuthError(null);
    await base44.auth.logout(shouldRedirect ? '/login' : undefined);
  }, []);

  const navigateToLogin = useCallback(() => {
    // Pass a path, never an absolute URL: Login.jsx treats `next` as a path
    // and would build https://hosthttps://host/Page from a full URL.
    base44.auth.redirectToLogin(window.location.pathname + window.location.search);
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
