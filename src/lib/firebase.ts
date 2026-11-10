import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import defaultConfig from '../../firebase-applet-config.json';

const env = import.meta.env;

const firebaseConfig = {
  ...defaultConfig,
  ...(env.VITE_FIREBASE_API_KEY ? { apiKey: env.VITE_FIREBASE_API_KEY } : {}),
  ...(env.VITE_FIREBASE_AUTH_DOMAIN ? { authDomain: env.VITE_FIREBASE_AUTH_DOMAIN } : {}),
  ...(env.VITE_FIREBASE_PROJECT_ID ? { projectId: env.VITE_FIREBASE_PROJECT_ID } : {}),
  ...(env.VITE_FIREBASE_STORAGE_BUCKET
    ? { storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET }
    : {}),
  ...(env.VITE_FIREBASE_MESSAGING_SENDER_ID
    ? { messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID }
    : {}),
  ...(env.VITE_FIREBASE_APP_ID ? { appId: env.VITE_FIREBASE_APP_ID } : {}),
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleAuthProvider = new GoogleAuthProvider();
googleAuthProvider.setCustomParameters({ prompt: 'select_account' });

export const activeFirebaseProjectId = firebaseConfig.projectId;
export const activeFirebaseAuthDomain = firebaseConfig.authDomain;
