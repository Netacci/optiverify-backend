# Email Hybrid Payment Strategy

This document outlines the email-based hybrid payment and access strategy for SupplierMatchAI, which provides secure, passwordless access to match reports while maintaining a frictionless user experience.

## Overview

The system uses a **hybrid approach** that combines:

- **Email verification** for secure access
- **Cryptographic tokens** for link security
- **Optional account creation** for subscribers
- **No signup required** for one-time buyers

## Architecture

### Core Components

1. **Email Service** (`src/services/emailService.js`)

   - Sends transactional emails via Resend
   - Handles payment confirmations, verifications, and subscription setup

2. **Token Service** (`src/services/tokenService.js`)

   - Generates secure, signed tokens for email links
   - Verifies token validity and expiration
   - Prevents token tampering and replay attacks

3. **Payment Controller** (`src/controllers/paymentController.js`)

   - Triggers email sending after successful payment
   - Generates tokens for email links

4. **Match Controller** (`src/controllers/matchController.js`)
   - Verifies tokens before granting report access
   - Validates email ownership through token verification

## User Flows

### Flow 1: One-Time Payment ($49)

```
1. User submits request → Gets preview
2. User pays $49 → Stripe webhook triggers
3. System generates secure token
4. Email sent with link: /report/[id]?token=xxx&email=xxx
5. User clicks link → Token verified → Report unlocked
6. Link valid for 30 days
```

**Key Features:**

- ✅ No signup required
- ✅ Secure email-based access
- ✅ Token expires after 30 days
- ✅ Can't be shared (token tied to email)

### Flow 2: Subscription Payment ($39/month, $429/year)

```
1. User subscribes → Payment succeeds
2. System sends "Set up account" email (optional)
3. If user clicks → Account created (passwordless)
4. If user skips → Email verification for future requests
5. Future requests with same email:
   - System checks for active subscription
   - Sends verification email
   - User verifies → Access granted
```

**Key Features:**

- ✅ Optional account creation
- ✅ Email verification for access
- ✅ Subscription tracking by email
- ✅ Dashboard access (if account created)

### Flow 3: Returning Subscriber

```
1. User enters email on new request
2. System checks: "Does this email have active subscription?"
3. If yes → Send verification email
4. User clicks verification link → Access granted
5. If email doesn't match → Verification fails
```

**Security:**

- ✅ Only email owner can access verification link
- ✅ Prevents email spoofing
- ✅ Token expires in 24 hours

## Security Model

### Token Generation

```javascript
Token =
  Base64URL(
    JSON({
      email: "user@example.com",
      requestId: "123",
      type: "payment",
      timestamp: 1234567890,
    })
  ) +
  "." +
  HMAC_SHA256(payload, SECRET);
```

**Properties:**

- **Signed**: Cannot be tampered with
- **Time-limited**: Expires based on type
- **Email-bound**: Tied to specific email
- **Request-bound**: Tied to specific request (for payment tokens)

### Token Types

| Type           | Expiry   | Use Case                           |
| -------------- | -------- | ---------------------------------- |
| `payment`      | 30 days  | Access to paid reports             |
| `verification` | 24 hours | Email verification for subscribers |
| `accountSetup` | 7 days   | Optional account creation          |

### Verification Process

1. **Extract token** from URL query parameter
2. **Decode payload** and verify signature
3. **Check expiration** based on token type
4. **Verify email** matches expected email
5. **Verify requestId** matches (for payment tokens)
6. **Grant access** if all checks pass

## Email Templates

### 1. Payment Confirmation Email

**Sent to:** One-time buyers  
**Contains:**

- Secure report link with token
- Plan information
- Expiry notice (30 days)

**Link Format:**

```
/report/[requestId]?token=[signed-token]&email=[user-email]
```

### 2. Subscription Setup Email

**Sent to:** Subscribers  
**Contains:**

- Welcome message
- Account setup link (optional)
- Benefits overview

**Link Format:**

```
/setup-account?token=[signed-token]&email=[user-email]
```

### 3. Verification Email

**Sent to:** Returning subscribers  
**Contains:**

- Verification link
- Context (new request or subscription access)

**Link Format:**

```
/verify-email?token=[signed-token]&email=[user-email]&requestId=[id]
```

## Implementation Details

### Environment Variables

```env
# Resend Configuration
RESEND_API_KEY=re_your_api_key_here
RESEND_FROM_EMAIL=noreply@yourdomain.com

# Token Security
TOKEN_SECRET=your-super-secret-key-change-this-in-production
```

**⚠️ Important:** Generate a strong `TOKEN_SECRET` in production:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### API Endpoints

#### Payment Webhook (Automatic Email Sending)

```javascript
POST / api / payments / webhook;
```

After successful payment:

1. Unlocks match report
2. Generates secure token
3. Sends appropriate email based on plan type

#### Report Access (Token Verification)

```javascript
GET /api/matches/:id/report?token=xxx&email=xxx
```

**Verification:**

- Token must be valid and not expired
- Email must match token payload
- RequestId must match (for payment tokens)
- Report must be unlocked

#### Test Email Endpoint

```javascript
POST /api/payments/test-email
Body: { "email": "test@example.com" }
```

For development/testing email functionality.

## Security Considerations

### ✅ What's Protected

1. **Email Ownership**: Only person with email access can verify
2. **Token Integrity**: HMAC signature prevents tampering
3. **Expiration**: Tokens expire automatically
4. **Request Binding**: Payment tokens tied to specific request
5. **Email Verification**: Prevents spoofing attacks

### ⚠️ What to Watch

1. **Token Secret**: Must be strong and kept secret
2. **Email Delivery**: Relies on email service (Resend)
3. **Token Storage**: Tokens in URLs (consider HTTPS only)
4. **Production Mode**: Token verification required in production

## Future Enhancements

### Phase 2: Dashboard Features

- [ ] User accounts with email-based login
- [ ] Dashboard to view all reports
- [ ] Search and filter reports
- [ ] Subscription management
- [ ] New request creation from dashboard

### Phase 3: Advanced Features

- [ ] Email preferences
- [ ] Report sharing (with permissions)
- [ ] Export reports (PDF, CSV)
- [ ] Notification preferences
- [ ] Multi-user accounts (enterprise)

## Testing

### Test Email Sending

```bash
curl -X POST http://localhost:5000/api/payments/test-email \
  -H "Content-Type: application/json" \
  -d '{"email": "your-email@example.com"}'
```

### Test Token Generation

```javascript
import { generateToken, verifyToken } from "./services/tokenService.js";

const token = generateToken("test@example.com", "123", "payment");
console.log("Token:", token);

const result = verifyToken(token, "test@example.com", "123", "payment");
console.log("Valid:", result.valid);
```

## Troubleshooting

### Emails Not Sending

1. Check `RESEND_API_KEY` is set correctly
2. Verify `RESEND_FROM_EMAIL` is verified in Resend
3. Check server logs for Resend errors
4. Test with `/api/payments/test-email` endpoint

### Token Verification Failing

1. Check `TOKEN_SECRET` matches between generation and verification
2. Verify token hasn't expired
3. Ensure email matches exactly (case-insensitive)
4. Check requestId matches (for payment tokens)

### Report Access Denied

1. Verify report status is "unlocked"
2. Check token is included in URL
3. Verify email matches token payload
4. Check token hasn't expired

## Best Practices

1. **Always use HTTPS** in production for token security
2. **Rotate TOKEN_SECRET** periodically
3. **Monitor email delivery** rates and failures
4. **Log token verification** attempts for security auditing
5. **Set appropriate expiry** times based on use case
6. **Handle email failures** gracefully (don't fail payment if email fails)

## Support

For issues or questions:

- Check server logs for detailed error messages
- Verify environment variables are set correctly
- Test email functionality with test endpoint
- Review Resend dashboard for delivery status
