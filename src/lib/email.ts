import { Resend } from 'resend';

import { env } from './env';

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

export async function sendVerificationCode(
  email: string,
  code: string
): Promise<{ success: boolean; error?: string }> {
  if (!resend) {
    console.error('RESEND_API_KEY is not configured');
    return { success: false, error: 'Email service not configured' };
  }

  if (!env.EMAIL_FROM) {
    console.error('EMAIL_FROM is not configured');
    return { success: false, error: 'Email sender not configured' };
  }

  try {
    const { error } = await resend.emails.send({
      from: env.EMAIL_FROM,
      to: email,
      subject: `Your verification code`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333; margin-bottom: 20px;">Verification Code</h2>
          <p style="color: #666; margin-bottom: 20px;">
            Use the following code to sign in to your account:
          </p>
          <div style="background: #f5f5f5; padding: 20px; text-align: center; border-radius: 8px; margin-bottom: 20px;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #333;">
              ${code}
            </span>
          </div>
          <p style="color: #999; font-size: 14px;">
            This code will expire in 10 minutes. If you didn't request this code, please ignore this email.
          </p>
        </div>
      `
    });

    if (error) {
      console.error('Failed to send email:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    console.error('Email sending error:', error);
    const message =
      error instanceof Error ? error.message : 'Failed to send email';
    return { success: false, error: message };
  }
}
