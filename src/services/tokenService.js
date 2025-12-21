import crypto from "crypto";

const SECRET = process.env.TOKEN_SECRET || "your-secret-key-change-in-production";
const TOKEN_EXPIRY = {
  payment: 30 * 24 * 60 * 60 * 1000, // 30 days
  verification: 24 * 60 * 60 * 1000, // 24 hours
  accountSetup: 7 * 24 * 60 * 60 * 1000, // 7 days
  passwordReset: 1 * 60 * 60 * 1000, // 1 hour
};

/**
 * Generate a secure token for email links
 * @param {string} email - User's email address
 * @param {string} requestId - Request ID (optional for account setup)
 * @param {string} type - Token type: 'payment', 'verification', or 'accountSetup'
 * @returns {string} Secure token
 */
export const generateToken = (email, requestId, type = "payment") => {
  const payload = {
    email: email.toLowerCase().trim(),
    requestId: requestId ? requestId.toString() : null,
    type,
    timestamp: Date.now(),
  };

  const payloadString = JSON.stringify(payload);
  const hmac = crypto.createHmac("sha256", SECRET);
  hmac.update(payloadString);
  const signature = hmac.digest("hex");

  // Combine payload and signature
  const token = Buffer.from(payloadString).toString("base64url") + "." + signature;
  return token;
};

/**
 * Verify and decode a token
 * @param {string} token - Token to verify
 * @param {string} expectedEmail - Expected email address
 * @param {string} expectedRequestId - Expected request ID (optional)
 * @param {string} type - Expected token type
 * @returns {Object} Verification result with valid flag and payload/error
 */
export const verifyToken = (token, expectedEmail, expectedRequestId, type = "payment") => {
  try {
    const [payloadBase64, signature] = token.split(".");
    
    if (!payloadBase64 || !signature) {
      return { valid: false, error: "Invalid token format" };
    }

    // Decode payload
    const payloadString = Buffer.from(payloadBase64, "base64url").toString("utf-8");
    const payload = JSON.parse(payloadString);

    // Verify signature
    const hmac = crypto.createHmac("sha256", SECRET);
    hmac.update(payloadString);
    const expectedSignature = hmac.digest("hex");

    if (signature !== expectedSignature) {
      return { valid: false, error: "Invalid token signature" };
    }

    // Verify email matches (with better logging)
    const normalizedPayloadEmail = payload.email.toLowerCase().trim();
    const normalizedExpectedEmail = expectedEmail.toLowerCase().trim();
    
    if (normalizedPayloadEmail !== normalizedExpectedEmail) {
      console.log(`[Token Mismatch] Payload: '${normalizedPayloadEmail}', Expected: '${normalizedExpectedEmail}'`);
      return { valid: false, error: "Email mismatch" };
    }

    // Verify requestId matches (if provided)
    if (expectedRequestId && payload.requestId !== expectedRequestId.toString()) {
      return { valid: false, error: "Request ID mismatch" };
    }

    // Verify type matches
    if (payload.type !== type) {
      return { valid: false, error: "Token type mismatch" };
    }

    // Check expiry
    const expiryTime = TOKEN_EXPIRY[payload.type] || TOKEN_EXPIRY.payment;
    const isExpired = Date.now() - payload.timestamp > expiryTime;

    if (isExpired) {
      return { valid: false, error: "Token expired" };
    }

    return {
      valid: true,
      payload: {
        email: payload.email,
        requestId: payload.requestId,
        type: payload.type,
      },
    };
  } catch (error) {
    return { valid: false, error: "Token verification failed: " + error.message };
  }
};

