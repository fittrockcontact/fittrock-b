import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { db } from '../lib/db/index.js';
import { orders } from '../lib/db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { sendOrderConfirmationEmail } from '../lib/email.js';

const router = Router();

router.post('/razorpay', async (req: Request, res: Response) => {
  try {
    const rawBody = (req as Request & { rawBody?: string }).rawBody || JSON.stringify(req.body);
    const signature = req.headers['x-razorpay-signature'] as string;
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error('Missing RAZORPAY_WEBHOOK_SECRET');
      return res.status(500).json({ error: 'Webhook secret missing' });
    }

    if (!signature) {
      return res.status(400).json({ error: 'Missing signature header' });
    }

    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');

    const isSignatureValid = crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );

    if (!isSignatureValid) {
      console.error('Invalid Razorpay Webhook Signature');
      return res.status(400).json({ error: 'Invalid webhook signature' });
    }

    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const event = payload.event;

    console.log(`Received Razorpay Webhook Event: ${event}`);

    if (event === 'payment.captured' || event === 'order.paid') {
      const paymentEntity = payload.payload.payment.entity;
      const razorpayOrderId = paymentEntity.order_id;
      const razorpayPaymentId = paymentEntity.id;

      const [order] = await db
        .select()
        .from(orders)
        .where(eq(orders.razorpayOrderId, razorpayOrderId));

      if (!order) {
        console.warn(`Order not found for Razorpay Order ID: ${razorpayOrderId}`);
        return res.json({ status: 'ok', message: 'Order not found' });
      }

      if (order.status === 'paid') {
        console.log(`Order ${order.id} is already marked as paid. Skipping.`);
        return res.json({ status: 'ok', message: 'Already processed' });
      }

      await db
        .update(orders)
        .set({
          status: 'paid',
          razorpayPaymentId,
          razorpaySignature: signature,
        })
        .where(eq(orders.id, order.id));

      try {
        await db.execute(sql`SELECT decrement_stock_atomic(${order.id}::uuid)`);
        console.log(`Stock decremented atomically for order ${order.id}`);
      } catch (stockErr) {
        console.error(`Error executing decrement_stock_atomic for order ${order.id}:`, stockErr);
      }

      const emailNote = order.customerNote || '';
      if (emailNote.includes('@')) {
        try {
          const totalRupees = (parseFloat(order.totalAmount) / 100).toFixed(2);
          await sendOrderConfirmationEmail(emailNote, {
            orderId: order.id,
            totalAmount: totalRupees,
          });
        } catch (emailErr) {
          console.error('Error sending confirmation email:', emailErr);
        }
      }
    } else if (event === 'payment.failed') {
      const paymentEntity = payload.payload.payment.entity;
      const razorpayOrderId = paymentEntity.order_id;

      if (razorpayOrderId) {
        await db
          .update(orders)
          .set({ status: 'cancelled' })
          .where(eq(orders.razorpayOrderId, razorpayOrderId));
        console.log(`Marked order for ${razorpayOrderId} as cancelled due to payment failure.`);
      }
    }

    return res.json({ status: 'ok' });
  } catch (err: unknown) {
    console.error('Error handling Razorpay webhook:', err);
    const message = err instanceof Error ? err.message : 'Internal error';
    return res.status(500).json({ error: message });
  }
});

export default router;
