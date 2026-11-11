import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  signToken,
  verifySignedToken,
  parseCookies,
  sanitizeReturnTo,
  resolvePublicOrigin,
  resolveGoogleRedirectUri,
  type SessionUser,
} from './oauthSession';
import { createApiApp } from '../../server';

test('signToken and verifySignedToken validate integrity and expiry', () => {
  const user: SessionUser = {
    uid: 'google-12345',
    email: 'artisan@example.com',
    name: 'Artisan Studio',
    role: 'maker',
  };

  const token = signToken(user, 300);
  const decoded = verifySignedToken<SessionUser>(token);
  assert.ok(decoded);
  assert.equal(decoded.uid, 'google-12345');
  assert.equal(decoded.email, 'artisan@example.com');
  assert.equal(decoded.role, 'maker');

  // Tampering breaks signature
  const tampered = `${token.slice(0, -4)}zzzz`;
  assert.equal(verifySignedToken(tampered), null);

  // Expired token is rejected
  const expired = signToken(user, -10);
  assert.equal(verifySignedToken(expired), null);
});

test('parseCookies decodes cookie header values', () => {
  const parsed = parseCookies('foo=bar; haggle_session=abc%2E123; theme=dark');
  assert.equal(parsed.foo, 'bar');
  assert.equal(parsed.haggle_session, 'abc.123');
  assert.equal(parsed.theme, 'dark');
  assert.deepEqual(parseCookies(undefined), {});
});

test('sanitizeReturnTo prevents open redirects and preserves local paths', () => {
  assert.equal(sanitizeReturnTo('/seller'), '/seller');
  assert.equal(sanitizeReturnTo('/items/item-cognac-boot?sessionId=abc'), '/items/item-cognac-boot?sessionId=abc');
  assert.equal(sanitizeReturnTo('https://evil.com/phish'), '/');
  assert.equal(sanitizeReturnTo('//evil.com'), '/');
  assert.equal(sanitizeReturnTo('/\\evil.com'), '/');
  assert.equal(sanitizeReturnTo(undefined), '/');
});

test('resolvePublicOrigin and resolveGoogleRedirectUri honor forwarded Vercel headers', () => {
  const mockVercelReq = {
    headers: {
      'x-forwarded-host': 'haggle-market.vercel.app',
      'x-forwarded-proto': 'https',
    },
    get: () => 'haggle-market.vercel.app',
  } as unknown as Parameters<typeof resolvePublicOrigin>[0];

  assert.equal(resolvePublicOrigin(mockVercelReq), 'https://haggle-market.vercel.app');
  assert.equal(resolveGoogleRedirectUri(mockVercelReq), 'https://haggle-market.vercel.app');
});

test('Express auth session & sync endpoints accept signed Haggle OAuth session', async () => {
  const app = createApiApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));

  try {
    const port = (server.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    // 1. /api/auth/providers returns expected shape
    const provRes = await fetch(`${baseUrl}/api/auth/providers`);
    assert.equal(provRes.status, 200);
    const provJson = (await provRes.json()) as {
      directGoogleEnabled: boolean;
      googleClientId: string;
      redirectUri: string;
    };
    assert.equal(typeof provJson.directGoogleEnabled, 'boolean');
    assert.ok(provJson.googleClientId.endsWith('.apps.googleusercontent.com'));
    assert.ok(provJson.redirectUri.startsWith('http://127.0.0.1:'));

    // 1b. /api/auth/google/verify rejects missing credentials cleanly
    const missingVerifyRes = await fetch(`${baseUrl}/api/auth/google/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'shopper' }),
    });
    assert.equal(missingVerifyRes.status, 400);

    // 2. /api/auth/session unauthenticated by default
    const anonRes = await fetch(`${baseUrl}/api/auth/session`);
    assert.equal(anonRes.status, 200);
    const anonJson = (await anonRes.json()) as { authenticated: boolean; user: unknown };
    assert.equal(anonJson.authenticated, false);
    assert.equal(anonJson.user, null);

    // 3. Valid signed session cookie authenticates /api/auth/session & /api/auth/sync
    const sessionToken = signToken<SessionUser>(
      {
        uid: 'google-987654',
        email: 'shopper.google@example.com',
        name: 'Google Shopper',
        role: 'shopper',
      },
      300
    );

    const sessionRes = await fetch(`${baseUrl}/api/auth/session`, {
      headers: { Cookie: `haggle_session=${encodeURIComponent(sessionToken)}` },
    });
    assert.equal(sessionRes.status, 200);
    const sessionJson = (await sessionRes.json()) as {
      authenticated: boolean;
      user: { email: string; name: string };
    };
    assert.equal(sessionJson.authenticated, true);
    assert.equal(sessionJson.user.email, 'shopper.google@example.com');

    const syncRes = await fetch(`${baseUrl}/api/auth/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
    });
    assert.equal(syncRes.status, 200);
    const syncJson = (await syncRes.json()) as { user: { uid: string; email: string } };
    assert.equal(syncJson.user.uid, 'google-987654');
    assert.equal(syncJson.user.email, 'shopper.google@example.com');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

