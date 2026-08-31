import { Router, Request, Response } from 'express';
import { supabaseClient } from '../lib/db/supabase.js';
import { sendEmail } from '../lib/email.js';

const router = Router();

/**
 * POST /api/contact
 * Receives inquiry from website contact form and records in support_tickets table
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, email, phone, message, subject } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Name, email, and message are required fields.' });
    }

    const inquirySubject = subject || `Contact Inquiry from ${name} (${phone || 'No phone'})`;
    const fullDescription = `
Name: ${name}
Email: ${email}
Phone: ${phone || 'Not provided'}
Submitted: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}

Message:
${message}
`.trim();

    let ticketId: string | null = null;

    if (supabaseClient) {
      // 1. Insert into dedicated contact_inquiries table
      const { data: inqData, error: inqError } = await supabaseClient
        .from('contact_inquiries')
        .insert({
          name: name.trim(),
          email: email.trim(),
          phone: phone ? phone.trim() : null,
          message: message.trim(),
          status: 'new',
        })
        .select('id')
        .single();

      if (inqError) {
        console.error('Supabase contact_inquiries insert error:', inqError);
      } else {
        ticketId = inqData?.id;
      }

      // 2. Also log in support_tickets for unified helpdesk support tracking
      await supabaseClient
        .from('support_tickets')
        .insert({
          subject: inquirySubject,
          description: fullDescription,
          status: 'open',
        });
    }

    // Optionally notify staff via email (non-blocking)
    try {
      await sendEmail({
        to: process.env.ADMIN_NOTIFY_EMAIL || 'contact@fittrock.com',
        subject: `[New Inquiry] ${inquirySubject}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #222;">
            <h2 style="color: #a32222; margin-bottom: 8px;">New Customer Contact Inquiry</h2>
            <p style="font-size: 14px; color: #555;">Received from Fittrock Website contact form.</p>
            <div style="background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 16px; margin: 16px 0;">
              <p><strong>Customer Name:</strong> ${name}</p>
              <p><strong>Email Address:</strong> <a href="mailto:${email}">${email}</a></p>
              <p><strong>Phone:</strong> ${phone || 'N/A'}</p>
              <p><strong>Ticket ID:</strong> ${ticketId || 'Pending'}</p>
              <hr style="border: none; border-top: 1px solid #ddd; margin: 12px 0;" />
              <p><strong>Message:</strong></p>
              <p style="white-space: pre-wrap; font-size: 14px; color: #333;">${message}</p>
            </div>
          </div>
        `,
      });
    } catch (mailErr) {
      console.warn('Could not send contact notification email:', mailErr);
    }

    return res.status(201).json({
      success: true,
      message: 'Thank you! Your inquiry has been received. Our team will contact you shortly.',
      ticketId,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Failed to submit contact form';
    console.error('Contact route error:', err);
    return res.status(500).json({ error: errorMsg });
  }
});

export default router;
