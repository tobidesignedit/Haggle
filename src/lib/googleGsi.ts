import type { AuthUserProfile } from '../components/LoginPage';

export const DEFAULT_GOOGLE_CLIENT_ID =
  '2154458695-g2mdcnndm88rakfn07hk35vec1sk49er.apps.googleusercontent.com';

interface GoogleAccountsIdApi {
  initialize: (config: {
    client_id: string;
    callback: (response: { credential?: string }) => void;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
    ux_mode?: 'popup' | 'redirect';
  }) => void;
  renderButton: (
    parent: HTMLElement,
    options: {
      theme?: 'outline' | 'filled_blue' | 'filled_black';
      size?: 'large' | 'medium' | 'small';
      text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
      shape?: 'rectangular' | 'pill' | 'circle' | 'square';
      width?: number | string;
      logo_alignment?: 'left' | 'center';
    }
  ) => void;
}

interface GoogleAccountsOAuth2Api {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    callback: (response: { access_token?: string; error?: string; error_description?: string }) => void;
    error_callback?: (error: { type?: string; message?: string }) => void;
  }) => {
    requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
  };
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: GoogleAccountsIdApi;
        oauth2?: GoogleAccountsOAuth2Api;
      };
    };
  }
}

let gsiScriptPromise: Promise<boolean> | null = null;

/** Lazily loads Google Identity Services once and caches the promise. */
export function loadGoogleGsiScript(): Promise<boolean> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.resolve(false);
  }
  if (window.google?.accounts?.id || window.google?.accounts?.oauth2) {
    return Promise.resolve(true);
  }
  if (gsiScriptPromise) return gsiScriptPromise;

  gsiScriptPromise = new Promise<boolean>((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src^="https://accounts.google.com/gsi/client"]'
    );
    if (existing) {
      const checkInterval = window.setInterval(() => {
        if (window.google?.accounts?.id || window.google?.accounts?.oauth2) {
          window.clearInterval(checkInterval);
          resolve(true);
        }
      }, 50);
      window.setTimeout(() => {
        window.clearInterval(checkInterval);
        resolve(Boolean(window.google?.accounts?.id || window.google?.accounts?.oauth2));
      }, 5000);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(Boolean(window.google?.accounts));
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });

  return gsiScriptPromise;
}

export async function verifyGoogleCredentialWithServer(params: {
  credential?: string;
  accessToken?: string;
  role: 'shopper' | 'maker';
}): Promise<{ user: AuthUserProfile; token: string }> {
  const res = await fetch('/api/auth/google/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  const data = (await res.json().catch(() => null)) as {
    authenticated?: boolean;
    user?: AuthUserProfile;
    token?: string;
    error?: string;
  } | null;

  if (!res.ok || !data?.authenticated || !data.user || !data.token) {
    throw new Error(data?.error || 'Could not verify Google account with server.');
  }

  return { user: data.user, token: data.token };
}
