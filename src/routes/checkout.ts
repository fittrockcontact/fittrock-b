import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../lib/db/index.js';
import { products, productVariants, orders, orderItems, discounts, customers } from '../lib/db/schema.js';
import { supabaseClient } from '../lib/db/supabase.js';
import { eq, inArray } from 'drizzle-orm';
import { razorpay } from '../lib/razorpay.js';
import { ensureCustomerAccount } from '../lib/customer-account.js';

const router = Router();

const createOrderSchema = z.object({
  items: z
    .array(
      z.object({
        variantId: z.string(),
        quantity: z.number().int().positive(),
      })
    )
    .min(1, 'Cart cannot be empty'),
  customer: z.object({
    email: z.string().email(),
    name: z.string().min(1, 'Name is required'),
    phone: z.string().min(5, 'Phone number is required'),
  }),
  shippingAddress: z.object({
    line1: z.string().min(1, 'Address line 1 is required'),
    line2: z.string().optional(),
    city: z.string().min(1, 'City is required'),
    state: z.string().min(1, 'State is required'),
    pincode: z.string().min(1, 'Pincode is required'),
    phone: z.string().min(5, 'Phone number is required'),
  }),
  discountCode: z.string().optional(),
});

function parsePrice(raw: any): number {
  if (!raw) return 0;
  const num = parseFloat(String(raw));
  return num > 100000 ? num / 100 : num;
}

router.post('/create-order', async (req: Request, res: Response) => {
  try {
    const validatedData = createOrderSchema.parse(req.body);
    const variantIds = validatedData.items.map((i) => i.variantId);

    let subtotalRupees = 0;
    const validatedOrderItems: {
      variantId: string;
      quantity: number;
      unitPricePaise: number;
      productTitle: string;
      variantTitle: string;
      sku: string;
    }[] = [];

    if (supabaseClient) {
      const { data: dbVars } = await supabaseClient.from('product_variants').select('*').in('id', variantIds);
      const productIds = Array.from(new Set((dbVars || []).map((v) => v.product_id)));
      const { data: dbProds } = await supabaseClient.from('products').select('*').in('id', productIds);

      for (const item of validatedData.items) {
        const foundVar = (dbVars || []).find((v) => v.id === item.variantId);
        const foundProd = (dbProds || []).find((p) => p.id === foundVar?.product_id);

        const stock = foundVar ? (foundVar.inventory_quantity ?? 10) : 10;
        if (stock < item.quantity) {
          return res.status(400).json({
            error: `Insufficient stock for ${foundProd?.title || 'Item'}. Only ${stock} remaining.`,
          });
        }

        const unitPricePaise = foundVar ? parseFloat(foundVar.price) : 0;
        const unitPriceRupees = parsePrice(foundVar?.price || 0);
        subtotalRupees += unitPriceRupees * item.quantity;

        validatedOrderItems.push({
          variantId: item.variantId,
          quantity: item.quantity,
          unitPricePaise,
          productTitle: foundProd?.title || 'Product',
          variantTitle: foundVar?.title || 'Standard',
          sku: foundVar?.sku || 'SKU',
        });
      }
    } else {
      const dbVariants = await db
        .select({
          variant: productVariants,
          product: products,
        })
        .from(productVariants)
        .innerJoin(products, eq(productVariants.productId, products.id))
        .where(inArray(productVariants.id, variantIds));

      for (const item of validatedData.items) {
        const found = dbVariants.find((v) => v.variant.id === item.variantId);
        if (found && found.variant.inventoryQuantity < item.quantity) {
          return res.status(400).json({
            error: `Insufficient stock for ${found.product.title} (${found.variant.title || ''}). Only ${found.variant.inventoryQuantity} remaining.`,
          });
        }

        const unitPricePaise = found ? parseFloat(found.variant.price) : 0;
        const unitPriceRupees = found ? parsePrice(found.variant.price) : 0;
        subtotalRupees += unitPriceRupees * item.quantity;

        validatedOrderItems.push({
          variantId: item.variantId,
          quantity: item.quantity,
          unitPricePaise,
          productTitle: found?.product.title || 'Product',
          variantTitle: found?.variant.title || 'Standard',
          sku: found?.variant.sku || 'SKU',
        });
      }
    }

    let discountRupees = 0;
    if (validatedData.discountCode) {
      if (supabaseClient) {
        const { data: dRows } = await supabaseClient.from('discounts').select('*').eq('code', validatedData.discountCode.toUpperCase());
        const foundDiscount = dRows?.[0];
        if (foundDiscount && foundDiscount.is_active && subtotalRupees >= parsePrice(foundDiscount.min_order_amount)) {
          const val = parseFloat(foundDiscount.value);
          if (foundDiscount.type === 'percentage') {
            discountRupees = (subtotalRupees * val) / 100;
          } else {
            discountRupees = Math.min(val, subtotalRupees);
          }
        }
      } else {
        const [foundDiscount] = await db
          .select()
          .from(discounts)
          .where(eq(discounts.code, validatedData.discountCode.toUpperCase()));

        if (
          foundDiscount &&
          foundDiscount.isActive &&
          subtotalRupees >= parsePrice(foundDiscount.minOrderAmount)
        ) {
          const val = parseFloat(foundDiscount.value);
          if (foundDiscount.type === 'percentage') {
            discountRupees = (subtotalRupees * val) / 100;
          } else {
            discountRupees = Math.min(val, subtotalRupees);
          }
        }
      }
    }

    const shippingRupees = subtotalRupees >= 5000 ? 0 : 299;
    const grandTotalRupees = Math.max(0, subtotalRupees - discountRupees + shippingRupees);
    const amountInPaise = Math.round(grandTotalRupees * 100);

    const razorpayOrder = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: `ord_${Date.now()}`,
      notes: {
        customerEmail: validatedData.customer.email,
        customerName: validatedData.customer.name,
      },
    });

    // Automatically ensure/create customer account in Firebase Auth and database
    try {
      await ensureCustomerAccount({
        email: validatedData.customer.email,
        name: validatedData.customer.name,
        phone: validatedData.customer.phone,
        shippingAddress: validatedData.shippingAddress,
      });
    } catch (accountErr) {
      console.warn('Non-blocking customer account auto-creation note:', accountErr);
    }

    return res.json({
      success: true,
      orderId: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      dbOrderId: razorpayOrder.receipt,
    });
  } catch (err: unknown) {
    console.error('Error creating order:', err);
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: err.issues[0]?.message || 'Validation error' });
    }
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return res.status(500).json({ error: message });
  }
});

export default router;
