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
                    ? "We received your payment. Please verify your email to access your match report."
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
 * Send managed service payment receipt email
 * For users who are already verified - shows payment details instead of verification
 */
export const sendManagedServiceReceiptEmail = async ({
  email,
  requestId,
  transactionId,
  itemName,
  category,
  serviceFeeAmount,
}) => {
  const formattedAmount = Number(serviceFeeAmount).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: `Payment Receipt - Managed Service Request #${requestId.slice(-8)}`,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Payment Receipt</title>
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
              <h1 style="color: white; margin: 0; font-size: 28px;">Payment Confirmed!</h1>
            </div>

            <div style="background: #ffffff; padding: 40px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
              <p style="font-size: 16px; margin-bottom: 20px;">
                Thank you for your payment! Your managed service request has been received and your sourcing team is reviewing it.
              </p>

              <div style="background: #f9fafb; padding: 20px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #667eea;">
                <p style="margin: 0 0 15px 0; font-size: 14px; color: #6b7280;">
                  <strong>Receipt Details:</strong>
                </p>
                <p style="margin: 0 0 10px 0; font-size: 14px; color: #6b7280;">
                  <strong>Transaction ID:</strong> ${transactionId || requestId.slice(-8)}
                </p>
                <p style="margin: 0 0 10px 0; font-size: 14px; color: #6b7280;">
                  <strong>Item:</strong> ${itemName}
                </p>
                ${category ? `<p style="margin: 0 0 10px 0; font-size: 14px; color: #6b7280;"><strong>Category:</strong> ${category}</p>` : ""}
                <p style="margin: 0 0 10px 0; font-size: 14px; color: #6b7280;">
                  <strong>Reference:</strong> #${requestId.slice(-8)}
                </p>
                <p style="margin: 0; font-size: 14px; color: #374151;">
                  <strong>Amount:</strong> $${formattedAmount}
                </p>
              </div>

              <div style="background: #f0f9ff; padding: 20px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #0ea5e9;">
                <p style="margin: 0; font-size: 14px; color: #0c4a6e;">
                  <strong>What's Next?</strong><br>
                  Our sourcing team will review your request and begin matching it with qualified suppliers. You'll receive updates via email as progress is made.
                </p>
              </div>

              <p style="font-size: 14px; color: #6b7280; margin-top: 30px;">
                <strong>Log in to your dashboard</strong> to track the status of your request and view supplier matches as they become available.
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

    console.log(`✅ Managed service receipt email sent to ${email}`);
    return { success: true, data };
  } catch (error) {
    console.error("Error sending managed service receipt email:", error);
    throw error;
  }
};

/**
 * Send match request payment receipt email
 * Sent to all users (verified and unverified) after a successful match payment
 */
export const sendMatchPaymentReceiptEmail = async ({
  email,
  transactionId,
  amount,
  itemName,
  category,
  paidAt,
  planType,
}) => {
  const formattedAmount = Number(amount).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const formattedDate = paidAt
    ? new Date(paidAt).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

  const planLabels = {
    "one-time": "One-Time Match",
    starter_monthly: "Starter Plan (Monthly)",
    starter_annual: "Starter Plan (Annual)",
    professional_monthly: "Professional Plan (Monthly)",
    professional_annual: "Professional Plan (Annual)",
    extra_credit: "Credit Top-Up",
  };

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: `Payment Receipt - Optiverifi Match Request`,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Payment Receipt</title>
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #1f2937 0%, #374151 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
              <h1 style="color: white; margin: 0 0 6px 0; font-size: 26px;">Payment Receipt</h1>
              <p style="color: #d1d5db; margin: 0; font-size: 14px;">Optiverifi</p>
            </div>

            <div style="background: #ffffff; padding: 40px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
              <p style="font-size: 16px; margin-bottom: 24px; color: #374151;">
                Thank you for your payment. Here is your receipt for the supplier match request.
              </p>

              <div style="background: #f9fafb; padding: 24px; border-radius: 8px; margin: 0 0 24px 0; border: 1px solid #e5e7eb;">
                <h2 style="margin: 0 0 16px 0; font-size: 15px; color: #111827; text-transform: uppercase; letter-spacing: 0.05em;">Receipt Details</h2>
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 8px 0; font-size: 14px; color: #6b7280; width: 45%;">Transaction ID</td>
                    <td style="padding: 8px 0; font-size: 14px; color: #111827; font-family: monospace;">${transactionId}</td>
                  </tr>
                  <tr style="border-top: 1px solid #e5e7eb;">
                    <td style="padding: 8px 0; font-size: 14px; color: #6b7280;">Payment Date</td>
                    <td style="padding: 8px 0; font-size: 14px; color: #111827;">${formattedDate}</td>
                  </tr>
                  ${itemName ? `
                  <tr style="border-top: 1px solid #e5e7eb;">
                    <td style="padding: 8px 0; font-size: 14px; color: #6b7280;">Item Searched</td>
                    <td style="padding: 8px 0; font-size: 14px; color: #111827;">${itemName}</td>
                  </tr>` : ""}
                  ${category ? `
                  <tr style="border-top: 1px solid #e5e7eb;">
                    <td style="padding: 8px 0; font-size: 14px; color: #6b7280;">Category</td>
                    <td style="padding: 8px 0; font-size: 14px; color: #111827;">${category}</td>
                  </tr>` : ""}
                  ${planType ? `
                  <tr style="border-top: 1px solid #e5e7eb;">
                    <td style="padding: 8px 0; font-size: 14px; color: #6b7280;">Plan</td>
                    <td style="padding: 8px 0; font-size: 14px; color: #111827;">${planLabels[planType] || planType}</td>
                  </tr>` : ""}
                  <tr style="border-top: 1px solid #e5e7eb;">
                    <td style="padding: 8px 0; font-size: 14px; color: #6b7280;">Amount Paid</td>
                    <td style="padding: 8px 0; font-size: 16px; font-weight: 700; color: #111827;">${formattedAmount}</td>
                  </tr>
                </table>
              </div>

              <div style="background: #ecfdf5; padding: 16px 20px; border-radius: 8px; border-left: 4px solid #10b981; margin-bottom: 24px;">
                <p style="margin: 0; font-size: 14px; color: #065f46;">
                  <strong>Payment received</strong> — your supplier match request is being processed.
                </p>
              </div>

              <p style="font-size: 13px; color: #9ca3af; margin-top: 20px;">
                Please keep this email for your records. If you have any questions, contact us at support@optiverifi.com.
              </p>
            </div>

            <div style="text-align: center; margin-top: 24px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
              <p style="font-size: 12px; color: #9ca3af; margin: 0;">
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

    console.log(`✅ Match payment receipt email sent to ${email}`);
    return { success: true, data };
  } catch (error) {
    console.error("Error sending match payment receipt email:", error);
    throw error;
  }
};

/**
 * Internal notification to sourcing@optiverifi.com when a managed service payment is received
 */
export const sendInternalSourcingNotification = async (managedService, userEmail) => {
  const deadline = managedService.internalDeadline
    ? new Date(managedService.internalDeadline).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "Not specified";

  const paidAt = managedService.serviceFeePaidAt
    ? new Date(managedService.serviceFeePaidAt).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

  const row = (label, value) =>
    value
      ? `<tr style="border-top: 1px solid #e5e7eb;">
           <td style="padding: 8px 0; font-size: 14px; color: #6b7280; width: 40%; vertical-align: top;">${label}</td>
           <td style="padding: 8px 0; font-size: 14px; color: #111827;">${value}</td>
         </tr>`
      : "";

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: "sourcing@optiverifi.com",
      subject: `New Managed Sourcing Request — ${managedService.itemName} (${managedService.category})`,
      html: `
        <!DOCTYPE html>
        <html>
          <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #1f2937 0%, #374151 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
              <h1 style="color: white; margin: 0 0 6px 0; font-size: 24px;">New Sourcing Request</h1>
              <p style="color: #d1d5db; margin: 0; font-size: 14px;">Payment confirmed — action required</p>
            </div>

            <div style="background: #ffffff; padding: 40px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
              <div style="background: #ecfdf5; padding: 14px 18px; border-radius: 8px; border-left: 4px solid #10b981; margin-bottom: 28px;">
                <p style="margin: 0; font-size: 14px; color: #065f46;">
                  <strong>$199 service fee received on ${paidAt}.</strong> This request is now in your queue.
                </p>
              </div>

              <h2 style="margin: 0 0 16px 0; font-size: 15px; color: #111827; text-transform: uppercase; letter-spacing: 0.05em;">Customer</h2>
              <div style="background: #f9fafb; padding: 20px; border-radius: 8px; margin-bottom: 28px; border: 1px solid #e5e7eb;">
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 8px 0; font-size: 14px; color: #6b7280; width: 40%;">Email</td>
                    <td style="padding: 8px 0; font-size: 14px; color: #111827;">${userEmail || managedService.email}</td>
                  </tr>
                  ${row("Request ID", managedService._id?.toString())}
                </table>
              </div>

              <h2 style="margin: 0 0 16px 0; font-size: 15px; color: #111827; text-transform: uppercase; letter-spacing: 0.05em;">Request Details</h2>
              <div style="background: #f9fafb; padding: 20px; border-radius: 8px; margin-bottom: 28px; border: 1px solid #e5e7eb;">
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 8px 0; font-size: 14px; color: #6b7280; width: 40%;">Item</td>
                    <td style="padding: 8px 0; font-size: 14px; font-weight: 600; color: #111827;">${managedService.itemName}</td>
                  </tr>
                  ${row("Category", managedService.category + (managedService.subCategory ? ` > ${managedService.subCategory}` : ""))}
                  ${row("Quantity", managedService.quantity)}
                  ${row("Budget Range", managedService.estimatedSpendRange)}
                  ${row("Delivery Location", managedService.deliveryLocation)}
                  ${row("Deadline", deadline)}
                  ${row("Urgency", managedService.urgency)}
                  ${row("Compliance Level", managedService.complianceLevel)}
                  ${managedService.description ? row("Description", managedService.description.replace(/</g, "&lt;").replace(/>/g, "&gt;")) : ""}
                </table>
              </div>
            </div>

            <div style="text-align: center; margin-top: 24px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
              <p style="font-size: 12px; color: #9ca3af; margin: 0;">© ${new Date().getFullYear()} Optiverifi — Internal Notification</p>
            </div>
          </body>
        </html>
      `,
    });

    if (error) {
      console.error("Resend error (internal sourcing notification):", error);
      throw error;
    }

    console.log(`✅ Internal sourcing notification sent to sourcing@optiverifi.com for request ${managedService._id}`);
    return { success: true, data };
  } catch (error) {
    console.error("Error sending internal sourcing notification:", error);
    throw error;
  }
};

/**
 * Internal notification to info@optiverifi.com when a match request payment is received
 */
export const sendInternalMatchNotification = async (buyerRequest, userEmail, planType) => {
  const planLabels = {
    "one-time": "One-Time Match",
    starter_monthly: "Starter Plan (Monthly)",
    starter_annual: "Starter Plan (Annual)",
    professional_monthly: "Professional Plan (Monthly)",
    professional_annual: "Professional Plan (Annual)",
    extra_credit: "Credit Top-Up",
  };

  const row = (label, value) =>
    value
      ? `<tr style="border-top: 1px solid #e5e7eb;">
           <td style="padding: 8px 0; font-size: 14px; color: #6b7280; width: 40%; vertical-align: top;">${label}</td>
           <td style="padding: 8px 0; font-size: 14px; color: #111827;">${value}</td>
         </tr>`
      : "";

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: "info@optiverifi.com",
      subject: `New Match Request Payment — ${buyerRequest.name} (${buyerRequest.category})`,
      html: `
        <!DOCTYPE html>
        <html>
          <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #1f2937 0%, #374151 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
              <h1 style="color: white; margin: 0 0 6px 0; font-size: 24px;">New Match Request</h1>
              <p style="color: #d1d5db; margin: 0; font-size: 14px;">Payment confirmed</p>
            </div>

            <div style="background: #ffffff; padding: 40px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
              <div style="background: #ecfdf5; padding: 14px 18px; border-radius: 8px; border-left: 4px solid #10b981; margin-bottom: 28px;">
                <p style="margin: 0; font-size: 14px; color: #065f46;">
                  <strong>Payment received</strong> for a ${planLabels[planType] || planType || "match"} plan.
                </p>
              </div>

              <h2 style="margin: 0 0 16px 0; font-size: 15px; color: #111827; text-transform: uppercase; letter-spacing: 0.05em;">Customer</h2>
              <div style="background: #f9fafb; padding: 20px; border-radius: 8px; margin-bottom: 28px; border: 1px solid #e5e7eb;">
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 8px 0; font-size: 14px; color: #6b7280; width: 40%;">Email</td>
                    <td style="padding: 8px 0; font-size: 14px; color: #111827;">${userEmail || buyerRequest.email}</td>
                  </tr>
                  ${row("Plan", planLabels[planType] || planType)}
                </table>
              </div>

              <h2 style="margin: 0 0 16px 0; font-size: 15px; color: #111827; text-transform: uppercase; letter-spacing: 0.05em;">Request Details</h2>
              <div style="background: #f9fafb; padding: 20px; border-radius: 8px; margin-bottom: 28px; border: 1px solid #e5e7eb;">
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 8px 0; font-size: 14px; color: #6b7280; width: 40%;">Item</td>
                    <td style="padding: 8px 0; font-size: 14px; font-weight: 600; color: #111827;">${buyerRequest.name}</td>
                  </tr>
                  ${row("Category", buyerRequest.category + (buyerRequest.subCategory ? ` > ${buyerRequest.subCategory}` : ""))}
                  ${row("Quantity", buyerRequest.quantity)}
                  ${row("Unit Price", buyerRequest.unitPrice != null ? `$${buyerRequest.unitPrice}` : null)}
                  ${row("Timeline / Deadline", buyerRequest.timeline)}
                  ${row("Delivery Location", buyerRequest.location)}
                  ${row("Requirements", buyerRequest.requirements)}
                  ${buyerRequest.description ? row("Description", buyerRequest.description.replace(/</g, "&lt;").replace(/>/g, "&gt;")) : ""}
                </table>
              </div>
            </div>

            <div style="text-align: center; margin-top: 24px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
              <p style="font-size: 12px; color: #9ca3af; margin: 0;">© ${new Date().getFullYear()} Optiverifi — Internal Notification</p>
            </div>
          </body>
        </html>
      `,
    });

    if (error) {
      console.error("Resend error (internal match notification):", error);
      throw error;
    }

    console.log(`✅ Internal match notification sent to info@optiverifi.com for request ${buyerRequest._id}`);
    return { success: true, data };
  } catch (error) {
    console.error("Error sending internal match notification:", error);
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
