/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback } from 'react';
import { getRedirectResult, signOut } from 'firebase/auth';
import { auth } from './lib/firebase';
import { Navbar, type ActiveRoute, type WebsiteSettings } from './components/Navbar';
import { CatalogView } from './components/CatalogView';
import { BargainingRoom } from './components/BargainingRoom';
import { SellerPortal } from './components/SellerPortal';
import { LoginPage, type AuthUserProfile } from './components/LoginPage';
import type { PublicItem } from './lib/bargaining';

const DEFAULT_SETTINGS: WebsiteSettings = {
  autoPlayChat: true,
  bargainStyle: 'balanced',
  currency: 'USD',
  soundEffects: true,
  paypalEmail: 'buyer@paypal.com',
};

export default function App() {
  const [route, setRoute] = useState<ActiveRoute>({ view: 'catalog' });
  const [items, setItems] = useState<PublicItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeLocksCount, setActiveLocksCount] = useState(0);
  const [sessionId] = useState(() => `shopper-${Math.random().toString(36).slice(2, 9)}`);

  // Website Settings State
  const [settings, setSettings] = useState<WebsiteSettings>(() => {
    try {
      const saved = localStorage.getItem('haggle_settings');
      return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  const handleUpdateSettings = (next: WebsiteSettings) => {
    setSettings(next);
    try {
      localStorage.setItem('haggle_settings', JSON.stringify(next));
    } catch {
      // Ignored
    }
  };

  // Theme State (PayPal Blue Light Gradient by default, with Dark Navy Gradient toggle)
  const [isDark, setIsDark] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('haggle_theme');
      return saved === 'dark';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem('haggle_theme', isDark ? 'dark' : 'light');
    } catch {
      // Ignored
    }
  }, [isDark]);

  // User Auth State
  const [currentUser, setCurrentUser] = useState<AuthUserProfile | null>(() => {
    try {
      const saved = sessionStorage.getItem('haggle_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [initialAuthError, setInitialAuthError] = useState<string | null>(null);

  const handleLoginSuccess = useCallback((user: AuthUserProfile, token?: string) => {
    setCurrentUser(user);
    if (token) setAuthToken(token);
    setInitialAuthError(null);
    try {
      sessionStorage.setItem('haggle_user', JSON.stringify(user));
    } catch {
      // Ignored
    }
  }, []);

  const handleSignOut = () => {
    setCurrentUser(null);
    setAuthToken(null);
    try {
      sessionStorage.removeItem('haggle_user');
    } catch {
      // Ignored
    }
    fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    signOut(auth).catch(() => {});
    setRoute({ view: 'catalog' });
  };

  const fetchCatalogAndMetrics = useCallback(async () => {
    try {
      const [itemsRes, dashRes] = await Promise.all([
        fetch('/api/items'),
        fetch('/api/seller/dashboard'),
      ]);
      let serverItems: PublicItem[] = [];
      if (itemsRes.ok) {
        const itemsData = await itemsRes.json();
        serverItems = itemsData.items || [];
      }
      // Merge with custom items from localStorage (preserving secret floor stripping)
      try {
        const customRaw = localStorage.getItem('haggle_custom_items');
        if (customRaw) {
          const customList: PublicItem[] = JSON.parse(customRaw);
          const serverIds = new Set(serverItems.map((i) => i.id));
          const uniqueCustom = customList
            .filter((i) => !serverIds.has(i.id))
            .map((item) => {
              const { floorPrice: _, ...safeItem } = item as any;
              return safeItem as PublicItem;
            });
          serverItems = [...uniqueCustom, ...serverItems];
        }
      } catch {
        // Ignored
      }
      setItems(serverItems);

      if (dashRes.ok) {
        const dashData = await dashRes.json();
        setActiveLocksCount(dashData.metrics?.activePriceLocks || 0);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCatalogAndMetrics();
  }, [fetchCatalogAndMetrics]);

  useEffect(() => {
    const path = window.location.pathname;
    const params = new URLSearchParams(window.location.search);
    const authError = params.get('auth_error') || params.get('error');
    const authProvider = params.get('auth_provider');
    const oauthCode = params.get('code');
    const oauthState = params.get('state');

    if (authError) {
      setInitialAuthError(authError);
      setRoute({ view: 'login', initialMode: 'signin' });
    } else if (path.startsWith('/signup')) {
      setRoute({ view: 'login', initialMode: 'signup' });
    } else if (path.startsWith('/login')) {
      setRoute({ view: 'login', initialMode: 'signin' });
    } else if (path.startsWith('/seller')) {
      setRoute({ view: 'seller', openNewModal: path.includes('/new') });
    } else if (path.startsWith('/items/')) {
      const id = path.replace('/items/', '').trim();
      if (id) setRoute({ view: 'bargain', itemId: id });
    }

    if (authError || authProvider || oauthCode || oauthState) {
      for (const k of ['auth_error', 'error', 'auth_provider', 'code', 'state', 'scope', 'authuser', 'prompt']) {
        params.delete(k);
      }
      const cleanedSearch = params.toString();
      window.history.replaceState({}, '', `${path}${cleanedSearch ? `?${cleanedSearch}` : ''}`);
    }

    // Complete root-origin Google OAuth 2.0 redirect code exchange if ?code=&state= returned
    if (oauthCode && oauthState && !authError) {
      fetch('/api/auth/google/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: oauthCode, state: oauthState }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.authenticated && data.user) {
            const profile: AuthUserProfile = {
              email: data.user.email,
              name: data.user.name,
              role: data.user.role === 'maker' ? 'maker' : 'shopper',
              photoUrl: data.user.photoUrl,
            };
            handleLoginSuccess(profile, data.token || undefined);
            if (profile.role === 'maker' || String(data.returnTo || '').startsWith('/seller')) {
              setRoute({ view: 'seller' });
            } else {
              setRoute({ view: 'catalog' });
            }
          } else {
            setInitialAuthError('token_exchange_failed');
            setRoute({ view: 'login', initialMode: 'signin' });
          }
        })
        .catch(() => {
          setInitialAuthError('oauth_callback_error');
          setRoute({ view: 'login', initialMode: 'signin' });
        });
      return;
    }

    // Restore Google OAuth session cookie from server
    fetch('/api/auth/session')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.authenticated && data.user) {
          const profile: AuthUserProfile = {
            email: data.user.email,
            name: data.user.name,
            role: data.user.role === 'maker' ? 'maker' : 'shopper',
            photoUrl: data.user.photoUrl,
          };
          handleLoginSuccess(profile, data.token || undefined);
          if (authProvider === 'google' && profile.role === 'maker') {
            setRoute({ view: 'seller' });
          }
        }
      })
      .catch(() => {});

    // Complete any pending Firebase signInWithRedirect return
    getRedirectResult(auth)
      .then(async (credential) => {
        if (!credential?.user) return;
        const token = await credential.user.getIdToken();
        const pendingRole =
          sessionStorage.getItem('haggle_pending_auth_role') === 'maker' ? 'maker' : 'shopper';
        sessionStorage.removeItem('haggle_pending_auth_role');

        fetch('/api/auth/sync', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        }).catch(() => {});

        const profile: AuthUserProfile = {
          email: credential.user.email || 'user@haggle.market',
          name:
            credential.user.displayName ||
            (pendingRole === 'maker' ? 'Studio Maker' : 'Handmade Collector'),
          role: pendingRole,
          photoUrl: credential.user.photoURL || undefined,
        };
        handleLoginSuccess(profile, token);
        setRoute(pendingRole === 'maker' ? { view: 'seller' } : { view: 'catalog' });
      })
      .catch((err) => {
        if (err && (err as any).code) {
          console.warn('Firebase redirect auth note:', (err as any).code);
        }
      });
  }, [handleLoginSuccess]);

  const handleNavigate = (next: ActiveRoute) => {
    setRoute(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="app-shell-bg min-h-screen flex flex-col bg-gradient-to-b from-[#DCEBFA] via-[#EDF5FD] to-[#F7FAFF] dark:bg-[#08090A] dark:bg-none text-[#001C64] dark:text-[#F7F8F8] font-sans transition-colors">
      <Navbar
        route={route}
        onNavigate={handleNavigate}
        activeLocksCount={activeLocksCount}
        currentUser={currentUser}
        onSignOut={handleSignOut}
        isDark={isDark}
        onToggleTheme={() => setIsDark((prev) => !prev)}
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
      />

      <main className="flex-1">
        {route.view === 'catalog' && (
          <CatalogView
            items={items}
            loading={loading}
            sessionId={sessionId}
            autoPlayChat={settings.autoPlayChat}
            onSelectItem={(itemId) => handleNavigate({ view: 'bargain', itemId })}
            onOpenSellerStudio={() => handleNavigate({ view: 'seller' })}
            onOpenSellerNew={() => handleNavigate({ view: 'seller', openNewModal: true })}
            onOpenLogin={(role, mode) =>
              handleNavigate({ view: 'login', initialRole: role, initialMode: mode })
            }
            onCatalogMutated={fetchCatalogAndMetrics}
          />
        )}

        {route.view === 'login' && (
          <LoginPage
            initialRole={route.initialRole || 'shopper'}
            initialMode={route.initialMode || 'signin'}
            initialAuthError={initialAuthError}
            onNavigate={handleNavigate}
            onLoginSuccess={handleLoginSuccess}
          />
        )}

        {route.view === 'bargain' && (
          <BargainingRoom
            itemId={route.itemId}
            sessionId={sessionId}
            allItems={items}
            onSelectItem={(itemId) => handleNavigate({ view: 'bargain', itemId })}
            onBack={() => {
              fetchCatalogAndMetrics();
              handleNavigate({ view: 'catalog' });
            }}
            onDealUpdated={fetchCatalogAndMetrics}
          />
        )}

        {route.view === 'seller' && (
          <SellerPortal
            openNewModalInitially={route.openNewModal}
            currentUser={currentUser}
            externalToken={authToken}
            onUserAuthenticated={handleLoginSuccess}
            onSelectItemForBargain={(itemId) => handleNavigate({ view: 'bargain', itemId })}
            onCatalogMutated={fetchCatalogAndMetrics}
          />
        )}
      </main>

      <footer
        className={`${
          route.view === 'bargain' ? 'hidden lg:block' : ''
        } border-t border-[#CBE0F6] dark:border-white/[0.08] bg-white dark:bg-[#08090A] py-5 mt-auto transition-colors`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-wrap items-center justify-between gap-3 text-xs text-[#3B5278] dark:text-[#8A8F98]">
          <div className="flex items-center gap-2">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="text-[#003087] dark:text-[#F7F8F8] shrink-0"
            >
              <path
                fill="currentColor"
                d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"
              />
              <circle cx="7.5" cy="7.5" r="1.7" fill="var(--bg-surface)" />
            </svg>
            <span className="font-bold text-sm tracking-tight text-[#001C64] dark:text-[#F7F8F8]">
              Haggle
            </span>
            <span aria-hidden="true">·</span>
            <span>AI Bargaining · PayPal Checkout</span>
          </div>

          <div className="flex items-center gap-4">
            {currentUser ? (
              <span className="text-[#001C64] dark:text-[#F7F8F8] font-medium">
                {currentUser.email}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => handleNavigate({ view: 'login', initialMode: 'signin' })}
                className="font-semibold text-[#003087] dark:text-[#F7F8F8] hover:underline cursor-pointer"
              >
                Sign In
              </button>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
