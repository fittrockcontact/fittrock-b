import { Router, Request, Response } from 'express';
import { supabaseClient } from '../lib/db/supabase.js';

const router = Router();

/**
 * GET /api/cart
 * Retrieves the synced cloud cart for a customer
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { userId, email } = req.query;

    if (!supabaseClient) {
      return res.json({ items: [], appliedDiscount: null });
    }

    let customerId = userId ? String(userId) : null;

    if (!customerId && email) {
      const { data: listData } = await supabaseClient.auth.admin.listUsers();
      const found = listData?.users?.find((u) => u.email?.toLowerCase() === String(email).trim().toLowerCase());
      if (found) customerId = found.id;
    }

    if (!customerId) {
      return res.json({ items: [], appliedDiscount: null });
    }

    const { data: cartData, error } = await supabaseClient
      .from('customer_carts')
      .select('*')
      .eq('user_id', customerId)
      .limit(1);

    if (error) {
      console.warn('Error fetching cloud cart:', error);
      return res.json({ items: [], appliedDiscount: null });
    }

    if (!cartData || cartData.length === 0) {
      return res.json({ items: [], appliedDiscount: null });
    }

    const record = cartData[0];
    return res.json({
      items: Array.isArray(record.items) ? record.items : [],
      appliedDiscount: record.applied_discount || null,
      updatedAt: record.updated_at,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Failed to fetch cloud cart';
    return res.status(500).json({ error: errorMsg });
  }
});

/**
 * POST /api/cart/sync
 * Upserts the customer's cloud cart in Supabase customer_carts table
 */
router.post('/sync', async (req: Request, res: Response) => {
  try {
    const { userId, email, items, appliedDiscount } = req.body;

    if (!supabaseClient) {
      return res.json({ success: true, message: 'Offline mode' });
    }

    let customerId = userId ? String(userId) : null;

    if (!customerId && email) {
      const { data: listData } = await supabaseClient.auth.admin.listUsers();
      let found: any = listData?.users?.find((u) => u.email?.toLowerCase() === String(email).trim().toLowerCase());
      if (!found) {
        const { data: created } = await supabaseClient.auth.admin.createUser({
          email: String(email).trim().toLowerCase(),
          email_confirm: true,
          user_metadata: { full_name: 'Customer' },
        });
        found = created?.user;
      }
      if (found) customerId = found.id;
    }

    if (!customerId) {
      return res.status(400).json({ error: 'Customer account could not be identified' });
    }

    // Ensure profile exists
    await supabaseClient
      .from('profiles')
      .upsert({
        id: customerId,
        full_name: email?.split('@')[0] || 'Customer',
      });

    const safeItems = Array.isArray(items) ? items : [];

    const { data: savedCart, error } = await supabaseClient
      .from('customer_carts')
      .upsert(
        {
          user_id: customerId,
          items: safeItems,
          applied_discount: appliedDiscount || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      )
      .select()
      .single();

    if (error) {
      console.error('Cloud cart upsert error:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.json({
      success: true,
      message: 'Cloud cart synchronized successfully',
      cart: savedCart,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Failed to sync cloud cart';
    console.error('Cart sync error:', err);
    return res.status(500).json({ error: errorMsg });
  }
});

/**
 * DELETE /api/cart
 * Clears the customer's cloud cart
 */
router.delete('/', async (req: Request, res: Response) => {
  try {
    const { userId, email } = req.query;

    if (!supabaseClient) {
      return res.json({ success: true });
    }

    let customerId = userId ? String(userId) : null;
    if (!customerId && email) {
      const { data: listData } = await supabaseClient.auth.admin.listUsers();
      const found = listData?.users?.find((u) => u.email?.toLowerCase() === String(email).trim().toLowerCase());
      if (found) customerId = found.id;
    }

    if (customerId) {
      await supabaseClient
        .from('customer_carts')
        .delete()
        .eq('user_id', customerId);
    }

    return res.json({ success: true, message: 'Cloud cart cleared' });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Failed to clear cloud cart';
    return res.status(500).json({ error: errorMsg });
  }
});

export default router;
