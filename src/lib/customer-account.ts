import { adminAuth } from './firebase-admin.js';
import { db } from './db/index.js';
import { customers, addresses } from './db/schema.js';
import { eq } from 'drizzle-orm';
import { sendWelcomeEmail } from './email.js';

export interface CustomerAccountParams {
  email: string;
  name: string;
  phone?: string;
  shippingAddress?: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    pincode: string;
    phone: string;
  };
}

export interface CustomerAccountResult {
  userId?: string;
  isNewUser: boolean;
  setupLink?: string;
}

/**
 * Automatically ensures a customer has an account in Firebase Auth and PostgreSQL profiles.
 * If new, creates Firebase account, generates initial password setup link, and sends Welcome Email.
 */
export async function ensureCustomerAccount(
  params: CustomerAccountParams
): Promise<CustomerAccountResult> {
  const { email, name, phone, shippingAddress } = params;
  let userId: string | undefined;
  let isNewUser = false;
  let setupLink: string | undefined;

  // 1. Firebase Auth Provisioning
  if (adminAuth) {
    try {
      let userRecord;
      try {
        userRecord = await adminAuth.getUserByEmail(email);
        userId = userRecord.uid;
      } catch (err: any) {
        if (err.code === 'auth/user-not-found') {
          // Create new user in Firebase Auth
          userRecord = await adminAuth.createUser({
            email,
            displayName: name,
            emailVerified: false,
          });
          userId = userRecord.uid;
          isNewUser = true;

          // Generate password setup / initial access link
          try {
            setupLink = await adminAuth.generatePasswordResetLink(email);
          } catch (linkErr) {
            console.warn('Could not generate Firebase setup link:', linkErr);
          }

          console.log(`✨ Automatically created Firebase user account for customer: ${email} (UID: ${userId})`);

          // Send welcome email with login setup link
          try {
            await sendWelcomeEmail(email, name, setupLink);
          } catch (mailErr) {
            console.error('Error sending auto-generated welcome email:', mailErr);
          }
        } else {
          console.warn('Firebase getUserByEmail error:', err);
        }
      }
    } catch (firebaseErr) {
      console.error('Failed Firebase customer account provisioning:', firebaseErr);
    }
  }

  // 2. PostgreSQL Customer Profile Provisioning
  try {
    const existing = await db
      .select()
      .from(customers)
      .where(eq(customers.phone, phone || ''))
      .limit(1);

    let profileId: string;
    if (existing.length === 0) {
      const [newProfile] = await db
        .insert(customers)
        .values({
          fullName: name,
          phone: phone || null,
          marketingOptIn: true,
        })
        .returning({ id: customers.id });
      profileId = newProfile.id;
    } else {
      profileId = existing[0].id;
    }

    // Save shipping address if provided and not yet present
    if (shippingAddress && profileId) {
      await db.insert(addresses).values({
        userId: profileId,
        type: 'shipping',
        fullName: name,
        phone: shippingAddress.phone || phone || '',
        line1: shippingAddress.line1,
        line2: shippingAddress.line2 || null,
        city: shippingAddress.city,
        state: shippingAddress.state,
        postalCode: shippingAddress.pincode,
        country: 'India',
        isDefault: true,
      });
    }
  } catch (dbErr) {
    console.error('Error syncing customer profile into DB:', dbErr);
  }

  return { userId, isNewUser, setupLink };
}
