import { Resend } from "resend";
import dotenv from "dotenv";

dotenv.config();

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3002";
const CUSTOMER_DASHBOARD_URL =
  process.env.CUSTOMER_DASHBOARD_URL || "http://localhost:3004";

const BRAND_NAME = process.env.BRAND_NAME || "Optiverifi";
const BRAND_TAGLINE =
  process.env.BRAND_TAGLINE || "AI-powered supplier matching";
const BRAND_PRIMARY = process.env.BRAND_PRIMARY_COLOR || "#2563eb"; // blue-600
const BRAND_PRIMARY_DARK = process.env.BRAND_PRIMARY_DARK_COLOR || "#1d4ed8"; // blue-700
const EMAIL_LOGO_URL = process.env.EMAIL_LOGO_URL || `${FRONTEND_URL}/logo.jpg`;
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || "support@optiverifi.com";

function renderTransactionalEmail({
  preheader = "",
  heading,
  intro,
  ctaText,
  ctaUrl,
  bodyHtml = "",
  securityNote = "",
  footerNote = "",
}) {
  const preheaderHtml = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#ffffff;opacity:0;">${preheader}</div>`
    : "";

  const ctaButtonHtml =
    ctaText && ctaUrl
      ? `
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin: 32px auto;">
          <tr>
            <td align="center" style="background-color: ${BRAND_PRIMARY}; border-radius: 8px;">
              <a href="${ctaUrl}"
                 style="display: inline-block; padding: 14px 32px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 16px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 8px;">
                ${ctaText}
              </a>
            </td>
          </tr>
        </table>
        <p style="font-size: 13px; color: #6b7280; line-height: 1.5; margin: 0 0 8px 0;">
          Button not working? Copy and paste this link into your browser:
        </p>
        <p style="font-size: 13px; color: ${BRAND_PRIMARY}; line-height: 1.5; margin: 0 0 24px 0; word-break: break-all;">
          <a href="${ctaUrl}" style="color: ${BRAND_PRIMARY}; text-decoration: underline;">${ctaUrl}</a>
        </p>
      `
      : "";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>${heading}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#111827;">
    ${preheaderHtml}
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f3f4f6;">
      <tr>
        <td align="center" style="padding: 32px 16px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
            <!-- Header -->
            <tr>
              <td style="padding: 28px 40px; background-color: #ffffff; border-bottom: 1px solid #e5e7eb;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                  <tr>
                    <td align="left" valign="middle">
                      <a href="${FRONTEND_URL}" style="text-decoration:none;color:#111827;display:inline-block;">
                        <img src="${EMAIL_LOGO_URL}" alt="${BRAND_NAME}" width="40" height="40" style="display:inline-block;vertical-align:middle;border-radius:8px;border:0;outline:none;text-decoration:none;">
                        <span style="font-size:20px;font-weight:700;letter-spacing:-0.01em;vertical-align:middle;margin-left:10px;color:#111827;">${BRAND_NAME}</span>
                      </a>
                    </td>
                    <td align="right" valign="middle" style="font-size:12px;color:#6b7280;">
                      ${BRAND_TAGLINE}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Body -->
            <tr>
              <td style="padding: 40px;">
                <h1 style="margin:0 0 16px 0;font-size:24px;font-weight:700;color:#111827;line-height:1.3;">
                  ${heading}
                </h1>
                <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.6; color: #374151;">
                  ${intro}
                </p>
                ${bodyHtml}
                ${ctaButtonHtml}
                ${
                  securityNote
                    ? `
                  <div style="margin: 24px 0 0 0; padding: 16px; background-color: #f9fafb; border-left: 3px solid ${BRAND_PRIMARY}; border-radius: 4px;">
                    <p style="margin: 0; font-size: 13px; line-height: 1.6; color: #4b5563;">
                      <strong style="color:#111827;">Heads up:</strong> ${securityNote}
                    </p>
                  </div>`
                    : ""
                }
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="padding: 24px 40px 32px 40px; background-color: #f9fafb; border-top: 1px solid #e5e7eb;">
                ${
                  footerNote
                    ? `<p style="margin:0 0 12px 0;font-size:12px;color:#6b7280;line-height:1.5;">${footerNote}</p>`
                    : ""
                }
                <p style="margin: 0; font-size: 12px; color: #9ca3af; line-height: 1.5;">
                  © ${new Date().getFullYear()} ${BRAND_NAME}. All rights reserved.<br>
                  Need help? Email us at <a href="mailto:${SUPPORT_EMAIL}" style="color:${BRAND_PRIMARY};text-decoration:none;">${SUPPORT_EMAIL}</a>.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * C-4: HTML-escape any user-controlled string before interpolating into HTML.
 * Use this for every field originating from external input (contact form,
 * buyer request body, supplier-supplied data, etc.) — NEVER for server-derived
 * content like URLs, plan names, or template literals built from config.
 *
 * Escapes: & < > " ' (the standard XSS-safe entity set for HTML body context).
 */
function escapeHtml(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

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

    const planLabel = planNames[planType] || "Match Report";
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: `Your supplier match report is ready (${planLabel})`,
      html: renderTransactionalEmail({
        preheader:
          "Your supplier match report has been generated and is ready to view.",
        heading: "Your match report is ready",
        intro: `Thanks for your purchase. We've generated your supplier match report and it's ready to view.`,
        bodyHtml: `
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f9fafb;border-radius:8px;border-left:3px solid ${BRAND_PRIMARY};margin: 24px 0;">
            <tr>
              <td style="padding: 16px 20px;">
                <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #4b5563;">
                  <strong style="color:#111827;">Plan:</strong> ${planLabel}<br>
                  <strong style="color:#111827;">Request ID:</strong> ${requestId}
                </p>
              </td>
            </tr>
          </table>
        `,
        ctaText: "View full report",
        ctaUrl: reportUrl,
        securityNote: `This link is private to you and will expire in 30 days. Don't share it with others. If you didn't make this purchase, please ignore this email.`,
      }),
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
        ? `Verify your email to access your ${BRAND_NAME} match report`
        : `Verify your email to continue with ${BRAND_NAME}`,
      html: renderTransactionalEmail({
        preheader: isNewRequest
          ? "Click the button to verify your email and unlock your match report."
          : "Click the button to verify your email and continue.",
        heading: isNewRequest
          ? "Verify your email to view your match report"
          : "Verify your email",
        intro: isNewRequest
          ? `Thanks for your purchase. To access your supplier match report and finish setting up your account, verify your email below. It only takes one click.`
          : `Click the button below to verify your email address and continue with your request.`,
        ctaText: "Verify email address",
        ctaUrl: verifyUrl,
        securityNote: `This link expires in 24 hours and can only be used once. If you didn't request this, you can safely ignore this email.`,
        footerNote: `You're receiving this email because someone (hopefully you) asked to verify <strong style="color:#111827;">${escapeHtml(
          email,
        )}</strong> on ${BRAND_NAME}.`,
      }),
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

    const planLabel = planNames[planType] || "Subscription";
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: `Set up your ${BRAND_NAME} account (${planLabel})`,
      html: renderTransactionalEmail({
        preheader:
          "You now have access to unlimited supplier matches. Set up your account to get started.",
        heading: `Welcome to ${BRAND_NAME}`,
        intro: `Thanks for subscribing. You now have access to unlimited supplier matches.`,
        bodyHtml: `
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f0f9ff;border-radius:8px;border-left:3px solid #0ea5e9;margin: 24px 0;">
            <tr>
              <td style="padding: 16px 20px;">
                <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #0c4a6e;">What's included:</p>
                <p style="margin: 0; font-size: 14px; line-height: 1.8; color: #0c4a6e;">
                  &bull; Unlimited match requests<br>
                  &bull; Access to all match reports<br>
                  &bull; Priority support<br>
                  &bull; A dashboard to manage every request
                </p>
              </td>
            </tr>
          </table>
        `,
        ctaText: "Set up your account",
        ctaUrl: setupUrl,
        securityNote: `Setting up an account is optional. It gives you a dashboard with every report and request in one place. If you'd rather not, you can keep using the verification link in each email.`,
      }),
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

    const planLabel = planNames[planType] || planType;
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: `Payment confirmed. Verify your account to access your matches`,
      html: renderTransactionalEmail({
        preheader:
          "Your payment is confirmed. Verify your email to access your supplier matches.",
        heading: "Payment confirmed",
        intro: `Thanks for your purchase. Your payment has been confirmed and your supplier match report is ready.`,
        bodyHtml: `
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f9fafb;border-radius:8px;border-left:3px solid ${BRAND_PRIMARY};margin: 24px 0;">
            <tr>
              <td style="padding: 16px 20px;">
                <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #4b5563;">
                  <strong style="color:#111827;">Plan:</strong> ${planLabel}<br>
                  <strong style="color:#111827;">Request ID:</strong> ${requestId}
                </p>
              </td>
            </tr>
          </table>
          <p style="margin: 16px 0 8px 0; font-size: 14px; font-weight: 600; color: #111827;">What happens next</p>
          <ol style="margin: 0 0 8px 0; padding-left: 20px; font-size: 14px; line-height: 1.7; color: #4b5563;">
            <li>Click the button below to verify your email.</li>
            <li>Create a password for your account.</li>
            <li>Log in to your dashboard.</li>
            <li>View all your supplier matches.</li>
          </ol>
        `,
        ctaText: "Verify email and create account",
        ctaUrl: verifyUrl,
        securityNote: `This verification link expires in 24 hours and can only be used once. If you didn't make this purchase, please ignore this email.`,
      }),
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
      subject: `Test email from ${BRAND_NAME}`,
      html: renderTransactionalEmail({
        preheader: `Test email from ${BRAND_NAME}.`,
        heading: "Test email",
        intro: `If you're seeing this, Resend is configured correctly and emails from ${BRAND_NAME} can reach this address.`,
      }),
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
      subject: `Reset your ${BRAND_NAME} password`,
      html: renderTransactionalEmail({
        preheader: "Click the button to choose a new password.",
        heading: "Reset your password",
        intro: `We received a request to reset the password on your ${BRAND_NAME} account. Click the button below to choose a new one.`,
        ctaText: "Reset password",
        ctaUrl: resetUrl,
        securityNote: `This link expires in 1 hour and can only be used once. If you didn't ask to reset your password, you can safely ignore this email and your current password will keep working.`,
      }),
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
 
  const safeItemName = escapeHtml(itemName);
  const safeCategory = escapeHtml(category);
  const safeTransactionId = escapeHtml(transactionId);
  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: `Payment receipt: managed service request #${requestId.slice(-8)}`,
      html: renderTransactionalEmail({
        preheader: `Receipt for $${formattedAmount} on managed service request #${requestId.slice(-8)}.`,
        heading: "Payment confirmed",
        intro: `Thanks for your payment. Your managed service request has been received and our sourcing team is reviewing it.`,
        bodyHtml: `
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f9fafb;border-radius:8px;border-left:3px solid ${BRAND_PRIMARY};margin: 24px 0;">
            <tr>
              <td style="padding: 16px 20px;">
                <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #111827;">Receipt details</p>
                <p style="margin: 0; font-size: 14px; line-height: 1.8; color: #4b5563;">
                  <strong style="color:#111827;">Transaction ID:</strong> ${safeTransactionId || requestId.slice(-8)}<br>
                  <strong style="color:#111827;">Item:</strong> ${safeItemName}<br>
                  ${category ? `<strong style="color:#111827;">Category:</strong> ${safeCategory}<br>` : ""}
                  <strong style="color:#111827;">Reference:</strong> #${requestId.slice(-8)}<br>
                  <strong style="color:#111827;">Amount:</strong> $${formattedAmount}
                </p>
              </td>
            </tr>
          </table>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f0f9ff;border-radius:8px;border-left:3px solid #0ea5e9;margin: 24px 0;">
            <tr>
              <td style="padding: 16px 20px;">
                <p style="margin: 0 0 4px 0; font-size: 14px; font-weight: 600; color: #0c4a6e;">What happens next</p>
                <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #0c4a6e;">
                  Our sourcing team will review your request and begin matching it with qualified suppliers. You'll receive updates via email as progress is made.
                </p>
              </td>
            </tr>
          </table>
          <p style="margin: 16px 0 0 0; font-size: 14px; line-height: 1.6; color: #4b5563;">
            Log in to your dashboard to track the status of your request and see supplier matches as they become available.
          </p>
        `,
      }),
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


  const safeMRItemName = escapeHtml(itemName);
  const safeMRCategory = escapeHtml(category);
  const safeMRTransactionId = escapeHtml(transactionId);
  const safeMRPlanLabel = escapeHtml(planLabels[planType] || planType || "");

  try {
    const detailRows = [
      `<tr><td style="padding: 8px 0; font-size: 14px; color: #6b7280; width: 45%;">Transaction ID</td><td style="padding: 8px 0; font-size: 14px; color: #111827; font-family: monospace;">${safeMRTransactionId}</td></tr>`,
      `<tr style="border-top: 1px solid #e5e7eb;"><td style="padding: 8px 0; font-size: 14px; color: #6b7280;">Payment date</td><td style="padding: 8px 0; font-size: 14px; color: #111827;">${formattedDate}</td></tr>`,
      itemName
        ? `<tr style="border-top: 1px solid #e5e7eb;"><td style="padding: 8px 0; font-size: 14px; color: #6b7280;">Item searched</td><td style="padding: 8px 0; font-size: 14px; color: #111827;">${safeMRItemName}</td></tr>`
        : "",
      category
        ? `<tr style="border-top: 1px solid #e5e7eb;"><td style="padding: 8px 0; font-size: 14px; color: #6b7280;">Category</td><td style="padding: 8px 0; font-size: 14px; color: #111827;">${safeMRCategory}</td></tr>`
        : "",
      planType
        ? `<tr style="border-top: 1px solid #e5e7eb;"><td style="padding: 8px 0; font-size: 14px; color: #6b7280;">Plan</td><td style="padding: 8px 0; font-size: 14px; color: #111827;">${safeMRPlanLabel}</td></tr>`
        : "",
      `<tr style="border-top: 1px solid #e5e7eb;"><td style="padding: 8px 0; font-size: 14px; color: #6b7280;">Amount paid</td><td style="padding: 8px 0; font-size: 16px; font-weight: 700; color: #111827;">${formattedAmount}</td></tr>`,
    ]
      .filter(Boolean)
      .join("");

    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: `Payment receipt: ${BRAND_NAME} match request`,
      html: renderTransactionalEmail({
        preheader: `Receipt for ${formattedAmount} on your ${BRAND_NAME} match request.`,
        heading: "Payment receipt",
        intro: `Thanks for your payment. Here is your receipt for the supplier match request.`,
        bodyHtml: `
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;margin: 24px 0;">
            <tr>
              <td style="padding: 20px 24px;">
                <p style="margin: 0 0 12px 0; font-size: 13px; font-weight: 600; color: #111827; text-transform: uppercase; letter-spacing: 0.05em;">Receipt details</p>
                <table style="width:100%;border-collapse:collapse;">
                  ${detailRows}
                </table>
              </td>
            </tr>
          </table>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#ecfdf5;border-radius:8px;border-left:3px solid #10b981;margin: 24px 0;">
            <tr>
              <td style="padding: 14px 20px;">
                <p style="margin: 0; font-size: 14px; color: #065f46;">
                  <strong style="color:#064e3b;">Payment received.</strong> Your supplier match request is being processed.
                </p>
              </td>
            </tr>
          </table>
          <p style="margin: 16px 0 0 0; font-size: 13px; color: #6b7280; line-height: 1.5;">
            Please keep this email for your records.
          </p>
        `,
      }),
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
export const sendInternalSourcingNotification = async (
  managedService,
  userEmail,
) => {
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


  const safeMS = {
    itemName: escapeHtml(managedService.itemName),
    category: escapeHtml(managedService.category),
    subCategory: escapeHtml(managedService.subCategory),
    quantity: escapeHtml(managedService.quantity),
    estimatedSpendRange: escapeHtml(managedService.estimatedSpendRange),
    deliveryLocation: escapeHtml(managedService.deliveryLocation),
    urgency: escapeHtml(managedService.urgency),
    complianceLevel: escapeHtml(managedService.complianceLevel),
    email: escapeHtml(managedService.email),
  };
  const safeUserEmail = escapeHtml(userEmail);
  const categoryDisplay =
    safeMS.category +
    (managedService.subCategory ? ` &gt; ${safeMS.subCategory}` : "");

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: "sourcing@optiverifi.com",
      // Note: subject is plain text, not HTML; use raw values here.
      subject: `New managed sourcing request: ${managedService.itemName} (${managedService.category})`,
      html: renderTransactionalEmail({
        preheader: `New managed sourcing request received. Payment confirmed.`,
        heading: "New sourcing request",
        intro: `A new managed sourcing request has come in. Payment is confirmed and it's now in your queue.`,
        bodyHtml: `
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#ecfdf5;border-radius:8px;border-left:3px solid #10b981;margin: 24px 0;">
            <tr>
              <td style="padding: 14px 20px;">
                <p style="margin: 0; font-size: 14px; color: #065f46;">
                  <strong style="color:#064e3b;">$199 service fee received on ${paidAt}.</strong> This request is now in your queue.
                </p>
              </td>
            </tr>
          </table>

          <p style="margin: 24px 0 12px 0; font-size: 13px; font-weight: 600; color: #111827; text-transform: uppercase; letter-spacing: 0.05em;">Customer</p>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;margin: 0 0 24px 0;">
            <tr>
              <td style="padding: 16px 20px;">
                <table style="width:100%;border-collapse:collapse;">
                  <tr>
                    <td style="padding: 8px 0; font-size: 14px; color: #6b7280; width: 40%;">Email</td>
                    <td style="padding: 8px 0; font-size: 14px; color: #111827;">${safeUserEmail || safeMS.email}</td>
                  </tr>
                  ${row("Request ID", managedService._id?.toString())}
                </table>
              </td>
            </tr>
          </table>

          <p style="margin: 24px 0 12px 0; font-size: 13px; font-weight: 600; color: #111827; text-transform: uppercase; letter-spacing: 0.05em;">Request details</p>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;margin: 0 0 24px 0;">
            <tr>
              <td style="padding: 16px 20px;">
                <table style="width:100%;border-collapse:collapse;">
                  <tr>
                    <td style="padding: 8px 0; font-size: 14px; color: #6b7280; width: 40%;">Item</td>
                    <td style="padding: 8px 0; font-size: 14px; font-weight: 600; color: #111827;">${safeMS.itemName}</td>
                  </tr>
                  ${row("Category", categoryDisplay)}
                  ${row("Quantity", safeMS.quantity)}
                  ${row("Budget range", safeMS.estimatedSpendRange)}
                  ${row("Delivery location", safeMS.deliveryLocation)}
                  ${row("Deadline", deadline)}
                  ${row("Urgency", safeMS.urgency)}
                  ${row("Compliance level", safeMS.complianceLevel)}
                  ${managedService.description ? row("Description", escapeHtml(managedService.description)) : ""}
                </table>
              </td>
            </tr>
          </table>
        `,
        footerNote: `Internal notification. Sent to sourcing@optiverifi.com.`,
      }),
    });

    if (error) {
      console.error("Resend error (internal sourcing notification):", error);
      throw error;
    }

    console.log(
      `✅ Internal sourcing notification sent to sourcing@optiverifi.com for request ${managedService._id}`,
    );
    return { success: true, data };
  } catch (error) {
    console.error("Error sending internal sourcing notification:", error);
    throw error;
  }
};

/**
 * Internal notification to info@optiverifi.com when a match request payment is received
 */
export const sendInternalMatchNotification = async (
  buyerRequest,
  userEmail,
  planType,
) => {
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

 
  const safeBR = {
    name: escapeHtml(buyerRequest.name),
    category: escapeHtml(buyerRequest.category),
    subCategory: escapeHtml(buyerRequest.subCategory),
    quantity: escapeHtml(buyerRequest.quantity),
    timeline: escapeHtml(buyerRequest.timeline),
    location: escapeHtml(buyerRequest.location),
    requirements: escapeHtml(buyerRequest.requirements),
    email: escapeHtml(buyerRequest.email),
  };
  const safeUserEmailMatch = escapeHtml(userEmail);
  const safePlanLabel = escapeHtml(planLabels[planType] || planType || "");
  const brCategoryDisplay =
    safeBR.category +
    (buyerRequest.subCategory ? ` &gt; ${safeBR.subCategory}` : "");
  // unitPrice is numeric server data, not free-text — but escape defensively
  // in case the schema ever loosens.
  const safeUnitPrice =
    buyerRequest.unitPrice != null
      ? `$${escapeHtml(buyerRequest.unitPrice)}`
      : null;

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: "info@optiverifi.com",
      // Note: subject is plain text, not HTML; raw values are fine here.
      subject: `New match request payment: ${buyerRequest.name} (${buyerRequest.category})`,
      html: renderTransactionalEmail({
        preheader: `New match request payment received.`,
        heading: "New match request",
        intro: `A new match request payment has been received and the buyer is now waiting on their report.`,
        bodyHtml: `
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#ecfdf5;border-radius:8px;border-left:3px solid #10b981;margin: 24px 0;">
            <tr>
              <td style="padding: 14px 20px;">
                <p style="margin: 0; font-size: 14px; color: #065f46;">
                  <strong style="color:#064e3b;">Payment received</strong> for a ${safePlanLabel || "match"} plan.
                </p>
              </td>
            </tr>
          </table>

          <p style="margin: 24px 0 12px 0; font-size: 13px; font-weight: 600; color: #111827; text-transform: uppercase; letter-spacing: 0.05em;">Customer</p>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;margin: 0 0 24px 0;">
            <tr>
              <td style="padding: 16px 20px;">
                <table style="width:100%;border-collapse:collapse;">
                  <tr>
                    <td style="padding: 8px 0; font-size: 14px; color: #6b7280; width: 40%;">Email</td>
                    <td style="padding: 8px 0; font-size: 14px; color: #111827;">${safeUserEmailMatch || safeBR.email}</td>
                  </tr>
                  ${row("Plan", safePlanLabel)}
                </table>
              </td>
            </tr>
          </table>

          <p style="margin: 24px 0 12px 0; font-size: 13px; font-weight: 600; color: #111827; text-transform: uppercase; letter-spacing: 0.05em;">Request details</p>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;margin: 0 0 24px 0;">
            <tr>
              <td style="padding: 16px 20px;">
                <table style="width:100%;border-collapse:collapse;">
                  <tr>
                    <td style="padding: 8px 0; font-size: 14px; color: #6b7280; width: 40%;">Item</td>
                    <td style="padding: 8px 0; font-size: 14px; font-weight: 600; color: #111827;">${safeBR.name}</td>
                  </tr>
                  ${row("Category", brCategoryDisplay)}
                  ${row("Quantity", safeBR.quantity)}
                  ${row("Unit price", safeUnitPrice)}
                  ${row("Timeline / deadline", safeBR.timeline)}
                  ${row("Delivery location", safeBR.location)}
                  ${row("Requirements", safeBR.requirements)}
                  ${buyerRequest.description ? row("Description", escapeHtml(buyerRequest.description)) : ""}
                </table>
              </td>
            </tr>
          </table>
        `,
        footerNote: `Internal notification. Sent to info@optiverifi.com.`,
      }),
    });

    if (error) {
      console.error("Resend error (internal match notification):", error);
      throw error;
    }

    console.log(
      `✅ Internal match notification sent to info@optiverifi.com for request ${buyerRequest._id}`,
    );
    return { success: true, data };
  } catch (error) {
    console.error("Error sending internal match notification:", error);
    throw error;
  }
};

/**
 * Send contact form email to support
 *
 * All user-controlled fields (name, email, company, role, message) MUST be
 * HTML-escaped via escapeHtml() before being interpolated into the body.
 * The contact form is unauthenticated, so any unescaped interpolation here is a
 * stored-phishing vector aimed at internal staff. Also caps message length to
 * 5000 characters to bound abuse.
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


    const MESSAGE_CAP = 5000;
    const rawMessage = String(message ?? "");
    const cappedMessage =
      rawMessage.length > MESSAGE_CAP
        ? rawMessage.slice(0, MESSAGE_CAP) + "…[truncated]"
        : rawMessage;

    const safeName = escapeHtml(name);
    const safeEmail = escapeHtml(email);
    const safeCompany = escapeHtml(company);
    const safeRole = escapeHtml(role);
    const safeRoleLabel = escapeHtml(roleLabels[role] || role || "");
    const safeMessage = escapeHtml(cappedMessage);

    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: supportEmail,
      replyTo: email,
      subject: `Contact form submission from ${safeName}`,
      html: renderTransactionalEmail({
        preheader: `New contact form submission from ${safeName}.`,
        heading: "New contact form submission",
        intro: `Someone submitted the contact form. Reply to this email to respond directly.`,
        bodyHtml: `
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;margin: 24px 0;">
            <tr>
              <td style="padding: 16px 20px;">
                <p style="margin: 0 0 8px 0; font-size: 14px; line-height: 1.7; color: #4b5563;">
                  <strong style="color:#111827;">Name:</strong> ${safeName}
                </p>
                <p style="margin: 0 0 8px 0; font-size: 14px; line-height: 1.7; color: #4b5563;">
                  <strong style="color:#111827;">Email:</strong> <a href="mailto:${safeEmail}" style="color: ${BRAND_PRIMARY}; text-decoration: none;">${safeEmail}</a>
                </p>
                ${
                  company
                    ? `<p style="margin: 0 0 8px 0; font-size: 14px; line-height: 1.7; color: #4b5563;">
                  <strong style="color:#111827;">Company:</strong> ${safeCompany}
                </p>`
                    : ""
                }
                ${
                  role
                    ? `<p style="margin: 0; font-size: 14px; line-height: 1.7; color: #4b5563;">
                  <strong style="color:#111827;">Role:</strong> ${safeRoleLabel || safeRole}
                </p>`
                    : ""
                }
              </td>
            </tr>
          </table>

          <p style="margin: 24px 0 8px 0; font-size: 13px; font-weight: 600; color: #111827; text-transform: uppercase; letter-spacing: 0.05em;">Message</p>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#f9fafb;border-radius:8px;border-left:3px solid ${BRAND_PRIMARY};margin: 0 0 24px 0;">
            <tr>
              <td style="padding: 16px 20px;">
                <p style="margin: 0; font-size: 14px; color: #374151; line-height: 1.6; white-space: pre-wrap;">${safeMessage}</p>
              </td>
            </tr>
          </table>
        `,
        footerNote: `Internal notification. Reply directly to respond to the sender.`,
      }),
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
