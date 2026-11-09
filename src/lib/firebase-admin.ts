import fs from 'node:fs';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

function resolveProjectId(): string {
  if (process.env.FIREBASE_PROJECT_ID) {
    return process.env.FIREBASE_PROJECT_ID;
  }
  try {
    const configUrl = new URL('../../firebase-applet-config.json', import.meta.url);
    const parsed = JSON.parse(fs.readFileSync(configUrl, 'utf-8')) as {
      projectId?: string;
    };
    if (parsed.projectId) return parsed.projectId;
  } catch {
    // Fallback for bundled serverless environments (e.g. Vercel)
  }
  return 'igneous-empire-8bvhw';
}

if (!getApps().length) {
  initializeApp({
    projectId: resolveProjectId(),
  });
}

export const adminAuth = getAuth();
