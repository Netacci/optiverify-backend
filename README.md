# SupplyAI Backend

Express.js backend API for SupplierMatchAI platform.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file in the root directory:
```env
MONGO_URL=your_mongodb_connection_string
PORT=5000
FRONTEND_URL=http://localhost:3000
OPENAI_API_KEY=your_openai_api_key_here  # Optional - falls back to rule-based matching if not provided
STRIPE_SECRET_KEY=your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret
RESEND_API_KEY=re_your_resend_api_key_here
RESEND_FROM_EMAIL=noreply@yourdomain.com
TOKEN_SECRET=your-super-secret-key-change-this-in-production
```

3. Seed the database with dummy suppliers:
```bash
npm run seed
```

4. Start the development server:
```bash
npm run dev
```

## AI Integration

The matching system uses OpenAI's GPT-4o-mini model for enhanced supplier matching. The system will:

- **With API Key**: Use AI for semantic matching, intelligent scoring, and personalized explanations
- **Without API Key**: Automatically fall back to rule-based matching (still functional)

### AI Features:
- Semantic understanding of requests and supplier profiles
- Intelligent match scoring (0-100)
- Personalized explanations for each match
- Request summary generation
- Identifies strengths and concerns for each supplier

### Environment Variable:
Add `OPENAI_API_KEY` to your `.env` file to enable AI features. The system works without it but will use rule-based matching instead.

## API Endpoints

### Requests
- `POST /api/requests` - Create a buyer request
- `POST /api/requests/:id/match` - Process matching for a request

### Matches
- `GET /api/matches/:id/preview` - Get free preview (1 supplier)
- `GET /api/matches/:id/report` - Get full report (requires payment)

### Payments
- `POST /api/payments/checkout` - Create Stripe checkout session
- `POST /api/payments/webhook` - Stripe webhook handler
- `POST /api/payments/test-email` - Test email sending (development only)

## Models

- **BuyerRequest**: Stores buyer sourcing requests
- **Supplier**: Supplier database
- **MatchReport**: Generated match reports with preview and full data
- **Payment**: Payment records
