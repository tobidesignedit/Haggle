import React, { useState, useEffect } from 'react';
import { signInWithPopup, signInWithRedirect } from 'firebase/auth';
import {
  ArrowLeft,
  Mail,
  Lock,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  User,
  ShoppingBag,
  Store,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import { auth, googleAuthProvider, activeFirebaseProjectId } from '../lib/firebase';
import type { ActiveRoute } from './Navbar';

export interface AuthUserProfile {
  email: string;
  name: string;
  role: 'shopper' | 'maker';
  photoUrl?: string;
}

interface AuthProviderInfo {
  directGoogleEnabled: boolean;
  redirectUri: string;
  origin: string;
}

interface LoginPageProps {
  onNavigate: (route: ActiveRoute) => void;
  onLoginSuccess: (user: AuthUserProfile, token?: string) => void;
  initialRole?: 'shopper' | 'maker';
  initialMode?: 'signin' | 'signup';
  initialAuthError?: string | null;
}

function formatRedirectAuthError(code: string): string {
  switch (code) {
    case 'access_denied':
    case 'cancelled':
      return 'Google sign-in was cancelled. You can try again anytime.';
    case 'google_not_configured':
      return 'Google OAuth credentials are not configured on the server yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or authorize this domain in Firebase Console.';
    case 'email_unverified':
      return 'Your Google email address is not verified.';
    default:
      return `Google sign-in could not be completed (${code}). Please try again.`;
  }
}

export const LoginPage: React.FC<LoginPageProps> = ({
  onNavigate,
  onLoginSuccess,
  initialRole = 'shopper',
  initialMode = 'signin',
  initialAuthError = null,
}) => {
  const [role, setRole] = useState<'shopper' | 'maker'>(initialRole);
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [agreedTerms, setAgreedTerms] = useState(true);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(() =>
    initialAuthError ? formatRedirectAuthError(initialAuthError) : null
  );
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const [providers, setProviders] = useState<AuthProviderInfo | null>(null);

  useEffect(() => {
    fetch('/api/auth/providers')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: AuthProviderInfo | null) => {
        if (data) setProviders(data);
      })
      .catch(() => {});
  }, []);

  const handleGoogleAuth = async () => {
    setErrorMessage(null);

    // 1. Prefer popup-free server-side Google OAuth 2.0 when GOOGLE_CLIENT_ID & SECRET are configured
    if (providers?.directGoogleEnabled) {
      setLoading(true);
      const returnTo = role === 'maker' ? '/seller' : '/';
      window.location.assign(
        `/api/auth/google?role=${encodeURIComponent(role)}&mode=${encodeURIComponent(mode)}&returnTo=${encodeURIComponent(returnTo)}`
      );
      return;
    }

    // 2. Otherwise use Firebase Google Sign-In (with automatic redirect fallback if popup blocked)
    try {
      setLoading(true);
      try {
        sessionStorage.setItem('haggle_pending_auth_role', role);
      } catch {
        // Ignored
      }

      const credential = await signInWithPopup(auth, googleAuthProvider);
      const token = await credential.user.getIdToken();

      // Sync user profile to backend Cloud SQL / store
      try {
        await fetch('/api/auth/sync', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        });
      } catch (err) {
        console.warn('Backend user sync fallback:', err);
      }

      const profile: AuthUserProfile = {
        email: credential.user.email || 'user@haggle.market',
        name:
          credential.user.displayName || (role === 'maker' ? 'Studio Maker' : 'Handmade Collector'),
        role,
        photoUrl: credential.user.photoURL || undefined,
      };

      setSuccessNotice(
        mode === 'signup'
          ? `Account created! Welcome to Haggle, ${profile.name}.`
          : `Signed in successfully as ${profile.email}!`
      );
      setTimeout(() => {
        onLoginSuccess(profile, token);
        if (role === 'maker') {
          onNavigate({ view: 'seller' });
        } else {
          onNavigate({ view: 'catalog' });
        }
      }, 400);
    } catch (err: unknown) {
      const code = (err as any)?.code as string | undefined;
      if (code === 'auth/popup-blocked') {
        try {
          await signInWithRedirect(auth, googleAuthProvider);
          return;
        } catch (redirectErr) {
          console.error('Google Redirect fallback error:', redirectErr);
        }
      }

      console.error('Google Auth error:', err);
      const currentHost = typeof window !== 'undefined' ? window.location.hostname : 'this domain';
      const callbackUrl =
        providers?.redirectUri ||
        (typeof window !== 'undefined' ? `${window.location.origin}/api/auth/google/callback` : '/api/auth/google/callback');

      if (code === 'auth/unauthorized-domain') {
        setErrorMessage(
          `Domain "${currentHost}" is not authorized yet in Firebase project "${activeFirebaseProjectId}". Add "${currentHost}" to Firebase Authorized Domains (or add GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET with redirect URI "${callbackUrl}").`
        );
      } else if (code === 'auth/popup-blocked') {
        setErrorMessage(
          'Google popup was blocked by your browser. Please allow popups for this site or configure direct Google OAuth.'
        );
      } else if (code === 'auth/popup-closed-by-user') {
        setErrorMessage(
          'Google sign-in popup was closed before finishing. Please try again.'
        );
      } else {
        setErrorMessage(
          `Google Sign-In could not complete (${code || 'unknown error'}). Verify Firebase Authorized Domains for "${currentHost}" or configure GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET.`
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePayPalAuth = () => {
    setLoading(true);
    setErrorMessage(null);
    setTimeout(() => {
      const profile: AuthUserProfile = {
        email: 'alex.paypal@shopper.com',
        name: 'Alex Morgan',
        role: 'shopper',
      };
      setSuccessNotice(
        mode === 'signup'
          ? 'Haggle account linked with PayPal (alex.paypal@shopper.com).'
          : 'Signed in with PayPal (alex.paypal@shopper.com).'
      );
      setTimeout(() => {
        onLoginSuccess(profile);
        onNavigate({ view: 'catalog' });
      }, 400);
      setLoading(false);
    }, 600);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setErrorMessage('Please provide both email and password.');
      return;
    }
    if (password.length < 6) {
      setErrorMessage('Password must be at least 6 characters.');
      return;
    }
    if (mode === 'signup' && !agreedTerms) {
      setErrorMessage('Please accept the marketplace terms to create an account.');
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    setTimeout(() => {
      const derivedName = name.trim() || email.split('@')[0];
      const profile: AuthUserProfile = {
        email: email.trim(),
        name: derivedName,
        role,
      };
      setSuccessNotice(
        mode === 'signup'
          ? `Welcome to Haggle, ${profile.name}! Your account is active.`
          : `Welcome back, ${profile.name}!`
      );
      setTimeout(() => {
        onLoginSuccess(profile);
        if (role === 'maker') {
          onNavigate({ view: 'seller' });
        } else {
          onNavigate({ view: 'catalog' });
        }
      }, 400);
      setLoading(false);
    }, 500);
  };

  const handleDemoSignIn = (presetRole: 'shopper' | 'maker') => {
    const profile: AuthUserProfile =
      presetRole === 'maker'
        ? {
            email: 'studio@bornsaddlery.com',
            name: 'Born Saddlery Studio',
            role: 'maker',
          }
        : {
            email: 'alex.morgan@gmail.com',
            name: 'Alex Morgan',
            role: 'shopper',
          };

    setSuccessNotice(`Demo access granted as ${presetRole} (${profile.email})`);
    setTimeout(() => {
      onLoginSuccess(profile);
      if (presetRole === 'maker') {
        onNavigate({ view: 'seller' });
      } else {
        onNavigate({ view: 'catalog' });
      }
    }, 300);
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex flex-col justify-center py-10 px-4 sm:px-6 lg:px-8 bg-[#FAF7F2]">
      <div className="max-w-md w-full mx-auto space-y-6">
        {/* Back Link */}
        <button
          type="button"
          onClick={() => onNavigate({ view: 'catalog' })}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#665E57] hover:text-[#1E1B18] transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to marketplace</span>
        </button>

        {/* Main Auth Card */}
        <div className="bg-white rounded-2xl border border-[#E5DDD0] shadow-sm p-6 sm:p-8 space-y-6">
          {/* Header */}
          <div className="text-center space-y-2">
            <span className="font-extrabold text-3xl text-[#1E1B18] tracking-tight block">
              Haggle
            </span>
            <h1 className="text-xl sm:text-2xl font-bold text-[#1E1B18]">
              {mode === 'signup' ? 'Create your Haggle account' : 'Welcome back to Haggle'}
            </h1>
            <p className="text-xs sm:text-sm text-[#665E57]">
              {mode === 'signup'
                ? role === 'shopper'
                  ? 'Sign up to negotiate handmade goods, lock 15-minute deals, and pay with PayPal.'
                  : 'Register your artisan workshop to set asking & secret floor prices.'
                : role === 'shopper'
                ? 'Sign in to access your offers, 15-minute price holds, and PayPal order receipts.'
                : 'Sign in to access Seller Studio, manage inventory, and monitor margins.'}
            </p>
          </div>

          {/* Primary Mode Tabs: [ Log In ] vs [ Sign Up ] */}
          <div className="grid grid-cols-2 p-1 bg-[#F3EDE4] rounded-xl gap-1">
            <button
              type="button"
              data-testid="auth-tab-signin"
              onClick={() => {
                setMode('signin');
                setErrorMessage(null);
              }}
              className={`py-2 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                mode === 'signin'
                  ? 'bg-white text-[#1E1B18] shadow-xs'
                  : 'text-[#665E57] hover:text-[#1E1B18]'
              }`}
            >
              Log In
            </button>
            <button
              type="button"
              data-testid="auth-tab-signup"
              onClick={() => {
                setMode('signup');
                setErrorMessage(null);
              }}
              className={`py-2 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                mode === 'signup'
                  ? 'bg-[#1E1B18] text-white shadow-xs'
                  : 'text-[#665E57] hover:text-[#1E1B18]'
              }`}
            >
              Sign Up
            </button>
          </div>

          {/* Persona Switcher: Shopper vs Maker */}
          <div className="flex items-center justify-between p-2 rounded-xl bg-[#FAF7F2] border border-[#E5DDD0]">
            <span className="text-[11px] font-semibold text-[#665E57] pl-1">I am a:</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setRole('shopper');
                  setErrorMessage(null);
                }}
                className={`py-1.5 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                  role === 'shopper'
                    ? 'bg-white text-[#1E1B18] border border-[#D5CBBF] shadow-xs'
                    : 'text-[#665E57] hover:text-[#1E1B18]'
                }`}
              >
                <ShoppingBag className="w-3.5 h-3.5" />
                <span>Shopper</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setRole('maker');
                  setErrorMessage(null);
                }}
                className={`py-1.5 px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                  role === 'maker'
                    ? 'bg-white text-[#1E1B18] border border-[#D5CBBF] shadow-xs'
                    : 'text-[#665E57] hover:text-[#1E1B18]'
                }`}
              >
                <Store className="w-3.5 h-3.5" />
                <span>Maker / Seller</span>
              </button>
            </div>
          </div>

          {/* Feedback Alerts */}
          {errorMessage && (
            <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs font-medium text-red-800 space-y-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
                <span className="leading-relaxed">{errorMessage}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1.5 border-t border-red-200/80">
                <button
                  type="button"
                  onClick={() => handleDemoSignIn(role)}
                  className="px-2.5 py-1 text-[11px] font-bold bg-[#1E1B18] text-white rounded-md hover:bg-[#8B4B24] transition-colors cursor-pointer"
                >
                  Continue with 1-Click {role === 'maker' ? 'Maker' : 'Shopper'} Demo
                </button>
                {role === 'shopper' && (
                  <button
                    type="button"
                    onClick={handlePayPalAuth}
                    className="px-2.5 py-1 text-[11px] font-bold bg-[#FFC439] text-[#003087] rounded-md hover:bg-[#F2B829] transition-colors cursor-pointer"
                  >
                    Use PayPal Instead
                  </button>
                )}
              </div>
            </div>
          )}

          {successNotice && (
            <div className="p-3 rounded-xl bg-[#E3F1EC] border border-[#B8DEC9] text-xs font-medium text-[#0F523E] flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{successNotice}</span>
            </div>
          )}

          {/* Third-Party Fast Auth */}
          <div className="space-y-2.5">
            {/* Google */}
            <button
              type="button"
              disabled={loading}
              onClick={handleGoogleAuth}
              className="w-full py-2.5 px-4 rounded-xl border border-[#D5CBBF] hover:border-[#1E1B18] bg-white text-[#1E1B18] text-xs sm:text-sm font-semibold flex items-center justify-center gap-2.5 transition-colors cursor-pointer shadow-xs disabled:opacity-60"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.65v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.14z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.17 0 9.99 0 12s.45 3.83 1.25 5.42l4.03-3.15z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                />
              </svg>
              <span>{mode === 'signup' ? 'Sign up with Google' : 'Continue with Google'}</span>
            </button>

            {/* PayPal for Shoppers */}
            {role === 'shopper' && (
              <button
                type="button"
                disabled={loading}
                onClick={handlePayPalAuth}
                className="w-full py-2.5 px-4 rounded-xl bg-[#FFC439] hover:bg-[#F2B829] text-[#003087] text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-xs disabled:opacity-60"
              >
                <span className="font-mono text-sm tracking-tighter italic font-black">
                  Pay<span className="text-[#0070BA]">Pal</span>
                </span>
                <span>{mode === 'signup' ? 'Sign up with PayPal' : 'Continue with PayPal'}</span>
              </button>
            )}
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="h-px bg-[#E5DDD0] flex-1" />
            <span className="text-[11px] text-[#8C827A] font-semibold uppercase tracking-wider shrink-0">
              or with email
            </span>
            <div className="h-px bg-[#E5DDD0] flex-1" />
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label
                  htmlFor="auth-name"
                  className="block text-xs font-semibold text-[#1E1B18] mb-1"
                >
                  {role === 'maker' ? 'Studio / Maker Name' : 'Your Full Name'}
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-[#8C827A] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    id="auth-name"
                    type="text"
                    required={mode === 'signup'}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={role === 'maker' ? 'e.g. Born Saddlery Studio' : 'e.g. Alex Morgan'}
                    className="w-full pl-9 pr-3 py-2 text-xs sm:text-sm bg-white border border-[#D5CBBF] rounded-xl text-[#1E1B18] placeholder:text-[#8C827A] focus:outline-2 focus:outline-[#0070BA]"
                  />
                </div>
              </div>
            )}

            <div>
              <label
                htmlFor="auth-email"
                className="block text-xs font-semibold text-[#1E1B18] mb-1"
              >
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-[#8C827A] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="auth-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={role === 'maker' ? 'studio@maker.com' : 'you@example.com'}
                  className="w-full pl-9 pr-3 py-2 text-xs sm:text-sm bg-white border border-[#D5CBBF] rounded-xl text-[#1E1B18] placeholder:text-[#8C827A] focus:outline-2 focus:outline-[#0070BA]"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label
                  htmlFor="auth-password"
                  className="block text-xs font-semibold text-[#1E1B18]"
                >
                  Password
                </label>
                {mode === 'signin' ? (
                  <button
                    type="button"
                    onClick={() => setSuccessNotice('Password reset link sent if registered.')}
                    className="text-[11px] font-medium text-[#0070BA] hover:underline cursor-pointer"
                  >
                    Forgot password?
                  </button>
                ) : (
                  <span className="text-[11px] text-[#8C827A]">Min 6 characters</span>
                )}
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 text-[#8C827A] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="auth-password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-9 pr-3 py-2 text-xs sm:text-sm bg-white border border-[#D5CBBF] rounded-xl text-[#1E1B18] placeholder:text-[#8C827A] focus:outline-2 focus:outline-[#0070BA]"
                />
              </div>
            </div>

            {mode === 'signup' && (
              <label className="flex items-start gap-2 pt-1 text-xs text-[#57504A] cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreedTerms}
                  onChange={(e) => setAgreedTerms(e.target.checked)}
                  className="mt-0.5 rounded border-[#D5CBBF] text-[#0070BA] focus:ring-[#0070BA]"
                />
                <span>
                  I agree to Haggle Marketplace Terms and PayPal Buyer Protection policies.
                </span>
              </label>
            )}

            <button
              type="submit"
              disabled={loading}
              className={`w-full py-2.5 px-4 rounded-xl text-white text-xs sm:text-sm font-semibold transition-colors cursor-pointer shadow-xs disabled:opacity-60 flex items-center justify-center gap-2 ${
                mode === 'signup'
                  ? 'bg-[#0070BA] hover:bg-[#005EA6]'
                  : 'bg-[#1E1B18] hover:bg-[#8B4B24]'
              }`}
            >
              <span>{loading ? 'Please wait...' : mode === 'signup' ? 'Create Account' : 'Log In'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          {/* 1-Click Fast Demo Credentials */}
          <div className="pt-2 border-t border-[#E5DDD0] space-y-2">
            <span className="text-[11px] font-medium text-[#665E57] block text-center">
              Instant test access (1-click demo):
            </span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleDemoSignIn('shopper')}
                className="py-1.5 px-2 text-[11px] font-semibold bg-[#FAF7F2] hover:bg-[#F3EDE4] border border-[#E5DDD0] text-[#1E1B18] rounded-lg transition-colors cursor-pointer truncate"
              >
                Shopper Demo
              </button>
              <button
                type="button"
                onClick={() => handleDemoSignIn('maker')}
                className="py-1.5 px-2 text-[11px] font-semibold bg-[#FAF7F2] hover:bg-[#F3EDE4] border border-[#E5DDD0] text-[#1E1B18] rounded-lg transition-colors cursor-pointer truncate"
              >
                Maker Demo
              </button>
            </div>
          </div>

          {/* Toggle between Log In and Sign Up */}
          <div className="text-center text-xs text-[#665E57] pt-1">
            {mode === 'signup' ? (
              <span>
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setMode('signin');
                    setErrorMessage(null);
                  }}
                  className="font-bold text-[#0070BA] hover:underline cursor-pointer"
                >
                  Log In
                </button>
              </span>
            ) : (
              <span>
                New to Haggle?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setMode('signup');
                    setErrorMessage(null);
                  }}
                  className="font-bold text-[#0070BA] hover:underline cursor-pointer"
                >
                  Sign Up (Create Account)
                </button>
              </span>
            )}
          </div>
        </div>

        {/* Security & Guest Clarification */}
        <div className="p-4 rounded-xl bg-white border border-[#E5DDD0] space-y-2 text-xs text-[#57504A]">
          <div className="flex items-center gap-2 font-semibold text-[#1E1B18]">
            <ShieldCheck className="w-4 h-4 text-[#0070BA]" />
            <span>Guest Checkout is Always Welcome</span>
          </div>
          <p className="leading-relaxed">
            You do not need to create an account or sign in to bargain with makers or complete your
            PayPal purchase. Accounts are optional for saving past negotiated holds and receipts.
          </p>
        </div>
      </div>
    </div>
  );
};
