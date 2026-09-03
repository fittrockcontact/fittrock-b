import { adminAuth } from './firebase-admin.js';
import { db } from './db/index.js';
import { customers, addresses } from './db/schema.js';
import { supabaseClient } from './db/supabase.js';
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
  addressId?: string;
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
  let addressId: string | undefined;
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

  // 2. Supabase / PostgreSQL Customer Profile & Address Provisioning
  try {
    if (supabaseClient) {
      // 1. Ensure user exists in Supabase Auth to satisfy profiles.id FK
      let supabaseUserId: string | null = null;
      if (email) {
        const { data: userData, error: userError } = await supabaseClient.auth.admin.createUser({
          email: email.trim().toLowerCase(),
          email_confirm: true,
          user_metadata: { full_name: name },
        });

        if (userData?.user?.id) {
          supabaseUserId = userData.user.id;
          isNewUser = true;
        } else if (userError) {
          const { data: listData } = await supabaseClient.auth.admin.listUsers();
          const found = listData?.users?.find((u) => u.email?.toLowerCase() === email.trim().toLowerCase());
          if (found) supabaseUserId = found.id;
        }
      }

      if (!userId && supabaseUserId) {
        userId = supabaseUserId;
      }

      if (supabaseUserId) {
        // Upsert into profiles
        const { data: prof } = await supabaseClient
          .from('profiles')
          .upsert({
            id: supabaseUserId,
            full_name: name,
            phone: phone || null,
            marketing_opt_in: true,
            updated_at: new Date().toISOString(),
          })
          .select()
          .single();

        const profileId = prof?.id || supabaseUserId;

        // Save shipping address if provided
        if (shippingAddress && profileId) {
          // Unset other default addresses for clean state
          await supabaseClient
            .from('addresses')
            .update({ is_default: false })
            .eq('user_id', profileId);

          const { data: insertedAddr } = await supabaseClient.from('addresses').insert({
            user_id: profileId,
            type: 'shipping',
            full_name: name,
            phone: shippingAddress.phone || phone || '',
            line1: shippingAddress.line1,
            line2: shippingAddress.line2 || null,
            city: shippingAddress.city,
            state: shippingAddress.state,
            postal_code: shippingAddress.pincode,
            country: 'India',
            is_default: true,
          }).select('id').single();

          if (insertedAddr?.id) {
            addressId = insertedAddr.id;
          }
        }

        if (!addressId && profileId) {
          const { data: existingAddr } = await supabaseClient
            .from('addresses')
            .select('id')
            .eq('user_id', profileId)
            .order('is_default', { ascending: false })
            .limit(1);
          if (existingAddr?.[0]?.id) {
            addressId = existingAddr[0].id;
          }
        }

        // If new user and no Firebase setup link was generated, send general welcome email
        if (isNewUser && !setupLink) {
          try {
            await sendWelcomeEmail(email, name);
          } catch (mailErr) {
            console.warn('Welcome email notice:', mailErr);
          }
        }
      }
    } else {
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
        const [newAddr] = await db.insert(addresses).values({
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
        }).returning({ id: addresses.id });
        if (newAddr?.id) {
          addressId = newAddr.id;
        }
      }
    }
  } catch (dbErr) {
    console.warn('Customer profile sync note (non-critical):', dbErr);
  }

  return { userId, addressId, isNewUser, setupLink };
}
