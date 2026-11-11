import type { Request, Response, NextFunction } from 'express';
import { verifyFirebaseIdToken } from '../lib/firebase-admin';
import {
  parseCookies,
  verifySignedToken,
  type SessionUser,
} from '../lib/oauthSession';

export interface AuthUser {
  uid: string;
  email?: string;
  name?: string;
  picture?: string;
  role?: 'shopper' | 'maker';
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

async function resolveAuthenticatedUser(req: Request): Promise<AuthUser | null> {
  const authHeader = req.headers.authorization;
  const bearerToken =
    authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length).trim()
      : null;

  if (bearerToken) {
    // 1a. Try signed Haggle OAuth session token first
    const sessionUser = verifySignedToken<SessionUser>(bearerToken);
    if (sessionUser?.uid) {
      return {
        uid: sessionUser.uid,
        email: sessionUser.email,
        name: sessionUser.name,
        picture: sessionUser.photoUrl,
        role: sessionUser.role,
      };
    }

    // 1b. Fall back to Firebase ID token verification (lazy-loaded / Identity Toolkit safe)
    return verifyFirebaseIdToken(bearerToken);
  }

  // 2. Check HttpOnly session cookie (used by Google OAuth 2.0 redirect flow)
  const cookies = parseCookies(req.headers.cookie);
  const cookieUser = verifySignedToken<SessionUser>(cookies.haggle_session);
  if (cookieUser?.uid) {
    return {
      uid: cookieUser.uid,
      email: cookieUser.email,
      name: cookieUser.name,
      picture: cookieUser.photoUrl,
      role: cookieUser.role,
    };
  }

  return null;
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const user = await resolveAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized: Missing or invalid authentication token' });
    return;
  }
  req.user = user;
  next();
};

export const optionalAuth = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction
) => {
  const user = await resolveAuthenticatedUser(req);
  if (user) {
    req.user = user;
  }
  next();
};
