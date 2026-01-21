# Authentication & Payment System

This document describes the authentication and payment infrastructure for the Recordio Chrome extension.

## Table of Contents
- [Overview](#overview)
- [Authentication Flow](#authentication-flow)
- [Payment Flow](#payment-flow)
- [Subscription Management](#subscription-management)
- [Technical Architecture](#technical-architecture)
- [Configuration](#configuration)

---

## Overview

Recordio uses a serverless authentication and payment system:
- **Auth Provider:** Supabase Auth (Google OAuth)
- **Payment Provider:** Stripe
- **Backend:** Supabase Edge Functions (Deno)
- **Session Storage:** Browser localStorage (via Supabase client)

### Key Features
- ✅ Chrome extension-native OAuth using `chrome.identity` API
- ✅ Secure server-side checkout sessions
- ✅ Webhook-based subscription state synchronization
- ✅ Real-time subscription status updates
- ✅ 60-day persistent sessions with auto-refresh

---

## Authentication Flow

### 1. Google OAuth Integration

**Implementation:** `src/auth/AuthManager.ts`

The extension uses the **Chrome Identity API** for OAuth:

```typescript
chrome.identity.launchWebAuthFlow({
  url: supabaseOAuthUrl,
  interactive: true
}, (redirectUrl) => {
  // Extract tokens from redirect URL hash
  const access_token = hashParams.get('access_token');
  const refresh_token = hashParams.get('refresh_token');
  
  // Set Supabase session
  await supabase.auth.setSession({ access_token, refresh_token });
});
```

### 2. OAuth Flow Steps

1. User clicks "Sign In with Google" in `AuthModal.tsx`
2. `AuthManager.signInWithProvider()` is called
3. Supabase generates OAuth URL with `skipBrowserRedirect: true`
4. `chrome.identity.launchWebAuthFlow()` opens Google consent screen
5. Google redirects to `https://<extension-id>.chromiumapp.org/` with tokens in hash
6. Tokens are extracted and passed to `supabase.auth.setSession()`
7. Session is stored in browser localStorage
8. Auth state listener updates `useUserStore`

### 3. Session Management

**Tokens:**
- **Access Token:** Expires in 1 hour
- **Refresh Token:** Valid for ~60 days
- **Auto-refresh:** Supabase client automatically refreshes access tokens

**State Management:** `src/stores/useUserStore.ts`
```typescript
{
  userId: string | null,
  email: string | null,
  subscription: {
    status: 'active' | 'free',
    planId: string | null,
    currentPeriodEnd: Date | null,
    cancelAtPeriodEnd: boolean
  }
}
```

### 4. Auth Listener

In `src/editor/App.tsx`, the auth state listener:
- Detects session changes
- Fetches subscription data from Supabase
- Updates user store for UI reactivity

---

## Payment Flow

### 1. Checkout Process

**Entry Point:** `src/components/ui/UpgradeModal.tsx`

**Flow:**
1. User clicks "Upgrade to Pro"
2. `StripeService.createCheckoutSession()` calls Edge Function
3. Server creates Stripe checkout session
4. Opens checkout in new browser tab
5. User completes payment
6. Stripe redirects to success URL (currently `https://recordio.site/subscription-success`)
7. Extension polls subscription table for updates

### 2. Server-Side Checkout

**Edge Function:** `supabase/functions/create-checkout-session/index.ts`

```typescript
const session = await stripe.checkout.sessions.create({
  customer_email: user.email,
  line_items: [{
    price: STRIPE_PRICE_ID,
    quantity: 1,
  }],
  mode: 'subscription',
  success_url: `${redirectUrl}/payment/success`,
  cancel_url: redirectUrl,
  metadata: { user_id: user.id }
});
```

**Why Server-Side:**
- Bypasses Chrome extension CSP restrictions
- Keeps Stripe API keys secure
- Prevents client-side manipulation

### 3. Webhook Handling

**Edge Function:** `supabase/functions/stripe-webhooks/index.ts`

**Events Handled:**
- `checkout.session.completed` - Initial subscription creation
- `customer.subscription.created` - Subscription created
- `customer.subscription.updated` - Renewal, plan changes
- `customer.subscription.deleted` - Cancellation

**Webhook Flow:**
1. Stripe sends event to webhook endpoint
2. Signature verification using `STRIPE_WEBHOOK_SECRET`
3. Event processed and subscription record updated in `subscriptions` table
4. Extension detects changes via polling or auth state refresh

### 4. Real-Time Subscription Updates

**Polling Implementation:** `src/components/ui/UpgradeModal.tsx`

After checkout opens:
```typescript
const pollInterval = setInterval(async () => {
  const { data } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .single();
  
  if (data?.status === 'active') {
    // Update user store with Pro status
    setSubscription(data);
    clearInterval(pollInterval);
    onClose();
  }
}, 1000);
```

---

## Subscription Management

### Database Schema

**Table:** `subscriptions`

```sql
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT UNIQUE,
  status TEXT NOT NULL,
  plan_id TEXT,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### Feature Gating

**Implementation:** Check `useUserStore` subscription status

```typescript
const { subscription } = useUserStore();
const isPro = subscription.status === 'active';

// Gate Pro features
if (!isPro && quality > '720p') {
  showUpgradeModal();
  return;
}
```

**Pro Features:**
- Export up to 4K resolution (Free: 720p max)
- No watermark on exports
- Priority support (future)

---

## Technical Architecture

### File Structure

```
src/
├── auth/
│   └── AuthManager.ts          # OAuth + session management
├── stores/
│   └── useUserStore.ts         # User state + subscription
├── stripe/
│   └── StripeService.ts        # Checkout session creation
└── components/ui/
    ├── AuthModal.tsx           # Sign in/up modal
    ├── UpgradeModal.tsx        # Pro upgrade flow
    └── UserMenu.tsx            # User avatar + menu

supabase/
└── functions/
    ├── create-checkout-session/
    │   └── index.ts            # Stripe checkout Edge Function
    └── stripe-webhooks/
        └── index.ts            # Webhook handler
```

### Security Considerations

1. **CSP Compliance:**
   - No client-side Stripe.js (blocked by extension CSP)
   - All Stripe operations in Edge Functions

2. **Environment Variables:**
   ```
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   STRIPE_SECRET_KEY=sk_test_...           # Edge Function only
   STRIPE_WEBHOOK_SECRET=whsec_...         # Webhook verification
   STRIPE_PRICE_ID=price_...               # Pro plan price
   ```

3. **Webhook Verification:**
   - All webhooks verify Stripe signature
   - Prevents unauthorized subscription updates

---

## Configuration

### 1. Supabase Setup

**Authentication → URL Configuration:**
- **Site URL:** `http://localhost:3000` (dev) / `https://recordio.site` (prod)
- **Redirect URLs:**
  - `https://<extension-id>.chromiumapp.org/`

**Database:**
- Run `supabase/migrations/subscriptions.sql` to create table
- Enable RLS policies for secure access

**Edge Functions:**
```bash
supabase functions deploy create-checkout-session
supabase functions deploy stripe-webhooks
```

**Secrets:**
```bash
supabase secrets set STRIPE_SECRET_KEY=sk_...
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
supabase secrets set STRIPE_PRICE_ID=price_...
```

### 2. Stripe Setup

**Products:**
- Create "Recordio Pro" product
- Create monthly price (`price_...`)
- Copy price ID to env vars

**Webhooks:**
- **Endpoint URL:** `https://<project-ref>.supabase.co/functions/v1/stripe-webhooks`
- **Events to send:**
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
- Copy webhook signing secret to Supabase secrets

### 3. Google Cloud Console

**OAuth Consent Screen:**
- **App name:** Recordio
- **User support email:** Your email
- **Authorized domains:** `recordio.com`
- Upload logo for branding

**OAuth Client:**
- Copy Client ID and Secret to Supabase Auth settings

### 4. Chrome Extension Manifest

**Required Permission:**
```json
{
  "permissions": ["identity"]
}
```

---

## Testing

### Test Authentication
1. Clear localStorage
2. Click "Sign In"
3. Verify Google consent screen appears
4. Approve permissions
5. Check console for `[Auth] OAuth successful!`
6. Verify avatar appears in header

### Test Payments (Stripe Test Mode)
1. Sign in first
2. Click "Upgrade to Pro"
3. Use test card: `4242 4242 4242 4242`
4. Complete checkout
5. Verify modal shows success message
6. Check Supabase `subscriptions` table for `status: 'active'`

### Test Webhooks
```bash
stripe listen --forward-to \
  https://<project-ref>.supabase.co/functions/v1/stripe-webhooks

# Trigger test events
stripe trigger checkout.session.completed
```

---

## Troubleshooting

### OAuth Issues
- **"ERR_BLOCKED_BY_CLIENT":** Add chromiumapp.org URL to Supabase redirects
- **No consent screen:** Add `prompt: 'consent'` to queryParams (testing only)
- **Session not persisting:** Check localStorage for `supabase.auth.token`

### Payment Issues
- **CSP errors:** Ensure no client-side Stripe.js imports
- **Webhook not working:** Verify signature secret matches Stripe dashboard
- **Subscription not updating:** Check Edge Function logs in Supabase

### Session Expiration
- Access tokens auto-refresh every hour
- Refresh tokens last 60 days
- After 60 days, users must re-authenticate

---

## Future Enhancements

- [ ] Add email/password authentication option
- [ ] Implement "Manage Subscription" portal
- [ ] Add usage-based billing tiers
- [ ] Create marketing website for redirects
- [ ] Add team/workspace functionality
- [ ] Implement subscription pause/resume

---

## Related Documentation

- [Supabase Auth Docs](https://supabase.com/docs/guides/auth)
- [Chrome Identity API](https://developer.chrome.com/docs/extensions/reference/identity/)
- [Stripe Checkout Docs](https://stripe.com/docs/payments/checkout)
- [Stripe Webhooks Best Practices](https://stripe.com/docs/webhooks/best-practices)
