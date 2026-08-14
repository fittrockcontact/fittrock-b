import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { getAuth, Auth } from 'firebase-admin/auth';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

let adminApp: App | null = null;
let adminAuth: Auth | null = null;
let adminDb: Firestore | null = null;

try {
  const projectId = process.env.FIREBASE_PROJECT_ID || 'fittrock';

  if (!getApps().length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
      adminApp = initializeApp({
        credential: cert(serviceAccount),
        projectId,
      });
    } else {
      adminApp = initializeApp({
        projectId,
      });
    }
    console.log(`🔥 Firebase Admin SDK initialized for project: ${projectId}`);
  } else {
    adminApp = getApps()[0];
  }

  adminAuth = getAuth(adminApp);
  adminDb = getFirestore(adminApp);
} catch (error) {
  console.warn('⚠️ Firebase Admin SDK initialization warning:', error);
}

export { adminApp, adminAuth, adminDb };
