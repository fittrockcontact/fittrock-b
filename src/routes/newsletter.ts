import { Router, Request, Response } from 'express';
import { supabaseClient } from '../lib/db/supabase.js';

const router = Router();

/**
 * POST /api/newsletter
 * Subscribes a user email to the newsletter_subscribers table
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }

    const cleanEmail = email.trim().toLowerCase();

    if (!supabaseClient) {
      return res.status(200).json({
        success: true,
        message: 'Thank you for subscribing to Fittrock Ergonomics updates!',
      });
    }

    // Check if email already subscribed
    const { data: existing, error: checkError } = await supabaseClient
      .from('newsletter_subscribers')
      .select('id, is_active')
      .eq('email', cleanEmail)
      .limit(1);

    if (checkError) {
      console.warn('Error checking existing subscriber:', checkError);
    }

    if (existing && existing.length > 0) {
      // Re-activate if was unsubscribed
      if (!existing[0].is_active) {
        await supabaseClient
          .from('newsletter_subscribers')
          .update({ is_active: true })
          .eq('id', existing[0].id);
      }
      return res.status(200).json({
        success: true,
        message: 'You are already subscribed to Fittrock updates!',
      });
    }

    // Insert new subscriber
    const { data, error } = await supabaseClient
      .from('newsletter_subscribers')
      .insert({
        email: cleanEmail,
        is_active: true,
        subscribed_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      console.error('Supabase newsletter insert error:', error);
      return res.status(500).json({ error: 'Could not complete newsletter subscription' });
    }

    return res.status(201).json({
      success: true,
      message: 'Thank you for subscribing! You will receive exclusive ergonomics deals and tips.',
      subscriberId: data?.id,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Subscription failed';
    console.error('Newsletter route error:', err);
    return res.status(500).json({ error: errorMsg });
  }
});

export default router;
