import { Router, Request, Response } from 'express';
import { db } from '../lib/db/index.js';
import { discounts } from '../lib/db/schema.js';
import { supabaseClient } from '../lib/db/supabase.js';
import { eq } from 'drizzle-orm';

const router = Router();

// POST /api/discounts/validate - Validate coupon code
router.post('/validate', async (req: Request, res: Response) => {
  try {
    const { code, subtotal } = req.body;
    if (!code) {
      return res.status(400).json({ error: 'Discount code is required' });
    }

    const searchCode = String(code).trim().toUpperCase();
    let foundDiscount: any = null;

    if (supabaseClient) {
      const { data: rows } = await supabaseClient
        .from('discounts')
        .select('*')
        .eq('code', searchCode);

      foundDiscount = rows?.[0];
    } else {
      const [found] = await db
        .select()
        .from(discounts)
        .where(eq(discounts.code, searchCode));

      foundDiscount = found;
    }

    if (!foundDiscount || (!foundDiscount.is_active && !foundDiscount.isActive)) {
      return res.status(404).json({ error: 'Invalid or expired coupon code' });
    }

    const minAmount = parseFloat(foundDiscount.min_order_amount || foundDiscount.minOrderAmount || '0');
    const currentSubtotal = parseFloat(subtotal || '0');

    if (currentSubtotal < minAmount) {
      return res.status(400).json({
        error: `Minimum order amount of ₹${minAmount} required for this coupon.`,
      });
    }

    let discountAmount = 0;
    const val = parseFloat(foundDiscount.value);
    if (foundDiscount.type === 'percentage') {
      discountAmount = (currentSubtotal * val) / 100;
      const maxDiscount = parseFloat(foundDiscount.max_discount_amount || foundDiscount.maxDiscountAmount || '0');
      if (maxDiscount > 0 && discountAmount > maxDiscount) {
        discountAmount = maxDiscount;
      }
    } else {
      discountAmount = Math.min(val, currentSubtotal);
    }

    return res.json({
      valid: true,
      code: foundDiscount.code,
      type: foundDiscount.type,
      value: foundDiscount.value,
      discountAmount: discountAmount.toFixed(2),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to validate discount';
    return res.status(500).json({ error: message });
  }
});

export default router;
