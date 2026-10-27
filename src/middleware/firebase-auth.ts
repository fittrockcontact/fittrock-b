import { Request, Response, NextFunction } from 'express';
import { tokenAuth } from '../lib/firebase-admin.js';

export const ADMIN_EMAILS = [
  'fittrock.contact@gmail.com',
  'trishuldn@gmail.com',
  'ganeshdevkate@gmail.com',
];

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  const allAdmins = [...ADMIN_EMAILS.map((e) => e.toLowerCase()), ...envEmails('ADMIN_EMAILS')];
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

function envEmails(name: string): string[] {
  return (process.env[name] || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Sales reps listed in the SALES_EMAILS env var (comma-separated).
 * Admins always have sales access too.
 */
export function isSalesEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return isAdminEmail(normalized) || envEmails('SALES_EMAILS').includes(normalized);
}

function attachUser(req: AuthenticatedRequest, decodedToken: Record<string, any>) {
  req.user = {
    ...decodedToken,
    uid: decodedToken.uid,
    email: decodedToken.email,
    name: decodedToken.name,
    picture: decodedToken.picture,
  };
}

/**
 * Builds a middleware that verifies the Firebase ID token in the
 * Authorization header and, if given, checks the account's email.
 * Fails closed: if tokens cannot be verified, the request is rejected.
 */
function requireVerifiedUser(isAllowed?: (email: string | undefined) => boolean, area = 'this area') {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
    }

    if (!tokenAuth) {
      console.error('Firebase token verifier is not available; rejecting request');
      return res.status(503).json({ error: 'Authentication is temporarily unavailable' });
    }

    const idToken = authHeader.split('Bearer ')[1].trim();

    let decodedToken;
    try {
      decodedToken = await tokenAuth.verifyIdToken(idToken);
    } catch (err: any) {
      console.error('Firebase token verification error:', err.message);
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }

    if (isAllowed && !isAllowed(decodedToken.email)) {
      console.warn(`Unauthorized access attempt to ${area} from: ${decodedToken.email}`);
      return res.status(403).json({
        error: `Forbidden: Account ${decodedToken.email} is not authorized for ${area}.`,
      });
    }

    attachUser(req, decodedToken);
    next();
  };
}

/**
 * Middleware that requires a valid Firebase ID token in Authorization header
 */
export const requireFirebaseAuth = requireVerifiedUser();

const verifyAdmin = requireVerifiedUser(isAdminEmail, 'administrator access');

/**
 * Middleware that enforces both valid Firebase Auth and Admin Email Whitelist
 */
export async function requireAdminAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  // Allow server-to-server calls with secret bypass if configured
  const apiKey = req.headers['x-admin-key'] as string;
  if (apiKey && process.env.ADMIN_SECRET_KEY && apiKey === process.env.ADMIN_SECRET_KEY) {
    return next();
  }
  return verifyAdmin(req, res, next);
}

/**
 * Middleware for the sales dashboard: admins plus SALES_EMAILS accounts
 */
export const requireSalesAuth = requireVerifiedUser(isSalesEmail, 'the sales dashboard');

/**
 * Optional Firebase Auth middleware: attaches user if token is present and valid
 */
export async function optionalFirebaseAuth(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ') && tokenAuth) {
    const idToken = authHeader.split('Bearer ')[1].trim();
    try {
      attachUser(req, await tokenAuth.verifyIdToken(idToken));
    } catch {
      // Ignore errors for optional auth
    }
  }
  next();
}
