import { Request, Response, NextFunction } from 'express';
import { adminAuth } from '../lib/firebase-admin.js';

export const ADMIN_EMAILS = [
  'fittrock.contact@gmail.com',
  'trishuldn@gmail.com',
  'ganeshdevkate@gmail.com',
];

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  const envAdmins = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  const allAdmins = [...ADMIN_EMAILS.map((e) => e.toLowerCase()), ...envAdmins];
  return allAdmins.includes(normalized);
}

export interface AuthenticatedRequest extends Request {
  user?: {
    uid: string;
    email?: string;
    name?: string;
    picture?: string;
    [key: string]: any;
  };
}

/**
 * Middleware that requires a valid Firebase ID token in Authorization header
 */
export async function requireFirebaseAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
  }

  const idToken = authHeader.split('Bearer ')[1].trim();

  if (!adminAuth) {
    console.warn('Firebase Admin is not initialized, skipping token verification in dev');
    return next();
  }

  try {
    const decodedToken = await adminAuth.verifyIdToken(idToken);
    req.user = {
      ...decodedToken,
      uid: decodedToken.uid,
      email: decodedToken.email,
      name: decodedToken.name,
      picture: decodedToken.picture,
    };
    next();
  } catch (err: any) {
    console.error('Firebase token verification error:', err.message);
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
}

/**
 * Middleware that enforces both valid Firebase Auth and Admin Email Whitelist
 */
export async function requireAdminAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;

  // Allow server-to-server calls with secret bypass if configured
  const apiKey = req.headers['x-admin-key'] as string;
  if (apiKey && process.env.ADMIN_SECRET_KEY && apiKey === process.env.ADMIN_SECRET_KEY) {
    return next();
  }

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Administrator authentication required' });
  }

  const idToken = authHeader.split('Bearer ')[1].trim();

  if (!adminAuth) {
    console.warn('Firebase Admin is not initialized, skipping admin token verification in dev');
    return next();
  }

  try {
    const decodedToken = await adminAuth.verifyIdToken(idToken);
    const email = decodedToken.email;

    if (!isAdminEmail(email)) {
      console.warn(`Unauthorized admin access attempt from: ${email}`);
      return res.status(403).json({
        error: `Forbidden: Account ${email} is not authorized for administrator access.`,
      });
    }

    req.user = {
      ...decodedToken,
      uid: decodedToken.uid,
      email: decodedToken.email,
      name: decodedToken.name,
      picture: decodedToken.picture,
    };
    next();
  } catch (err: any) {
    console.error('Admin token verification error:', err.message);
    return res.status(401).json({ error: 'Unauthorized: Invalid admin token' });
  }
}

/**
 * Optional Firebase Auth middleware: attaches user if token is present and valid
 */
export async function optionalFirebaseAuth(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ') && adminAuth) {
    const idToken = authHeader.split('Bearer ')[1].trim();
    try {
      const decodedToken = await adminAuth.verifyIdToken(idToken);
      req.user = {
        ...decodedToken,
        uid: decodedToken.uid,
        email: decodedToken.email,
        name: decodedToken.name,
        picture: decodedToken.picture,
      };
    } catch {
      // Ignore errors for optional auth
    }
  }
  next();
}
