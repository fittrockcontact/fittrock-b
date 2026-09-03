import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { supabaseClient } from '../lib/db/supabase.js';
import { sendOrderConfirmationEmail } from '../lib/email.js';

const router = Router();

function parsePrice(raw: any): number {
  if (!raw) return 0;
  const num = parseFloat(String(raw));
  return num > 100000 ? num / 100 : num;
}

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

    const sigBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);

    const isSignatureValid =
      sigBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(sigBuffer, expectedBuffer);

    if (!isSignatureValid) {
      console.error('Invalid Razorpay Webhook Signature');
      return res.status(400).json({ error: 'Invalid webhook signature' });
    }

    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const event = payload.event;

    console.log(`Received Razorpay Webhook Event: ${event}`);

    if (!supabaseClient) {
      console.warn('Supabase client not initialized for webhook handler');
      return res.json({ status: 'ok', message: 'Database client unavailable' });
    }

    if (event === 'payment.captured' || event === 'order.paid') {
      const paymentEntity = payload.payload.payment.entity;
      const razorpayOrderId = paymentEntity.order_id;
      const razorpayPaymentId = paymentEntity.id;

      // 1. Locate payment record by razorpay_order_id
      const { data: paymentsList, error: pErr } = await supabaseClient
        .from('payments')
        .select('*')
        .eq('razorpay_order_id', razorpayOrderId)
        .limit(1);

      if (pErr || !paymentsList || paymentsList.length === 0) {
        console.warn(`Payment record not found for Razorpay Order ID: ${razorpayOrderId}`);
        return res.json({ status: 'ok', message: 'Payment record not found' });
      }

      const paymentRecord = paymentsList[0];
      const orderId = paymentRecord.order_id;

      // 2. Fetch linked order
      const { data: order, error: oErr } = await supabaseClient
        .from('orders')
        .select('*')
        .eq('id', orderId)
        .single();

      if (oErr || !order) {
        console.warn(`Order not found for ID: ${orderId}`);
        return res.json({ status: 'ok', message: 'Order not found' });
      }

      if (order.status === 'confirmed' || order.status === 'shipped' || order.status === 'delivered') {
        console.log(`Order ${order.id} is already processed with status: ${order.status}. Skipping.`);
        return res.json({ status: 'ok', message: 'Already processed' });
      }

      // 3. Mark payment paid and order confirmed
      await supabaseClient
        .from('payments')
        .update({
          status: 'paid',
          captured: true,
          razorpay_payment_id: razorpayPaymentId,
          captured_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', paymentRecord.id);

      await supabaseClient
        .from('orders')
        .update({
          status: 'confirmed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', order.id);

      // 4. Atomically decrement stock
      try {
        await supabaseClient.rpc('decrement_stock_atomic', { order_id_param: order.id });
        console.log(`Stock decremented atomically via webhook for order ${order.id}`);
      } catch (stockErr) {
        console.error(`Error executing decrement_stock_atomic for order ${order.id}:`, stockErr);
      }

      // 5. Send order confirmation email
      try {
        const note = order.customer_note || '';
        const parts = note.split('|').map((s: string) => s.trim());
        const customerName = parts[0] || 'Customer';
        const customerEmail = parts[1] || '';

        if (customerEmail && customerEmail.includes('@')) {
          const totalRupees = parsePrice(order.total_amount).toFixed(2);
          await sendOrderConfirmationEmail(customerEmail, {
            orderId: order.order_number || order.id,
            customerName,
            totalAmount: totalRupees,
          });
        }
      } catch (emailErr) {
        console.error('Error sending confirmation email in webhook:', emailErr);
      }
    } else if (event === 'payment.failed') {
      const paymentEntity = payload.payload.payment.entity;
      const razorpayOrderId = paymentEntity.order_id;

      if (razorpayOrderId) {
        const { data: pList } = await supabaseClient
          .from('payments')
          .select('id, order_id')
          .eq('razorpay_order_id', razorpayOrderId)
          .limit(1);

        if (pList && pList.length > 0) {
          const p = pList[0];
          await supabaseClient
            .from('payments')
            .update({ status: 'failed', updated_at: new Date().toISOString() })
            .eq('id', p.id);

          await supabaseClient
            .from('orders')
            .update({ status: 'cancelled', updated_at: new Date().toISOString() })
            .eq('id', p.order_id);

          console.log(`Marked order ${p.order_id} as cancelled due to payment failure.`);
        }
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
