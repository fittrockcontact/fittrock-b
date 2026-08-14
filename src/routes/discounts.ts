import { Router, Request, Response } from 'express';
import { db } from '../lib/db/index.js';
import { discounts } from '../lib/db/schema.js';
import { eq } from 'drizzle-orm';

const router = Router();

// POST /api/discounts/validate - Validate coupon code
router.post('/validate', async (req: Request, res: Response) => {
  try {
    const { code, subtotal } = req.body;
    if (!code) {
      return res.status(400).json({ error: 'Discount code is required' });
    }

    const [found] = await db
      .select()
      .from(discounts)
      .where(eq(discounts.code, String(code).toUpperCase()));

    if (!found || !found.isActive) {
      return res.status(404).json({ error: 'Invalid or expired coupon code' });
    }

    const minAmount = parseFloat(found.minOrderAmount || '0');
    const currentSubtotal = parseFloat(subtotal || '0');

    if (currentSubtotal < minAmount) {
      return res.status(400).json({
        error: `Minimum order amount of ₹${minAmount} required for this coupon.`,
      });
    }

    let discountAmount = 0;
    const val = parseFloat(found.value);
    if (found.type === 'percentage') {
      discountAmount = (currentSubtotal * val) / 100;
    } else {
      discountAmount = Math.min(val, currentSubtotal);
    }

    return res.json({
      valid: true,
      code: found.code,
      type: found.type,
      value: found.value,
      discountAmount: discountAmount.toFixed(2),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to validate discount';
    return res.status(500).json({ error: message });
  }
});

export default router;
