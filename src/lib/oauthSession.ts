import crypto from 'node:crypto';
import type { Request } from 'express';

export interface SessionUser {
  uid: string;
  email: string;
  name: string;
  role: 'shopper' | 'maker';
  photoUrl?: string;
}

export interface OAuthStatePayload {
  nonce: string;
  role: 'shopper' | 'maker';
  mode: 'signin' | 'signup';
  returnTo: string;
}

// Public OAuth Client ID (non-secret identifier safe for frontend Google Identity Services)
export const DEFAULT_PUBLIC_GOOGLE_CLIENT_ID =
  '2154458695-g2mdcnndm88rakfn07hk35vec1sk49er.apps.googleusercontent.com';

export function getPublicGoogleClientId(): string {
  const envId =
    process.env.GOOGLE_CLIENT_ID?.trim() ||
    process.env.VITE_GOOGLE_CLIENT_ID?.trim() ||
    '';
  if (envId && envId !== 'YOUR_GOOGLE_OAUTH_CLIENT_ID' && envId !== 'YOUR_GOOGLE_CLIENT_ID') {
    return envId;
  }
  return DEFAULT_PUBLIC_GOOGLE_CLIENT_ID;
}

export function getGoogleOAuthCredentials(): { clientId: string; clientSecret: string } | null {
  const clientId = getPublicGoogleClientId();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() || '';
  if (!clientId || !clientSecret || clientSecret === 'YOUR_GOOGLE_OAUTH_CLIENT_SECRET') {
    return null;
  }
  return { clientId, clientSecret };
}

export function hasDirectGoogleOAuthConfig(): boolean {
  return getGoogleOAuthCredentials() !== null;
}

/**
 * Derives a consistent 32-byte HMAC key across serverless instances without
 * leaking underlying credentials.
 */
export function getSessionSecret(): Buffer {
  const rawSeed =
    process.env.AUTH_SESSION_SECRET?.trim() ||
    process.env.GOOGLE_CLIENT_SECRET?.trim() ||
    process.env.PAYPAL_CLIENT_SECRET?.trim() ||
    'haggle-local-development-session-seed';
  return crypto.createHash('sha256').update(`haggle-auth:${rawSeed}`).digest();
}

export function parseCookies(cookieHeader?: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;

  for (const part of cookieHeader.split(';')) {
    const eqIndex = part.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = part.slice(0, eqIndex).trim();
    const rawValue = part.slice(eqIndex + 1).trim();
    try {
      result[key] = decodeURIComponent(rawValue);
    } catch {
      result[key] = rawValue;
    }
  }
  return result;
}

export function signToken<T extends object>(payload: T, ttlSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + ttlSeconds,
  };
  const body = Buffer.from(JSON.stringify(fullPayload), 'utf-8').toString('base64url');
  const sig = crypto.createHmac('sha256', getSessionSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifySignedToken<T extends object>(
  token: string | undefined | null
): (T & { iat: number; exp: number }) | null {
  if (!token || typeof token !== 'string') return null;
  const dotIndex = token.indexOf('.');
  if (dotIndex <= 0 || dotIndex !== token.lastIndexOf('.')) return null;

  const body = token.slice(0, dotIndex);
  const providedSig = token.slice(dotIndex + 1);
  if (!body || !providedSig) return null;

  const expectedSig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(body)
    .digest('base64url');

  const providedBuf = Buffer.from(providedSig, 'utf-8');
  const expectedBuf = Buffer.from(expectedSig, 'utf-8');
  if (providedBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(providedBuf, expectedBuf)) return null;

  try {
    const decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8')) as T & {
      iat: number;
      exp: number;
    };
    const now = Math.floor(Date.now() / 1000);
    if (typeof decoded.exp !== 'number' || decoded.exp <= now) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

/** Ensures redirect target stays on-origin to prevent open-redirect attacks. */
export function sanitizeReturnTo(raw: unknown): string {
  if (typeof raw !== 'string') return '/';
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes('\\')) {
    return '/';
  }
  return trimmed;
}

export function resolvePublicOrigin(req: Request): string {
  const forwardedHost = (req.headers['x-forwarded-host'] as string)?.split(',')[0]?.trim();
  const hostHeader = forwardedHost || req.get('host');
  const forwardedProto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim();

  if (hostHeader) {
    const isLocalHost = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(hostHeader);
    const proto = forwardedProto || (isLocalHost ? 'http' : 'https');
    return `${proto}://${hostHeader}`;
  }

  const appUrl = process.env.APP_URL?.trim();
  if (appUrl && /^https?:\/\//i.test(appUrl)) {
    return appUrl.replace(/\/+$/, '');
  }

  return 'http://localhost:3000';
}

export function resolveGoogleRedirectUri(req: Request): string {
  const explicit = process.env.GOOGLE_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  return resolvePublicOrigin(req);
}

export function isSecureRequest(req: Request): boolean {
  const forwardedProto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim();
  if (forwardedProto) return forwardedProto === 'https';
  return req.secure;
}

