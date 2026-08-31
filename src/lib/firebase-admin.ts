import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { getAuth, Auth } from 'firebase-admin/auth';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

let adminApp: App | null = null;
let adminAuth: Auth | null = null;
let adminDb: Firestore | null = null;

try {
  const projectId = process.env.FIREBASE_PROJECT_ID || 'fittrock';
  const hasServiceAccount = !!process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

  if (!getApps().length) {
    if (hasServiceAccount) {
      try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY!);
        adminApp = initializeApp({
          credential: cert(serviceAccount),
          projectId,
        });
        adminAuth = getAuth(adminApp);
        adminDb = getFirestore(adminApp);
        console.log(`🔥 Firebase Admin SDK initialized with Service Account for project: ${projectId}`);
      } catch (err) {
        console.warn('⚠️ Invalid FIREBASE_SERVICE_ACCOUNT_KEY format, skipping Firebase Admin:', err);
      }
    } else {
      // Without service account key, admin Auth operations will fail with insufficient permissions
      console.log('ℹ️ FIREBASE_SERVICE_ACCOUNT_KEY not set — using Supabase for user provisioning');
    }
  } else {
    adminApp = getApps()[0];
    if (hasServiceAccount) {
      adminAuth = getAuth(adminApp);
      adminDb = getFirestore(adminApp);
    }
  }
} catch (error) {
  console.warn('⚠️ Firebase Admin SDK initialization warning:', error);
}

export { adminApp, adminAuth, adminDb };
