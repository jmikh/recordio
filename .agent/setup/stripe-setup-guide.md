# Stripe Integration Setup Guide

## 🎯 Overview

This guide will walk you through setting up Stripe for subscription payments in Recordio. We'll create:
1. Stripe account & product
2. Supabase Edge Functions for checkout
3. Webhooks for subscription updates
4. Testing the full flow

**Time estimate:** ~30-45 minutes

---

## Part 1: Set Up Stripe Account

### Step 1: Create Stripe Account

1. Go to https://dashboard.stripe.com/register
2. Sign up with your email
3. Complete verification (you can use test mode immediately)

### Step 2: Get API Keys

1. In Stripe Dashboard, click **Developers** → **API keys**
2. You'll see two keys:
   - **Publishable key** (starts with `pk_test_...`)
   - **Secret key** (starts with `sk_test_...` - click "Reveal")

3. Copy the **Publishable key** and add to your `.env`:
   ```env
   VITE_STRIPE_PUBLISHABLE_KEY=pk_test_xxxxxxxxxxxxx
   ```

4. **IMPORTANT**: Keep the Secret key handy - you'll need it for Supabase Edge Functions

### Step 3: Create Subscription Product

1. In Stripe Dashboard, go to **Products** → **Add Product**
2. Fill in:
   - **Name**: `Recordio Pro`
   - **Description**: `Professional screen recording with 4K export and no watermarks`
3. Under **Pricing**:
   - Select **Recurring**
   - **Price**: `9.99`
   - **Billing period**: `Monthly`
   - Currency: `USD`
4. Click **Save product**
5. **Copy the Price ID** (starts with `price_...`) - you'll need this!

---

## Part 2: Create Supabase Edge Function

### Step 1: Install Supabase CLI

```bash
# If you don't have it already
brew install supabase/tap/supabase

# Login
supabase login
```

### Step 2: Link Your Project

```bash
# In your project directory
supabase link --project-ref YOUR_PROJECT_REF

# Find YOUR_PROJECT_REF in Supabase dashboard URL:
# https://app.supabase.com/project/YOUR_PROJECT_REF
```

### Step 3: Create Edge Function Files

The Edge Function code is ready in:
- `.agent/setup/edge-functions/create-checkout-session/index.ts`
- `.agent/setup/edge-functions/stripe-webhooks/index.ts`

---

## Part 3: Deploy Edge Functions

### Step 1: Set Secrets

```bash
# Set Stripe secret key
supabase secrets set STRIPE_SECRET_KEY=sk_test_your_secret_key_here

# Set Stripe webhook secret (we'll get this after creating webhook)
# For now, set a placeholder
supabase secrets set STRIPE_WEBHOOK_SECRET=placeholder
```

###Step 2: Deploy Functions

```bash
# Deploy checkout session function
supabase functions deploy create-checkout-session

# Deploy webhook handler
supabase functions deploy stripe-webhooks
```

---

## Part 4: Configure Stripe Webhooks

### Step 1: Get Webhook URL

After deploying, your webhook URL will be:
```
https://YOUR_PROJECT_REF.supabase.co/functions/v1/stripe-webhooks
```

### Step 2: Create Webhook in Stripe

1. Go to Stripe Dashboard → **Developers** → **Webhooks**
2. Click **Add endpoint**
3. **Endpoint URL**: Paste your Supabase function URL
4. **Events to send**: Select these events:
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `checkout.session.completed`
5. Click **Add endpoint**

### Step 3: Get Webhook Secret

1. Click on your newly created webhook
2. Click **Reveal** under "Signing secret"
3. Copy the secret (starts with `whsec_...`)
4. Update Supabase secret:
   ```bash
   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
   ```

---

## Part 5: Update Edge Function with Price ID

Edit `.agent/setup/edge-functions/create-checkout-session/index.ts`:

Find this line:
```typescript
const PRICE_ID = 'price_YOUR_PRICE_ID_HERE';
```

Replace with your actual Price ID from Step 3 of Part 1.

Then redeploy:
```bash
supabase functions deploy create-checkout-session
```

---

## Part 6: Test the Integration

### Step 1: Rebuild Extension

```bash
npm run build:dev
```

### Step 2: Reload Extension

Go to `chrome://extensions` and reload Recordio

### Step 3: Test Checkout Flow

1. Open editor
2. Try to export in 1080p/4K
3. Click **Subscribe Now** in the upgrade modal
4. Should redirect to Stripe Checkout page!
5. Use test card: `4242 4242 4242 4242`
   - Expiry: Any future date
   - CVC: Any 3 digits
   - ZIP: Any 5 digits
6. Complete payment
7. Should redirect back to extension
8. **Check Supabase** → `subscriptions` table
   - Should see your subscription with `status: 'active'`!

### Step 4: Verify Pro Access

1. Reload extension
2. You should see "Pro Plan" badge in UserMenu!
3. Export in 1080p/4K should work without upgrade prompt
4. Export in 720p/360p should NOT show watermark warning

---

## 🎯 Success Checklist

✅ Stripe account created  
✅ Product & price created in Stripe  
✅ Edge functions deployed  
✅ Webhook configured  
✅ Test payment successful  
✅ Subscription appears in database  
✅ Pro badge shows in extension  

---

## 🐛 Troubleshooting

### "Supabase not configured" error
- Check `.env` file has `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
- Rebuild after adding env vars

### "Failed to create checkout session"
- Check Edge Function logs: `supabase functions logs create-checkout-session`
- Verify `STRIPE_SECRET_KEY` is set correctly
- Check function is deployed

### Webhook not firing
- Verify webhook URL is correct
- Check webhook signing secret is set
- View webhook delivery attempts in Stripe Dashboard

### Subscription not showing in database
- Check `subscriptions` table exists
- Verify webhook ran successfully (check Stripe Dashboard → Webhooks → attempts)
- Check Edge Function logs: `supabase functions logs stripe-webhooks`

---

**Ready for the next step?** Once this is working, we'll add:
- Watermarks for free exports
- Customer portal for managing subscriptions
- Cancel/upgrade flows

Let me know when you're ready or if you hit any issues! 🚀
