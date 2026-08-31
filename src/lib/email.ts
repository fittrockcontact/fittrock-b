import { Resend } from 'resend';

const resendApiKey = process.env.RESEND_API_KEY || 're_placeholder';
export const resend = new Resend(resendApiKey);

export const DEFAULT_FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL || 'Fittrock Ergonomics <team@fittrock.com>';

export interface OrderEmailData {
  orderId: string;
  customerName?: string;
  totalAmount: string | number;
  itemName?: string;
  itemsCount?: number;
  shippingAddress?: string;
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

export async function sendEmail({ to, subject, html, from }: SendEmailOptions) {
  try {
    const data = await resend.emails.send({
      from: from || DEFAULT_FROM_EMAIL,
      to,
      subject,
      html,
    });
    return data;
  } catch (error) {
    console.warn('Could not send email via Resend:', error);
    return null;
  }
}

/**
 * Send order confirmation email upon payment capture
 */
export async function sendOrderConfirmationEmail(toEmail: string, orderData: OrderEmailData) {
  try {
    const formattedAmount =
      typeof orderData.totalAmount === 'number'
        ? orderData.totalAmount.toFixed(2)
        : orderData.totalAmount;

    const data = await resend.emails.send({
      from: DEFAULT_FROM_EMAIL,
      to: toEmail,
      subject: `Order Confirmation #${orderData.orderId.slice(0, 8)} - Fittrock Ergonomics`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #18181b; background-color: #ffffff; border: 1px solid #e4e4e7; border-radius: 16px;">
          <div style="text-align: center; margin-bottom: 24px;">
            <h1 style="color: #d97706; font-size: 24px; font-weight: 800; margin: 0; letter-spacing: -0.5px;">FITTROCK ERGONOMICS</h1>
            <p style="color: #71717a; font-size: 12px; margin-top: 4px; text-transform: uppercase; letter-spacing: 1px;">Crafted for Peak Productivity</p>
          </div>

          <h2 style="font-size: 18px; font-weight: 700; color: #09090b; margin-top: 0;">Thank you for your order${orderData.customerName ? `, ${orderData.customerName}` : ''}!</h2>
          <p style="font-size: 14px; line-height: 1.6; color: #3f3f46;">
            We've received your payment of <strong>₹${formattedAmount}</strong> for Order <strong>#${orderData.orderId.slice(0, 8)}</strong>.
          </p>

          <div style="background-color: #f4f4f5; border-radius: 12px; padding: 16px; margin: 20px 0;">
            <p style="margin: 0 0 8px 0; font-size: 13px; font-weight: 600; color: #27272a;">Order Summary</p>
            <p style="margin: 0; font-size: 13px; color: #52525b;">${orderData.itemName || 'Ergonomic Desk & Accessories'}</p>
            ${orderData.shippingAddress ? `<p style="margin: 8px 0 0 0; font-size: 12px; color: #71717a;">Shipping to: ${orderData.shippingAddress}</p>` : ''}
          </div>

          <p style="font-size: 14px; line-height: 1.6; color: #3f3f46;">
            Our logistics team is preparing your package for express dispatch. You will receive an SMS and email tracking update once the carrier scans your package.
          </p>

          <div style="margin-top: 32px; padding-top: 20px; border-top: 1px solid #f4f4f5; text-align: center; color: #71717a; font-size: 12px;">
            <p style="margin: 0;">Questions? Reply directly to this email or reach us at <a href="mailto:team@fittrock.com" style="color: #d97706; text-decoration: none;">team@fittrock.com</a>.</p>
            <p style="margin: 8px 0 0 0; font-size: 11px; color: #a1a1aa;">© ${new Date().getFullYear()} Fittrock Ergonomics. All rights reserved.</p>
          </div>
        </div>
      `,
    });

    console.log(`✉️ Order confirmation email sent to ${toEmail} (ID: ${data.data?.id})`);
    return data;
  } catch (error) {
    console.error('Failed to send order confirmation email via Resend:', error);
    throw error;
  }
}

/**
 * Send welcome email to newly registered customers
 */
export async function sendWelcomeEmail(toEmail: string, userName?: string, setupLink?: string) {
  try {
    const data = await resend.emails.send({
      from: DEFAULT_FROM_EMAIL,
      to: toEmail,
      subject: 'Welcome to Fittrock Ergonomics! Your Customer Account is Ready',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #18181b; background-color: #ffffff; border: 1px solid #e4e4e7; border-radius: 16px;">
          <div style="text-align: center; margin-bottom: 24px;">
            <h1 style="color: #d97706; font-size: 24px; font-weight: 800; margin: 0;">FITTROCK ERGONOMICS</h1>
            <p style="color: #71717a; font-size: 12px; margin-top: 4px; text-transform: uppercase; letter-spacing: 1px;">Customer Portal Access</p>
          </div>

          <h2 style="font-size: 18px; font-weight: 700; color: #09090b;">Welcome${userName ? `, ${userName}` : ''}!</h2>
          <p style="font-size: 14px; line-height: 1.6; color: #3f3f46;">
            A customer account has been created for your order. You can now track your deliveries, download tax invoices, and manage saved shipping addresses in one place.
          </p>

          ${
            setupLink
              ? `
          <div style="text-align: center; margin: 28px 0;">
            <a href="${setupLink}" style="background-color: #d97706; color: #ffffff; padding: 14px 28px; border-radius: 12px; font-weight: 700; text-decoration: none; font-size: 14px; display: inline-block; box-shadow: 0 4px 12px rgba(217, 119, 6, 0.25);">
              Set Up Your Password & Access Account
            </a>
            <p style="font-size: 11px; color: #a1a1aa; margin-top: 10px;">Or log in anytime at <a href="https://www.fittrock.com/account" style="color: #d97706;">www.fittrock.com/account</a> using your Google account or email.</p>
          </div>
          `
              : `
          <div style="text-align: center; margin: 28px 0;">
            <a href="https://www.fittrock.com/account" style="background-color: #d97706; color: #ffffff; padding: 14px 28px; border-radius: 12px; font-weight: 700; text-decoration: none; font-size: 14px; display: inline-block;">
              View Your Account
            </a>
          </div>
          `
          }

          <div style="margin-top: 32px; padding-top: 20px; border-top: 1px solid #f4f4f5; text-align: center; color: #71717a; font-size: 12px;">
            <p style="margin: 0;">Fittrock Team · <a href="mailto:team@fittrock.com" style="color: #d97706; text-decoration: none;">team@fittrock.com</a></p>
          </div>
        </div>
      `,
    });

    console.log(`✉️ Welcome email sent to ${toEmail} (ID: ${data.data?.id})`);
    return data;
  } catch (error) {
    console.error('Failed to send welcome email via Resend:', error);
    throw error;
  }
}
