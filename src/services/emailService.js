import { Resend } from "resend";
import dotenv from "dotenv";

dotenv.config();

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3002";
const CUSTOMER_DASHBOARD_URL =
  process.env.CUSTOMER_DASHBOARD_URL || "http://localhost:3004";

/**
 * Send payment confirmation email with secure report link
 */
export const sendPaymentConfirmationEmail = async ({
  email,
  requestId,
  planType,
  token,
}) => {
  try {
    const reportUrl = `${FRONTEND_URL}/report/${requestId}?token=${token}&email=${encodeURIComponent(
      email,
    )}`;

    const planNames = {
      "one-time": "One-Time Match",
      monthly: "Monthly Unlimited",
      annual: "Annual Plan",
    };

    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: `Your Supplier Match Report is Ready - ${
        planNames[planType] || "Match Report"
      }`,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Your Match Report is Ready</title>
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
              <h1 style="color: white; margin: 0; font-size: 28px;">Your Match Report is Ready!</h1>
            </div>
            
            <div style="background: #ffffff; padding: 40px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
              <p style="font-size: 16px; margin-bottom: 20px;">
                Thank you for your purchase! Your supplier match report has been generated and is ready to view.
              </p>
              
              <div style="background: #f9fafb; padding: 20px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #667eea;">
                <p style="margin: 0; font-size: 14px; color: #6b7280;">
                  <strong>Plan:</strong> ${planNames[planType] || planType}<br>
                  <strong>Request ID:</strong> ${requestId}
                </p>
              </div>
              
              <div style="text-align: center; margin: 40px 0;">
                <a href="${reportUrl}" 
                   style="display: inline-block; background: #667eea; color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
                  View Full Report
                </a>
              </div>
              
              <p style="font-size: 14px; color: #6b7280; margin-top: 30px;">
                <strong>Important:</strong> This link is secure and will expire in 30 days. Keep it safe - you'll need it to access your report.
              </p>
              
              <p style="font-size: 14px; color: #6b7280; margin-top: 20px;">
                If you didn't make this request, please ignore this email.
              </p>
            </div>
            
            <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
              <p style="font-size: 12px; color: #9ca3af;">
                © ${new Date().getFullYear()} SupplierMatchAI. All rights reserved.
              </p>
            </div>
          </body>
        </html>
      `,
    });

    if (error) {
      console.error("Resend error:", error);
      throw error;
    }

    console.log(`✅ Payment confirmation email sent to ${email}`);
    return { success: true, data };
  } catch (error) {
    console.error("Error sending payment confirmation email:", error);
    throw error;
  }
};

/**
 * Send email verification token for returning subscribers
 */
export const sendVerificationEmail = async ({
  email,
  requestId,
  token,
  isNewRequest = false,
}) => {
  try {
    const verifyUrl = `${CUSTOMER_DASHBOARD_URL}/verify?token=${token}&email=${encodeURIComponent(
      email,
    )}&requestId=${requestId}`;

    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: isNewRequest
        ? "Verify Your Email to Access Your Match Report"
        : "Verify Your Email to Continue",
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Verify Your Email</title>
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
              <h1 style="color: white; margin: 0; font-size: 28px;">Verify Your Email</h1>
            </div>
            
            <div style="background: #ffffff; padding: 40px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
              <p style="font-size: 16px; margin-bottom: 20px;">
                ${
                  isNewRequest
                    ? "We found an active subscription for this email. Please verify your email to access your match report."
                    : "Please verify your email address to continue with your request."
                }
              </p>
              
              <div style="text-align: center; margin: 40px 0;">
                <a href="${verifyUrl}" 
                   style="display: inline-block; background: #667eea; color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
                  Verify Email Address
                </a>
              </div>
              
              <p style="font-size: 14px; color: #6b7280; margin-top: 30px;">
                <strong>Security Note:</strong> This verification link will expire in 24 hours. If you didn't request this, please ignore this email.
              </p>
            </div>
            
            <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
              <p style="font-size: 12px; color: #9ca3af;">
                © ${new Date().getFullYear()} SupplierMatchAI. All rights reserved.
              </p>
            </div>
          </body>
        </html>
      `,
    });

    if (error) {
      console.error("Resend error:", error);
      throw error;
    }

    console.log(`✅ Verification email sent to ${email}`);
    return { success: true, data };
  } catch (error) {
    console.error("Error sending verification email:", error);
    throw error;
  }
};

/**
 * Send subscription setup email (optional account creation)
 */
export const sendSubscriptionSetupEmail = async ({
  email,
  planType,
  token,
}) => {
  try {
    const setupUrl = `${CUSTOMER_DASHBOARD_URL}/verify?token=${token}&email=${encodeURIComponent(
      email,
    )}`;

    const planNames = {
      monthly: "Monthly Unlimited",
      annual: "Annual Plan",
    };

    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: `Set Up Your SupplierMatchAI Account - ${
        planNames[planType] || "Subscription"
      }`,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Set Up Your Account</title>
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
              <h1 style="color: white; margin: 0; font-size: 28px;">Welcome to SupplierMatchAI!</h1>
            </div>
            
            <div style="background: #ffffff; padding: 40px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
              <p style="font-size: 16px; margin-bottom: 20px;">
                Thank you for subscribing! You now have access to unlimited supplier matches.
              </p>
              
              <div style="background: #f0f9ff; padding: 20px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #0ea5e9;">
                <p style="margin: 0; font-size: 14px; color: #0c4a6e;">
                  <strong>What you get:</strong><br>
                  • Unlimited match requests<br>
                  • Access to all match reports<br>
                  • Priority support<br>
                  • Dashboard to manage all your requests
                </p>
              </div>
              
              <div style="text-align: center; margin: 40px 0;">
                <a href="${setupUrl}" 
                   style="display: inline-block; background: #667eea; color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
                  Set Up Your Account
                </a>
              </div>
              
              <p style="font-size: 14px; color: #6b7280; margin-top: 30px;">
                <strong>Optional:</strong> Setting up an account gives you easy access to all your reports and lets you make new requests from your dashboard. You can skip this and continue using email verification links.
              </p>
            </div>
            
            <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
              <p style="font-size: 12px; color: #9ca3af;">
                © ${new Date().getFullYear()} SupplierMatchAI. All rights reserved.
              </p>
            </div>
          </body>
        </html>
      `,
    });

    if (error) {
      console.error("Resend error:", error);
      throw error;
    }

    console.log(`✅ Subscription setup email sent to ${email}`);
    return { success: true, data };
  } catch (error) {
    console.error("Error sending subscription setup email:", error);
    throw error;
  }
};

/**
 * Send combined payment confirmation + verification email
 * This is the new flow: payment confirmation + account verification in one email
 */
export const sendPaymentAndVerificationEmail = async ({
  email,
  requestId,
  planType,
  verificationToken,
}) => {
  try {
    const verifyUrl = `${CUSTOMER_DASHBOARD_URL}/verify?token=${verificationToken}&email=${encodeURIComponent(
      email,
    )}`;

    const planNames = {
      "one-time": "One-Time Match",
      monthly: "Monthly Unlimited",
      annual: "Annual Plan",
      free: "Free Plan",
    };

    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: `Payment Confirmed - Verify Your Account to Access Your Matches`,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Payment Confirmed - Verify Your Account</title>
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
              <h1 style="color: white; margin: 0; font-size: 28px;">Payment Confirmed!</h1>
            </div>
            
            <div style="background: #ffffff; padding: 40px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
              <p style="font-size: 16px; margin-bottom: 20px;">
                Thank you for your purchase! Your payment has been confirmed and your supplier match report is ready.
              </p>
              
              <div style="background: #f9fafb; padding: 20px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #667eea;">
                <p style="margin: 0; font-size: 14px; color: #6b7280;">
                  <strong>Plan:</strong> ${planNames[planType] || planType}<br>
                  <strong>Request ID:</strong> ${requestId}
                </p>
              </div>
              
              <div style="background: #f0f9ff; padding: 20px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #0ea5e9;">
                <p style="margin: 0; font-size: 14px; color: #0c4a6e;">
                  <strong>Next Step:</strong> Verify your email and create your account to access your matches in your dashboard.
                </p>
              </div>
              
              <div style="text-align: center; margin: 40px 0;">
                <a href="${verifyUrl}" 
                   style="display: inline-block; background: #667eea; color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
                  Verify Email & Create Account
                </a>
              </div>
              
              <p style="font-size: 14px; color: #6b7280; margin-top: 30px;">
                <strong>What happens next:</strong><br>
                1. Click the button above to verify your email<br>
                2. Create a password for your account<br>
                3. Log in to your dashboard<br>
                4. View all your supplier matches
              </p>
              
              <p style="font-size: 14px; color: #6b7280; margin-top: 20px;">
                <strong>Security Note:</strong> This verification link will expire in 24 hours. If you didn't make this request, please ignore this email.
              </p>
            </div>
            
            <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
              <p style="font-size: 12px; color: #9ca3af;">
                © ${new Date().getFullYear()} SupplierMatchAI. All rights reserved.
              </p>
            </div>
          </body>
        </html>
      `,
    });

    if (error) {
      console.error("Resend error:", error);
      throw error;
    }

    console.log(
      `✅ Payment confirmation + verification email sent to ${email}`,
    );
    return { success: true, data };
  } catch (error) {
    console.error("Error sending payment and verification email:", error);
    throw error;
  }
};

/**
 * Generic email sending function (for managed services and other use cases)
 */
export const sendEmail = async ({ to, subject, html }) => {
  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html,
    });

    if (error) {
      console.error("Resend error:", error);
      throw error;
    }

    console.log(`✅ Email sent to ${to}`);
    return { success: true, data };
  } catch (error) {
    console.error("Error sending email:", error);
    throw error;
  }
};

/**
 * Test email function (for development)
 */
export const sendTestEmail = async (email) => {
  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: "Test Email from SupplierMatchAI",
      html: `
        <h1>Test Email</h1>
        <p>If you're seeing this, Resend is working correctly!</p>
      `,
    });

    if (error) {
      console.error("Resend error:", error);
      throw error;
    }

    return { success: true, data };
  } catch (error) {
    console.error("Error sending test email:", error);
    throw error;
  }
};

/**
 * Send password reset email
 */
export const sendPasswordResetEmail = async ({ email, resetToken }) => {
  try {
    const resetUrl = `${CUSTOMER_DASHBOARD_URL}/reset-password?token=${resetToken}&email=${encodeURIComponent(
      email,
    )}`;

    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: "Reset Your Password - SupplierMatchAI",
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Reset Your Password</title>
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
              <h1 style="color: white; margin: 0; font-size: 28px;">Reset Your Password</h1>
            </div>
            
            <div style="background: #ffffff; padding: 40px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
              <p style="font-size: 16px; margin-bottom: 20px;">
                We received a request to reset your password. Click the button below to create a new password.
              </p>
              
              <div style="text-align: center; margin: 40px 0;">
                <a href="${resetUrl}" 
                   style="display: inline-block; background: #667eea; color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
                  Reset Password
                </a>
              </div>
              
              <p style="font-size: 14px; color: #6b7280; margin-top: 30px;">
                <strong>Important:</strong> This link will expire in 1 hour for security reasons. If you didn't request a password reset, please ignore this email.
              </p>
              
              <p style="font-size: 14px; color: #6b7280; margin-top: 20px;">
                If the button doesn't work, copy and paste this link into your browser:<br>
                <a href="${resetUrl}" style="color: #667eea; word-break: break-all;">${resetUrl}</a>
              </p>
            </div>
            
            <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
              <p style="font-size: 12px; color: #9ca3af;">
                © ${new Date().getFullYear()} SupplierMatchAI. All rights reserved.
              </p>
            </div>
          </body>
        </html>
      `,
    });

    if (error) {
      console.error("Resend error:", error);
      throw error;
    }

    console.log(`✅ Password reset email sent to ${email}`);
    return { success: true, data };
  } catch (error) {
    console.error("Error sending password reset email:", error);
    throw error;
  }
};

/**
 * Send contact form email to support
 */
export const sendContactEmail = async ({
  name,
  email,
  company,
  role,
  message,
}) => {
  try {
    const supportEmail = "support@optiverifi.com";

    const roleLabels = {
      supplier: "Supplier",
      buyer: "Buyer",
      both: "Both Supplier and Buyer",
      other: "Other",
    };

    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: supportEmail,
      replyTo: email,
      subject: `Contact Form Submission from ${name}`,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Contact Form Submission</title>
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
              <h1 style="color: white; margin: 0; font-size: 28px;">New Contact Form Submission</h1>
            </div>
            
            <div style="background: #ffffff; padding: 40px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
              <div style="background: #f9fafb; padding: 20px; border-radius: 8px; margin-bottom: 30px;">
                <p style="margin: 0 0 10px 0; font-size: 14px; color: #6b7280;">
                  <strong style="color: #374151;">Name:</strong> ${name}
                </p>
                <p style="margin: 0 0 10px 0; font-size: 14px; color: #6b7280;">
                  <strong style="color: #374151;">Email:</strong> <a href="mailto:${email}" style="color: #667eea;">${email}</a>
                </p>
                ${
                  company
                    ? `<p style="margin: 0 0 10px 0; font-size: 14px; color: #6b7280;">
                  <strong style="color: #374151;">Company:</strong> ${company}
                </p>`
                    : ""
                }
                ${
                  role
                    ? `<p style="margin: 0 0 10px 0; font-size: 14px; color: #6b7280;">
                  <strong style="color: #374151;">Role:</strong> ${roleLabels[role] || role}
                </p>`
                    : ""
                }
              </div>
              
              <div style="margin-top: 30px;">
                <h2 style="font-size: 18px; color: #374151; margin-bottom: 15px;">Message:</h2>
                <div style="background: #f9fafb; padding: 20px; border-radius: 8px; border-left: 4px solid #667eea;">
                  <p style="margin: 0; font-size: 14px; color: #374151; white-space: pre-wrap;">${message}</p>
                </div>
              </div>
              
            </div>
            
            <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
              <p style="font-size: 12px; color: #9ca3af;">
                © ${new Date().getFullYear()} Optiverifi. All rights reserved.
              </p>
            </div>
          </body>
        </html>
      `,
    });

    if (error) {
      console.error("Resend error:", error);
      throw error;
    }

    console.log(`✅ Contact form email sent to ${supportEmail} from ${email}`);
    return { success: true, data };
  } catch (error) {
    console.error("Error sending contact email:", error);
    throw error;
  }
};
