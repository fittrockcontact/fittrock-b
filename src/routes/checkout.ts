import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { db } from '../lib/db/index.js';
import { products, productVariants, orders, orderItems, discounts, customers } from '../lib/db/schema.js';
import { supabaseClient } from '../lib/db/supabase.js';
import { eq, inArray } from 'drizzle-orm';
import { razorpay } from '../lib/razorpay.js';
import { ensureCustomerAccount } from '../lib/customer-account.js';
import { sendOrderConfirmationEmail } from '../lib/email.js';
import { generateInvoicePdf, InvoiceData } from '../lib/invoice.js';

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

const verifyPaymentSchema = z.object({
  orderId: z.string().min(1, 'Database Order ID is required'),
  razorpayOrderId: z.string().min(1, 'Razorpay Order ID is required'),
  razorpayPaymentId: z.string().min(1, 'Razorpay Payment ID is required'),
  razorpaySignature: z.string().min(1, 'Razorpay Signature is required'),
});

function parsePrice(raw: any): number {
  if (!raw) return 0;
  const num = parseFloat(String(raw));
  return num > 100000 ? num / 100 : num;
}

/**
 * POST /api/checkout/create-order
 * Creates an order record in Supabase, validates inventory, prepares Razorpay order,
 * and records pending payments and order line items.
 */
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
    let discountId: string | null = null;
    if (validatedData.discountCode) {
      if (supabaseClient) {
        const { data: dRows } = await supabaseClient.from('discounts').select('*').eq('code', validatedData.discountCode.toUpperCase());
        const foundDiscount = dRows?.[0];
        if (foundDiscount && foundDiscount.is_active && subtotalRupees >= parsePrice(foundDiscount.min_order_amount)) {
          discountId = foundDiscount.id;
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
          discountId = foundDiscount.id;
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
    const subtotalPaise = Math.round(subtotalRupees * 100);
    const discountPaise = Math.round(discountRupees * 100);
    const shippingPaise = Math.round(shippingRupees * 100);

    const orderNumber = `FR-${Math.floor(100000 + Math.random() * 900000)}`;

    // 1. Create order on Razorpay
    const razorpayOrder = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: orderNumber,
      notes: {
        customerEmail: validatedData.customer.email,
        customerName: validatedData.customer.name,
        orderNumber,
      },
    });

    // 2. Automatically ensure/create customer account in Firebase Auth and database
    let customerUserId: string | undefined;
    let shippingAddressId: string | undefined;
    try {
      const accountRes = await ensureCustomerAccount({
        email: validatedData.customer.email,
        name: validatedData.customer.name,
        phone: validatedData.customer.phone,
        shippingAddress: validatedData.shippingAddress,
      });
      customerUserId = accountRes.userId;
      shippingAddressId = accountRes.addressId;
    } catch (accountErr) {
      console.warn('Non-blocking customer account auto-creation note:', accountErr);
    }

    // 3. Persist Order in Supabase Database
    let dbOrderId: string = razorpayOrder.receipt || orderNumber;

    if (supabaseClient) {
      const orderInsertData: any = {
        order_number: orderNumber,
        user_id: customerUserId || null,
        status: 'pending',
        shipping_address_id: shippingAddressId || null,
        subtotal: subtotalPaise,
        discount_amount: discountPaise,
        shipping_amount: shippingPaise,
        tax_amount: 0,
        total_amount: amountInPaise,
        discount_id: discountId || null,
        customer_note: `${validatedData.customer.name} | ${validatedData.customer.email} | ${validatedData.customer.phone}`,
      };

      const { data: createdOrder, error: orderErr } = await supabaseClient
        .from('orders')
        .insert(orderInsertData)
        .select()
        .single();

      if (orderErr) {
        console.error('Failed to insert order into Supabase:', orderErr);
        throw new Error(`Failed to record order: ${orderErr.message}`);
      }

      dbOrderId = createdOrder.id;

      // 4. Persist Order Items
      const orderItemsRows = validatedOrderItems.map((item) => ({
        order_id: dbOrderId,
        variant_id: item.variantId,
        product_title: item.productTitle,
        variant_title: item.variantTitle,
        sku: item.sku,
        unit_price: Math.round(parsePrice(item.unitPricePaise) * 100),
        quantity: item.quantity,
        line_total: Math.round(parsePrice(item.unitPricePaise) * 100 * item.quantity),
      }));

      const { error: itemsErr } = await supabaseClient.from('order_items').insert(orderItemsRows);
      if (itemsErr) {
        console.error('Error recording order items in Supabase:', itemsErr);
      }

      // 5. Persist Pending Payment Entry
      const { error: payErr } = await supabaseClient.from('payments').insert({
        order_id: dbOrderId,
        method: 'card',
        status: 'pending',
        amount: amountInPaise,
        currency: 'INR',
        razorpay_order_id: razorpayOrder.id,
        razorpay_email: validatedData.customer.email,
        razorpay_contact: validatedData.customer.phone,
      });

      if (payErr) {
        console.error('Error creating pending payment entry in Supabase:', payErr);
      }
    }

    return res.json({
      success: true,
      orderId: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      dbOrderId,
      orderNumber,
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

/**
 * POST /api/checkout/verify-payment
 * Cryptographically verifies the Razorpay HMAC SHA-256 signature,
 * captures payment status in Supabase, confirms order, atomically decrements inventory,
 * and triggers order confirmation email.
 */
router.post('/verify-payment', async (req: Request, res: Response) => {
  try {
    const { orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature } =
      verifyPaymentSchema.parse(req.body);

    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) {
      console.error('Missing RAZORPAY_KEY_SECRET in backend environment');
      return res.status(500).json({ error: 'Payment gateway configuration error' });
    }

    // 1. Verify Razorpay HMAC SHA-256 Signature
    const expectedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex');

    const sigBuffer = Buffer.from(razorpaySignature);
    const expectedBuffer = Buffer.from(expectedSignature);

    const isSignatureValid =
      sigBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(sigBuffer, expectedBuffer);

    if (!isSignatureValid) {
      console.error('Payment signature verification failed for Razorpay Order:', razorpayOrderId);
      return res.status(400).json({ error: 'Invalid payment signature' });
    }

    console.log(`✅ Payment verified successfully for Razorpay Payment: ${razorpayPaymentId}`);

    let orderNumber = `FR-${orderId.slice(0, 6).toUpperCase()}`;

    // 2. Update Payment & Order records in Supabase
    if (supabaseClient) {
      // Update payment record
      await supabaseClient
        .from('payments')
        .update({
          status: 'paid',
          captured: true,
          razorpay_payment_id: razorpayPaymentId,
          razorpay_signature: razorpaySignature,
          captured_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('order_id', orderId);

      // Update order status to confirmed
      const { data: updatedOrder, error: orderUpErr } = await supabaseClient
        .from('orders')
        .update({
          status: 'confirmed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', orderId)
        .select()
        .single();

      if (orderUpErr) {
        console.error('Error updating order to confirmed:', orderUpErr);
      } else if (updatedOrder?.order_number) {
        orderNumber = updatedOrder.order_number;
      }

      // 3. Atomically decrement stock for purchased items
      try {
        await supabaseClient.rpc('decrement_stock_atomic', { order_id_param: orderId });
        console.log(`📦 Stock decremented atomically in Supabase for order: ${orderId}`);
      } catch (stockErr) {
        console.error('Error running decrement_stock_atomic RPC:', stockErr);
      }

      // 4. Non-blocking order confirmation email with Tax Invoice PDF attached
      try {
        const { data: oItems } = await supabaseClient
          .from('order_items')
          .select('*')
          .eq('order_id', orderId);

        let addressRecord: any = null;
        if (updatedOrder?.shipping_address_id) {
          const { data: addr } = await supabaseClient
            .from('addresses')
            .select('*')
            .eq('id', updatedOrder.shipping_address_id)
            .maybeSingle();
          addressRecord = addr;
        }

        const note = updatedOrder?.customer_note || '';
        const parts = note.split('|').map((s: string) => s.trim());
        const customerName = parts[0] || 'Customer';
        const customerEmail = parts[1] || '';

        const invoicePayload: InvoiceData = {
          orderNumber,
          orderDate: updatedOrder.placed_at || new Date(),
          customerName,
          customerEmail,
          customerPhone: parts[2] || addressRecord?.phone || '',
          shippingAddress: addressRecord
            ? {
                line1: addressRecord.line1 || addressRecord.address1 || '',
                line2: addressRecord.line2 || addressRecord.address2 || null,
                city: addressRecord.city || '',
                state: addressRecord.state || 'Maharashtra',
                postalCode: addressRecord.postal_code || addressRecord.postalCode || '',
                country: addressRecord.country || 'India',
              }
            : undefined,
          customerGst: updatedOrder.gst_number || null,
          items: (oItems || []).map((it: any) => ({
            title: it.product_title || 'Fittrock Ergonomic Standing Desk',
            variantTitle: it.variant_title || 'Standard',
            sku: it.sku || '',
            quantity: it.quantity || 1,
            unitPriceRupees: parsePrice(it.unit_price),
          })),
          subtotalRupees: parsePrice(updatedOrder.subtotal || updatedOrder.total_amount),
          discountRupees: parsePrice(updatedOrder.discount_amount || 0),
          shippingRupees: 0,
          totalRupees: parsePrice(updatedOrder.total_amount),
          paymentId: razorpayPaymentId,
          paymentMethod: 'Razorpay Online',
        };

        let invoicePdfBuffer: Buffer | undefined;
        try {
          invoicePdfBuffer = await generateInvoicePdf(invoicePayload);
        } catch (pdfErr) {
          console.warn('Error generating invoice PDF for email attachment:', pdfErr);
        }

        if (customerEmail && customerEmail.includes('@')) {
          const totalRupees = parsePrice(updatedOrder.total_amount).toFixed(2);
          await sendOrderConfirmationEmail(customerEmail, {
            orderId: orderNumber,
            customerName,
            totalAmount: totalRupees,
            invoicePdf: invoicePdfBuffer,
          });
        }
      } catch (mailErr) {
        console.warn('Order confirmation email note (non-blocking):', mailErr);
      }
    }

    return res.json({
      success: true,
      message: 'Payment verified and order confirmed',
      orderId,
      orderNumber,
    });
  } catch (err: unknown) {
    console.error('Error verifying payment:', err);
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: err.issues[0]?.message || 'Validation error' });
    }
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return res.status(500).json({ error: message });
  }
});

/**
 * GET /api/checkout/orders/:orderIdentifier/invoice
 * Generates and downloads the official Fittrock Ergonomics LLP Tax Invoice PDF
 */
router.get('/orders/:orderIdentifier/invoice', async (req: Request, res: Response) => {
  const { orderIdentifier } = req.params;
  try {
    if (!supabaseClient) {
      return res.status(500).json({ error: 'Database connection not initialized' });
    }

    // Lookup order by order_number (e.g. FR-710453) or UUID
    let orderRow: any = null;
    const { data: byNum } = await supabaseClient
      .from('orders')
      .select('*')
      .eq('order_number', orderIdentifier)
      .maybeSingle();

    if (byNum) {
      orderRow = byNum;
    } else {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        orderIdentifier
      );
      if (isUuid) {
        const { data: byId } = await supabaseClient
          .from('orders')
          .select('*')
          .eq('id', orderIdentifier)
          .maybeSingle();
        orderRow = byId;
      }
    }

    if (!orderRow) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Fetch line items
    const { data: items } = await supabaseClient
      .from('order_items')
      .select('*')
      .eq('order_id', orderRow.id);

    // Fetch shipping address
    let addressRecord: any = null;
    if (orderRow.shipping_address_id) {
      const { data: addr } = await supabaseClient
        .from('addresses')
        .select('*')
        .eq('id', orderRow.shipping_address_id)
        .maybeSingle();
      addressRecord = addr;
    }

    // Fetch payment reference
    const { data: paymentRecord } = await supabaseClient
      .from('payments')
      .select('*')
      .eq('order_id', orderRow.id)
      .maybeSingle();

    const note = orderRow.customer_note || '';
    const parts = note.split('|').map((s: string) => s.trim());
    const customerName = parts[0] || 'Valued Customer';
    const customerEmail = parts[1] || '';
    const customerPhone = parts[2] || addressRecord?.phone || '';

    const invoicePayload: InvoiceData = {
      orderNumber: orderRow.order_number || `FR-${orderRow.id.slice(0, 6).toUpperCase()}`,
      orderDate: orderRow.placed_at || new Date(),
      customerName,
      customerEmail,
      customerPhone,
      shippingAddress: addressRecord
        ? {
            line1: addressRecord.line1 || addressRecord.address1 || '',
            line2: addressRecord.line2 || addressRecord.address2 || null,
            city: addressRecord.city || '',
            state: addressRecord.state || 'Maharashtra',
            postalCode: addressRecord.postal_code || addressRecord.postalCode || '',
            country: addressRecord.country || 'India',
          }
        : undefined,
      customerGst: orderRow.gst_number || null,
      items: (items || []).map((it: any) => ({
        title: it.product_title || 'Fittrock Ergonomic Standing Desk',
        variantTitle: it.variant_title || 'Standard',
        sku: it.sku || '',
        quantity: it.quantity || 1,
        unitPriceRupees: parsePrice(it.unit_price),
      })),
      subtotalRupees: parsePrice(orderRow.subtotal || orderRow.total_amount),
      discountRupees: parsePrice(orderRow.discount_amount || 0),
      shippingRupees: 0,
      totalRupees: parsePrice(orderRow.total_amount),
      paymentId: paymentRecord?.razorpay_payment_id || 'Prepaid Verified',
      paymentMethod: paymentRecord?.payment_method || 'Razorpay Online',
    };

    const pdfBuffer = await generateInvoicePdf(invoicePayload);

    const filename = `Tax-Invoice-${orderRow.order_number || orderRow.id.slice(0, 8)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.end(pdfBuffer);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to generate tax invoice';
    console.error('Invoice generation error:', err);
    return res.status(500).json({ error: msg });
  }
});

export default router;
