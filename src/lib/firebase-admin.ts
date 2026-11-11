import fs from 'node:fs';
import path from 'node:path';

export interface VerifiedFirebaseToken {
  uid: string;
  email?: string;
  name?: string;
  picture?: string;
}

function readAppletConfig(): { projectId?: string; apiKey?: string } {
  try {
    const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
        projectId?: string;
        apiKey?: string;
      };
    }
  } catch {
    // Fallback for bundled serverless runtimes
  }
  return {};
}

export function resolveFirebaseProjectId(): string {
  return (
    process.env.FIREBASE_PROJECT_ID?.trim() ||
    process.env.VITE_FIREBASE_PROJECT_ID?.trim() ||
    readAppletConfig().projectId ||
    'igneous-empire-8bvhw'
  );
}

function resolveFirebaseApiKey(): string | null {
  return (
    process.env.FIREBASE_WEB_API_KEY?.trim() ||
    process.env.VITE_FIREBASE_API_KEY?.trim() ||
    readAppletConfig().apiKey ||
    null
  );
}

/**
 * Verifies a Firebase ID token lazily without top-level `firebase-admin` imports
 * (prevents Node 20 ESM `ERR_REQUIRE_ESM` crashes in serverless environments).
 */
export async function verifyFirebaseIdToken(
  token: string
): Promise<VerifiedFirebaseToken | null> {
  try {
    const { initializeApp, getApps } = await import('firebase-admin/app');
    const { getAuth } = await import('firebase-admin/auth');
    if (!getApps().length) {
      initializeApp({ projectId: resolveFirebaseProjectId() });
    }
    const decoded = await getAuth().verifyIdToken(token);
    return {
      uid: decoded.uid,
      email: decoded.email,
      name: typeof decoded.name === 'string' ? decoded.name : undefined,
      picture: decoded.picture,
    };
  } catch {
    // Fallback to Identity Toolkit token lookup when runtime ESM constraints or missing ADC occur
    const apiKey = resolveFirebaseApiKey();
    if (!apiKey) return null;

    try {
      const res = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken: token }),
        }
      );
      if (!res.ok) return null;
      const json = (await res.json()) as {
        users?: Array<{
          localId?: string;
          email?: string;
          displayName?: string;
          photoUrl?: string;
        }>;
      };
      const user = json.users?.[0];
      if (!user?.localId) return null;
      return {
        uid: user.localId,
        email: user.email,
        name: user.displayName,
        picture: user.photoUrl,
      };
    } catch {
      return null;
    }
  }
}
