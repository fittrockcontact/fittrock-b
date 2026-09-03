import { Router, Request, Response } from 'express';
import { supabaseClient } from '../lib/db/supabase.js';
import { db } from '../lib/db/index.js';
import { customers, addresses, orders, orderItems } from '../lib/db/schema.js';
import { eq, desc } from 'drizzle-orm';

const router = Router();

/**
 * POST /api/customers/sync
 * Syncs user upon Firebase / Google / Email sign-in into the PostgreSQL profiles table
 */
router.post('/sync', async (req: Request, res: Response) => {
  try {
    const { email, fullName, avatarUrl, phone } = req.body;

    if (!email && !phone) {
      return res.status(400).json({ error: 'Email or phone is required for profile sync' });
    }

    let profile: any = null;

    if (supabaseClient) {
      let userId: string | null = null;

      // Ensure Supabase auth user exists for foreign key constraint
      if (email) {
        const { data: userData, error: userError } = await supabaseClient.auth.admin.createUser({
          email: email.trim().toLowerCase(),
          email_confirm: true,
          user_metadata: { full_name: fullName },
        });

        if (userData?.user?.id) {
          userId = userData.user.id;
        } else if (userError) {
          // If already exists, find user ID
          const { data: listData } = await supabaseClient.auth.admin.listUsers();
          const found = listData?.users?.find((u) => u.email?.toLowerCase() === email.trim().toLowerCase());
          if (found) {
            userId = found.id;
          }
        }
      }

      if (userId) {
        // Upsert into profiles
        const { data: upserted, error: upsertErr } = await supabaseClient
          .from('profiles')
          .upsert({
            id: userId,
            full_name: fullName || email?.split('@')[0] || 'Fittrock Customer',
            phone: phone || null,
            avatar_url: avatarUrl || null,
            marketing_opt_in: true,
            updated_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (upsertErr) {
          console.warn('Profile upsert warning:', upsertErr);
        } else {
          profile = upserted;
        }
      }
    }

    return res.json({
      success: true,
      profile,
      message: 'Profile synchronized successfully',
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Customer sync failed';
    console.error('Customer sync error:', err);
    return res.status(500).json({ error: errorMsg });
  }
});

/**
 * GET /api/customers/me
 * Retrieves profile and saved addresses for a customer by query param (phone or name or id)
 */
router.get('/me', async (req: Request, res: Response) => {
  try {
    const { id, phone, name } = req.query;

    if (!supabaseClient) {
      return res.json({ profile: null, addresses: [] });
    }

    let profile: any = null;
    if (id) {
      const { data } = await supabaseClient.from('profiles').select('*').eq('id', String(id)).single();
      profile = data;
    } else if (phone) {
      const { data } = await supabaseClient.from('profiles').select('*').eq('phone', String(phone)).limit(1);
      profile = data?.[0];
    } else if (name) {
      const { data } = await supabaseClient.from('profiles').select('*').eq('full_name', String(name)).limit(1);
      profile = data?.[0];
    }

    let userAddresses: any[] = [];
    if (profile?.id) {
      const { data: addr } = await supabaseClient
        .from('addresses')
        .select('*')
        .eq('user_id', profile.id)
        .order('is_default', { ascending: false });
      userAddresses = addr || [];
    }

    return res.json({ profile, addresses: userAddresses });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Failed to fetch customer profile';
    return res.status(500).json({ error: errorMsg });
  }
});

/**
 * PUT /api/customers/profile
 * Updates customer profile details (name, phone, GST, business info)
 */
router.put('/profile', async (req: Request, res: Response) => {
  try {
    const { id, fullName, phone, avatarUrl, isBusiness, gstNumber, businessName } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'Customer ID is required' });
    }

    if (!supabaseClient) {
      return res.json({ success: true, message: 'Updated' });
    }

    const { data, error } = await supabaseClient
      .from('profiles')
      .update({
        full_name: fullName,
        phone: phone || null,
        avatar_url: avatarUrl || null,
        is_business: !!isBusiness,
        gst_number: gstNumber || null,
        business_name: businessName || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json({ success: true, profile: data });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Failed to update customer profile';
    return res.status(500).json({ error: errorMsg });
  }
});

/**
 * GET /api/customers/orders
 * Returns customer's real order history with items
 */
router.get('/orders', async (req: Request, res: Response) => {
  try {
    const { userId, phone } = req.query;

    if (!supabaseClient) {
      return res.json({ orders: [] });
    }

    let customerId = userId ? String(userId) : null;

    if (!customerId && phone) {
      const { data: prof } = await supabaseClient.from('profiles').select('id').eq('phone', String(phone)).limit(1);
      customerId = prof?.[0]?.id || null;
    }

    if (!customerId) {
      return res.json({ orders: [] });
    }

    const { data: userOrders, error: ordErr } = await supabaseClient
      .from('orders')
      .select('*, shipping_address:addresses!orders_shipping_address_id_fkey(*)')
      .eq('user_id', customerId)
      .order('placed_at', { ascending: false });

    if (ordErr) {
      console.warn('Orders fetch error:', ordErr);
      return res.json({ orders: [] });
    }

    // Attach order items and normalize rupee amounts
    const ordersWithItems = await Promise.all(
      (userOrders || []).map(async (ord: any) => {
        const { data: items } = await supabaseClient!
          .from('order_items')
          .select('*')
          .eq('order_id', ord.id);

        const { data: shipments } = await supabaseClient!
          .from('shipments')
          .select('*')
          .eq('order_id', ord.id)
          .order('created_at', { ascending: false });

        const rawTotal = parseFloat(ord.total_amount || '0');
        const totalRupees = rawTotal >= 10000 ? (rawTotal / 100).toFixed(0) : rawTotal;
        const rawSubtotal = parseFloat(ord.subtotal || '0');
        const subtotalRupees = rawSubtotal >= 10000 ? (rawSubtotal / 100).toFixed(0) : rawSubtotal;

        return {
          ...ord,
          total_amount: totalRupees,
          totalAmount: totalRupees,
          subtotal: subtotalRupees,
          shipments: shipments || [],
          items: (items || []).map((it: any) => {
            const rawUnit = parseFloat(it.unit_price || '0');
            const unitRupees = rawUnit >= 10000 ? (rawUnit / 100).toFixed(0) : rawUnit;
            const rawLine = parseFloat(it.line_total || '0');
            const lineRupees = rawLine >= 10000 ? (rawLine / 100).toFixed(0) : rawLine;
            return {
              ...it,
              unit_price: unitRupees,
              line_total: lineRupees,
            };
          }),
        };
      })
    );

    return res.json({ orders: ordersWithItems });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Failed to fetch customer orders';
    return res.status(500).json({ error: errorMsg });
  }
});

/**
 * GET /api/customers/addresses
 * Returns customer's saved addresses from Supabase addresses table
 */
router.get('/addresses', async (req: Request, res: Response) => {
  try {
    const { userId, email, phone } = req.query;

    if (!supabaseClient) {
      return res.json({ addresses: [] });
    }

    let customerId = userId ? String(userId) : null;

    if (!customerId && (email || phone)) {
      if (email) {
        const { data: listData } = await supabaseClient.auth.admin.listUsers();
        const found = listData?.users?.find((u) => u.email?.toLowerCase() === String(email).trim().toLowerCase());
        if (found) customerId = found.id;
      }
      if (!customerId && phone) {
        const { data: prof } = await supabaseClient.from('profiles').select('id').eq('phone', String(phone)).limit(1);
        customerId = prof?.[0]?.id || null;
      }
    }

    if (!customerId) {
      return res.json({ addresses: [] });
    }

    const { data: addrs, error } = await supabaseClient
      .from('addresses')
      .select('*')
      .eq('user_id', customerId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('Address fetch error:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.json({ addresses: addrs || [] });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Failed to fetch addresses';
    return res.status(500).json({ error: errorMsg });
  }
});

/**
 * POST /api/customers/addresses
 * Creates a new address for the customer in Supabase addresses table
 */
router.post('/addresses', async (req: Request, res: Response) => {
  try {
    const {
      userId,
      email,
      fullName,
      phone,
      line1,
      line2,
      city,
      state,
      postalCode,
      country = 'India',
      type = 'shipping',
      isDefault = false,
    } = req.body;

    if (!line1 || !city || !state || !postalCode || !phone) {
      return res.status(400).json({ error: 'Line1, city, state, pincode, and phone are required' });
    }

    if (!supabaseClient) {
      return res.status(500).json({ error: 'Database client unavailable' });
    }

    let customerId = userId ? String(userId) : null;

    // Resolve or create profile if needed
    if (!customerId && email) {
      const { data: listData } = await supabaseClient.auth.admin.listUsers();
      let found: any = listData?.users?.find((u) => u.email?.toLowerCase() === String(email).trim().toLowerCase());
      if (!found) {
        const { data: created } = await supabaseClient.auth.admin.createUser({
          email: String(email).trim().toLowerCase(),
          email_confirm: true,
          user_metadata: { full_name: fullName || 'Customer' },
        });
        found = created?.user;
      }
      if (found) customerId = found.id;
    }

    if (!customerId) {
      return res.status(400).json({ error: 'Customer account could not be identified' });
    }

    // Ensure customer profile exists in profiles table
    await supabaseClient
      .from('profiles')
      .upsert({
        id: customerId,
        full_name: fullName || 'Fittrock Customer',
        phone: phone || null,
      });

    // If setting as default, unset other defaults
    if (isDefault) {
      await supabaseClient
        .from('addresses')
        .update({ is_default: false })
        .eq('user_id', customerId);
    }

    // Insert new address
    const { data: newAddr, error: insertError } = await supabaseClient
      .from('addresses')
      .insert({
        user_id: customerId,
        type: type === 'billing' ? 'billing' : 'shipping',
        full_name: fullName || 'Customer',
        phone: phone.trim(),
        line1: line1.trim(),
        line2: line2 ? line2.trim() : null,
        city: city.trim(),
        state: state.trim(),
        postal_code: postalCode.trim(),
        country: country || 'India',
        is_default: !!isDefault,
      })
      .select()
      .single();

    if (insertError) {
      console.error('Supabase address insert error:', insertError);
      return res.status(500).json({ error: insertError.message });
    }

    return res.status(201).json({
      success: true,
      address: newAddr,
      message: 'Address saved successfully',
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Failed to save address';
    console.error('Save address error:', err);
    return res.status(500).json({ error: errorMsg });
  }
});

/**
 * DELETE /api/customers/addresses/:id
 * Removes an address from Supabase addresses table
 */
router.delete('/addresses/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!supabaseClient) {
      return res.status(500).json({ error: 'Database client unavailable' });
    }

    const { error } = await supabaseClient
      .from('addresses')
      .delete()
      .eq('id', id);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json({ success: true, message: 'Address removed successfully' });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Failed to delete address';
    return res.status(500).json({ error: errorMsg });
  }
});

export default router;

