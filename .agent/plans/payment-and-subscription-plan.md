# Payment and Subscription Integration Plan

## 📋 Executive Summary

This plan outlines the implementation of authentication and subscription-based monetization for Recordio, a Chrome extension video editor. The system will:
- Use **Supabase** for authentication and user management
- Implement tiered export quality restrictions (Free vs. Paid)
- Add watermarks to free-tier exports (360p, 720p)
- Block 1080p and 4K exports for non-subscribers

---

## 🎯 Business Model Overview

### Free Tier
- ✅ Export at 360p (with watermark)
- ✅ Export at 720p (with watermark)
- ❌ No 1080p export
- ❌ No 4K export

### Paid Tier (Subscription)
- ✅ Export at 360p (no watermark)
- ✅ Export at 720p (no watermark)
- ✅ Export at 1080p (no watermark)
- ✅ Export at 4K (no watermark)

---

## 🏗️ Architecture Overview

### Stack Components
1. **Authentication**: Supabase Auth
2. **User Database**: Supabase PostgreSQL
3. **Payment Processing**: Stripe or Paddle (comparison below)
4. **Subscription Storage**: Supabase Tables
5. **Client-Side State**: Zustand store for user/subscription state

### Data Flow
```
User Login → Supabase Auth → Chrome Extension
                ↓
        Verify Subscription Status
                ↓
        Update Zustand Store
                ↓
        Export Manager checks tier
                ↓
        Apply restrictions/watermarks
```

---

## 💳 Payment Provider Comparison: Stripe vs Paddle

### Stripe
**Pros:**
- ✅ Most popular, extensive documentation
- ✅ Full control over pricing, features, and UI
- ✅ Better for SaaS businesses, great API
- ✅ Lower fees: 2.9% + $0.30 per transaction
- ✅ More flexible customization
- ✅ Better for US-based customers
- ✅ Excellent webhook support
- ✅ Can handle complex subscription models

**Cons:**
- ❌ You handle tax compliance (unless using Stripe Tax add-on)
- ❌ More complex setup for global sales
- ❌ Need to handle EU VAT, sales tax manually or via Stripe Tax
- ❌ More integration work required

**Best For:** 
- US-focused or willing to handle global compliance
- Need full control and customization
- Want lowest fees
- Plan to scale significantly

---

### Paddle
**Pros:**
- ✅ Merchant of Record (MOR) - handles ALL tax/VAT compliance globally
- ✅ Simpler setup for global sales
- ✅ Built-in invoicing and receipts
- ✅ Better for B2B (handles VAT for EU business customers)
- ✅ Less legal overhead - they're the seller, not you
- ✅ Good for international Chrome extension sales

**Cons:**
- ❌ Higher fees: 5% + $0.50 per transaction
- ❌ Less flexible than Stripe
- ❌ Fewer third-party integrations
- ❌ Less control over checkout experience
- ❌ Webhook system not as robust as Stripe

**Best For:**
- Global audience from day 1
- Want to avoid tax/compliance headaches
- Don't mind higher fees for simplicity
- Smaller team, less dev resources

---

### 🏆 Recommendation: **Stripe**

**Why Stripe for Recordio:**
1. **Chrome Web Store Context**: Most Chrome extensions use Stripe
2. **Lower Fees**: With expected transaction volumes, 2.9% vs 5% matters
3. **Better Developer Experience**: Supabase + Stripe is a well-documented stack
4. **Flexibility**: Can start simple, scale to complex pricing models
5. **Stripe Tax**: Can add later if global compliance becomes needed (~0.5% extra fee)

**Migration Path:**
- Start with Stripe for US/simple markets
- Add Stripe Tax if going global
- Can always migrate to Paddle later if tax burden becomes too high

---

## 🔐 Authentication Flow with Supabase

### 1. Supabase Setup

#### Database Schema
```sql
-- Users table (managed by Supabase Auth automatically)
-- auth.users table contains: id, email, created_at, etc.

-- Custom profiles table
CREATE TABLE public.profiles (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Subscriptions table
CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  status TEXT NOT NULL, -- 'active', 'canceled', 'past_due', 'trialing'
  plan_id TEXT NOT NULL, -- 'pro_monthly', 'pro_yearly'
  current_period_start TIMESTAMP WITH TIME ZONE,
  current_period_end TIMESTAMP WITH TIME ZONE,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can view own subscription"
  ON public.subscriptions FOR SELECT
  USING (auth.uid() = user_id);
```

#### Supabase Edge Functions (for Stripe webhooks)
```typescript
// supabase/functions/stripe-webhook/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Stripe from 'stripe'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'))

serve(async (req) => {
  const signature = req.headers.get('stripe-signature')
  const body = await req.text()
  
  try {
    const event = stripe.webhooks.constructEvent(
      body,
      signature,
      Deno.env.get('STRIPE_WEBHOOK_SECRET')
    )
    
    // Handle subscription events
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        // Update subscriptions table
        break
      case 'customer.subscription.deleted':
        // Mark subscription as canceled
        break
    }
    
    return new Response(JSON.stringify({ received: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(err.message, { status: 400 })
  }
})
```

### 2. Chrome Extension Auth Flow

#### Extension Manifest Updates
```json
// manifest.json - add permissions
{
  "permissions": [
    "identity",
    "storage"
  ],
  "host_permissions": [
    "https://<your-supabase-project>.supabase.co/*"
  ]
}
```

#### Authentication Manager
```typescript
// src/auth/AuthManager.ts
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

export class AuthManager {
  // Initialize auth listener
  static initAuthListener(callback: (session: Session | null) => void) {
    supabase.auth.onAuthStateChange((event, session) => {
      callback(session)
    })
  }
  
  // Sign in with email/password
  static async signIn(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    })
    return { data, error }
  }
  
  // Sign up
  static async signUp(email: string, password: string) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password
    })
    return { data, error }
  }
  
  // Sign out
  static async signOut() {
    await supabase.auth.signOut()
  }
  
  // Get current session
  static async getSession() {
    const { data: { session } } = await supabase.auth.getSession()
    return session
  }
  
  // OAuth (Google, GitHub, etc.)
  static async signInWithProvider(provider: 'google' | 'github') {
    // For Chrome extensions, use chrome.identity API or open OAuth popup
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: chrome.identity.getRedirectURL()
      }
    })
    return { data, error }
  }
}
```

### 3. User State Management (Zustand)

```typescript
// src/stores/useUserStore.ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface Subscription {
  status: 'active' | 'canceled' | 'past_due' | 'trialing' | null
  planId: string | null
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
}

export interface UserState {
  // Auth state
  userId: string | null
  email: string | null
  isAuthenticated: boolean
  
  // Subscription state
  subscription: Subscription
  isPro: boolean // Computed from subscription.status
  
  // Actions
  setUser: (userId: string, email: string) => void
  setSubscription: (subscription: Subscription) => void
  clearUser: () => void
  
  // Helper method
  canExportQuality: (quality: ExportQuality) => boolean
}

export const useUserStore = create<UserState>()(
  persist(
    (set, get) => ({
      // Initial state
      userId: null,
      email: null,
      isAuthenticated: false,
      subscription: {
        status: null,
        planId: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false
      },
      isPro: false,
      
      // Actions
      setUser: (userId, email) => set({
        userId,
        email,
        isAuthenticated: true
      }),
      
      setSubscription: (subscription) => set({
        subscription,
        isPro: subscription.status === 'active' || subscription.status === 'trialing'
      }),
      
      clearUser: () => set({
        userId: null,
        email: null,
        isAuthenticated: false,
        subscription: {
          status: null,
          planId: null,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false
        },
        isPro: false
      }),
      
      // Helper to check if user can export at quality
      canExportQuality: (quality: ExportQuality) => {
        const { isPro } = get()
        
        // Free users can export 360p and 720p (with watermark)
        if (quality === '360p' || quality === '720p') {
          return true
        }
        
        // Only pro users can export 1080p and 4K
        return isPro
      }
    }),
    {
      name: 'recordio-user-storage',
      // Only persist certain fields
      partialize: (state) => ({
        userId: state.userId,
        email: state.email,
        subscription: state.subscription
      })
    }
  )
)
```

---

## 🎨 UI Components

### 1. Login/Signup Modal

```typescript
// src/components/auth/AuthModal.tsx
export const AuthModal = ({ isOpen, onClose }) => {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    
    const { data, error } = mode === 'signin'
      ? await AuthManager.signIn(email, password)
      : await AuthManager.signUp(email, password)
      
    if (error) {
      setError(error.message)
    } else {
      onClose()
    }
    
    setLoading(false)
  }
  
  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <h2>{mode === 'signin' ? 'Sign In' : 'Sign Up'}</h2>
        
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          required
        />
        
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          required
        />
        
        {error && <p className="text-red-500">{error}</p>}
        
        <Button type="submit" disabled={loading}>
          {loading ? 'Loading...' : mode === 'signin' ? 'Sign In' : 'Sign Up'}
        </Button>
        
        <button
          type="button"
          onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
        >
          {mode === 'signin' ? 'Need an account?' : 'Already have an account?'}
        </button>
      </form>
    </Modal>
  )
}
```

### 2. User Menu in Header

```typescript
// Update Header.tsx to add user menu
export const Header = () => {
  const { isAuthenticated, email, isPro } = useUserStore()
  const [showAuthModal, setShowAuthModal] = useState(false)
  
  return (
    <div className="header">
      {/* Existing content */}
      
      <div className="user-section">
        {isAuthenticated ? (
          <UserMenu email={email} isPro={isPro} />
        ) : (
          <Button onClick={() => setShowAuthModal(true)}>
            Sign In
          </Button>
        )}
      </div>
      
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
      />
    </div>
  )
}
```

### 3. Upgrade Prompt Modal

```typescript
// src/components/subscription/UpgradeModal.tsx
export const UpgradeModal = ({ isOpen, onClose, selectedQuality }) => {
  const handleUpgrade = () => {
    // Redirect to Stripe Checkout or open payment flow
    window.open('https://your-app.com/subscribe', '_blank')
  }
  
  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <h2>Upgrade to Pro</h2>
      <p>
        {selectedQuality} exports are only available for Pro subscribers.
      </p>
      
      <div className="pricing">
        <h3>Pro Plan - $9.99/month</h3>
        <ul>
          <li>Export in 1080p and 4K</li>
          <li>No watermarks</li>
          <li>Priority support</li>
        </ul>
      </div>
      
      <PrimaryButton onClick={handleUpgrade}>
        Upgrade Now
      </PrimaryButton>
    </Modal>
  )
}
```

---

## 🎬 Export Manager Integration

### 1. Update ExportManager.ts

```typescript
// src/editor/export/ExportManager.ts
import { useUserStore } from '../stores/useUserStore'

export class ExportManager {
  async exportProject(
    project: Project,
    sources: Record<string, SourceMetadata>,
    quality: ExportQuality,
    onProgress: (state: ExportProgress) => void
  ): Promise<void> {
    // Check if user can export at this quality
    const { canExportQuality, isPro } = useUserStore.getState()
    
    if (!canExportQuality(quality)) {
      throw new Error(`${quality} export requires a Pro subscription`)
    }
    
    // Rest of existing export logic...
    
    // Add watermark for free users
    const shouldAddWatermark = !isPro && (quality === '360p' || quality === '720p')
    
    if (shouldAddWatermark) {
      // Render watermark on each frame (implementation below)
      await this.renderWatermark(ctx, width, height)
    }
    
    // Continue with existing rendering...
  }
  
  private async renderWatermark(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number
  ) {
    // Render "RECORDIO" watermark in bottom-right corner
    const watermarkText = 'RECORDIO'
    const fontSize = Math.max(width * 0.03, 16) // 3% of width, min 16px
    
    ctx.save()
    ctx.font = `bold ${fontSize}px Inter, sans-serif`
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)' // Semi-transparent white
    ctx.textAlign = 'right'
    ctx.textBaseline = 'bottom'
    
    const padding = 20
    ctx.fillText(watermarkText, width - padding, height - padding)
    
    ctx.restore()
  }
}
```

### 2. Update Header.tsx Export Dropdown

```typescript
// src/editor/components/Header.tsx
const handleExport = async (quality: ExportQuality) => {
  const { canExportQuality, isPro } = useUserStore.getState()
  
  // Check if user can export this quality
  if (!canExportQuality(quality)) {
    // Show upgrade modal
    setUpgradeModalOpen(true)
    setSelectedQuality(quality)
    return
  }
  
  // Show watermark warning for free users
  if (!isPro && (quality === '360p' || quality === '720p')) {
    const confirmed = window.confirm(
      'Free exports include a watermark. Upgrade to Pro to remove it.'
    )
    if (!confirmed) return
  }
  
  // Proceed with export...
  // (existing export logic)
}

// Update export dropdown to show lock icons
const EXPORT_QUALITY_OPTIONS: DropdownOption<ExportQuality>[] = [
  { value: '360p', label: '360p (Free)' },
  { value: '720p', label: '720p (Free)' },
  { value: '1080p', label: '1080p 🔒 Pro', disabled: !isPro },
  { value: '4K', label: '4K 🔒 Pro', disabled: !isPro },
]
```

---

## 💰 Stripe Integration

### 1. Stripe Setup

```bash
# Install Stripe
npm install @stripe/stripe-js stripe
```

### 2. Create Stripe Products & Prices

In Stripe Dashboard:
1. Create Product: "Recordio Pro"
2. Create Recurring Price: $9.99/month (plan_id: `pro_monthly`)
3. Create Recurring Price: $99/year (plan_id: `pro_yearly`)

### 3. Checkout Flow

```typescript
// src/payment/StripeCheckout.ts
import { loadStripe } from '@stripe/stripe-js'

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY)

export class StripeCheckout {
  static async createCheckoutSession(userId: string, priceId: string) {
    // Call your backend/Edge Function to create checkout session
    const response = await fetch('/api/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, priceId })
    })
    
    const { sessionId } = await response.json()
    
    // Redirect to Stripe Checkout
    const stripe = await stripePromise
    const { error } = await stripe.redirectToCheckout({ sessionId })
    
    if (error) {
      console.error('Stripe checkout error:', error)
    }
  }
}
```

### 4. Backend API (Supabase Edge Function)

```typescript
// supabase/functions/create-checkout-session/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Stripe from 'stripe'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'))

serve(async (req) => {
  const { userId, priceId } = await req.json()
  
  // Get or create Stripe customer
  const { data: profile } = await supabase
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', userId)
    .single()
  
  let customerId = profile?.stripe_customer_id
  
  if (!customerId) {
    const customer = await stripe.customers.create({
      metadata: { supabase_user_id: userId }
    })
    customerId = customer.id
    
    // Save to database
    await supabase
      .from('subscriptions')
      .insert({ user_id: userId, stripe_customer_id: customerId })
  }
  
  // Create checkout session
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    mode: 'subscription',
    success_url: `${req.headers.get('origin')}/success`,
    cancel_url: `${req.headers.get('origin')}/canceled`,
  })
  
  return new Response(JSON.stringify({ sessionId: session.id }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
```

---

## 🔄 Subscription Status Sync

### How to Know if User is Logged In & Has Paid Subscription

#### 1. On App Load (Extension Opens)

```typescript
// src/App.tsx or main entry point
useEffect(() => {
  // Initialize auth listener
  AuthManager.initAuthListener(async (session) => {
    if (session) {
      // User is logged in
      const { setUser, setSubscription } = useUserStore.getState()
      
      setUser(session.user.id, session.user.email)
      
      // Fetch subscription status from Supabase
      const { data } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', session.user.id)
        .single()
      
      if (data) {
        setSubscription({
          status: data.status,
          planId: data.plan_id,
          currentPeriodEnd: new Date(data.current_period_end),
          cancelAtPeriodEnd: data.cancel_at_period_end
        })
      }
    } else {
      // User is logged out
      useUserStore.getState().clearUser()
    }
  })
}, [])
```

#### 2. Real-time Subscription Updates (via Supabase Realtime)

```typescript
// Listen for subscription changes in real-time
useEffect(() => {
  const { userId } = useUserStore.getState()
  
  if (!userId) return
  
  const subscription = supabase
    .channel('subscriptions')
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'subscriptions',
        filter: `user_id=eq.${userId}`
      },
      (payload) => {
        // Update local state when subscription changes
        const { setSubscription } = useUserStore.getState()
        setSubscription({
          status: payload.new.status,
          planId: payload.new.plan_id,
          currentPeriodEnd: new Date(payload.new.current_period_end),
          cancelAtPeriodEnd: payload.new.cancel_at_period_end
        })
      }
    )
    .subscribe()
  
  return () => {
    subscription.unsubscribe()
  }
}, [])
```

#### 3. Checking Subscription Status Anywhere in App

```typescript
// Any component can check subscription status
const Header = () => {
  const { isAuthenticated, isPro, email } = useUserStore()
  
  return (
    <div>
      {isAuthenticated ? (
        <div>
          <p>Logged in as: {email}</p>
          {isPro ? (
            <span>✨ Pro Subscriber</span>
          ) : (
            <button onClick={handleUpgrade}>Upgrade to Pro</button>
          )}
        </div>
      ) : (
        <button onClick={handleSignIn}>Sign In</button>
      )}
    </div>
  )
}
```

---

## 📝 Implementation Checklist

### Phase 1: Foundation (Week 1-2)
- [ ] Set up Supabase project
  - [ ] Create database schema (profiles, subscriptions)
  - [ ] Enable Row Level Security policies
  - [ ] Configure auth providers (email, Google OAuth)
- [ ] Install dependencies
  - [ ] `@supabase/supabase-js`
  - [ ] `@stripe/stripe-js`
  - [ ] `stripe` (for Edge Functions)
- [ ] Create environment variables
  - [ ] `VITE_SUPABASE_URL`
  - [ ] `VITE_SUPABASE_ANON_KEY`
  - [ ] `VITE_STRIPE_PUBLISHABLE_KEY`

### Phase 2: Authentication (Week 2-3)
- [ ] Implement `AuthManager` class
- [ ] Create `useUserStore` Zustand store
- [ ] Build UI components
  - [ ] `AuthModal` (login/signup)
  - [ ] `UserMenu` in Header
  - [ ] Profile settings page
- [ ] Add Chrome extension permissions to manifest
- [ ] Test auth flow end-to-end

### Phase 3: Subscription & Payment (Week 3-4)
- [ ] Set up Stripe account
  - [ ] Create products and prices
  - [ ] Configure webhooks
- [ ] Implement Supabase Edge Functions
  - [ ] `create-checkout-session`
  - [ ] `stripe-webhook` handler
- [ ] Build subscription UI
  - [ ] Pricing page
  - [ ] `UpgradeModal`
  - [ ] Manage subscription page
- [ ] Test payment flow (use Stripe test mode)

### Phase 4: Export Restrictions (Week 4-5)
- [ ] Update `ExportManager.ts`
  - [ ] Add subscription check in `exportProject()`
  - [ ] Implement watermark rendering
  - [ ] Block 1080p/4K for free users
- [ ] Update `Header.tsx`
  - [ ] Show lock icons on premium qualities
  - [ ] Trigger `UpgradeModal` when attempting locked export
  - [ ] Add watermark warning for free exports
- [ ] Test all export scenarios

### Phase 5: Polish & Testing (Week 5-6)
- [ ] Add subscription status indicators throughout UI
- [ ] Implement real-time subscription sync
- [ ] Add error handling and edge cases
  - [ ] Expired subscriptions
  - [ ] Failed payments
  - [ ] Subscription cancellations
- [ ] Write documentation for users
- [ ] QA testing
  - [ ] Test with real Stripe test cards
  - [ ] Test all export qualities
  - [ ] Test auth flows (login, logout, signup)

### Phase 6: Launch Prep (Week 6-7)
- [ ] Switch Stripe from test mode to live mode
- [ ] Update Supabase to production environment
- [ ] Set up analytics to track conversions
- [ ] Prepare marketing materials
- [ ] Soft launch to beta testers
- [ ] Monitor for bugs and issues

---

## 🎨 Watermark Design Specification

### Visual Design
- **Text**: "RECORDIO" or "Made with Recordio"
- **Position**: Bottom-right corner
- **Font**: Inter Bold (already in project)
- **Size**: 3% of video width (min 16px, scales with resolution)
- **Color**: White with 50% opacity (`rgba(255, 255, 255, 0.5)`)
- **Padding**: 20px from edges
- **Alternative**: Could use logo image instead of text

### Advanced Watermark (Optional)
```typescript
// Load watermark logo instead of text
const watermarkImg = await loadImage('/path/to/watermark-logo.png')

private async renderWatermark(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  watermarkImg?: HTMLImageElement
) {
  if (watermarkImg) {
    // Image watermark
    const logoWidth = width * 0.15 // 15% of video width
    const logoHeight = (logoWidth / watermarkImg.width) * watermarkImg.height
    
    ctx.save()
    ctx.globalAlpha = 0.5
    ctx.drawImage(
      watermarkImg,
      width - logoWidth - 20,
      height - logoHeight - 20,
      logoWidth,
      logoHeight
    )
    ctx.restore()
  } else {
    // Text watermark (existing implementation)
    // ...
  }
}
```

---

## 🔒 Security Considerations

### Environment Variables
```env
# .env (DO NOT COMMIT)
VITE_SUPABASE_URL=https://yourproject.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...

# Supabase Edge Functions .env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

### Best Practices
1. **Never expose Stripe secret keys** in client-side code
2. **Use Row Level Security (RLS)** in Supabase to protect user data
3. **Validate subscription status** on both client and server (if using external API)
4. **Handle token expiration** gracefully
5. **Use HTTPS** for all API requests (Supabase does this by default)
6. **Store sensitive keys** in Chrome extension storage (if needed), encrypted

---

## 📊 Analytics & Monitoring

### Key Metrics to Track
1. **Conversion Rate**: Free users → Paid subscribers
2. **Churn Rate**: Monthly subscription cancellations
3. **Export Attempts**: How many users try to export at each quality
4. **Upgrade Modal Impressions**: How often upgrade modal is shown
5. **Most Popular Export Quality**: Track free vs. paid usage

### Tools to Use
- **Stripe Dashboard**: Revenue, subscriptions, failed payments
- **Supabase Analytics**: Database queries, auth events
- **Google Analytics / Mixpanel**: User behavior, conversion funnels
- **Sentry**: Already integrated, track subscription-related errors

---

## 🚀 Future Enhancements

### Phase 2 Features (Post-MVP)
1. **Free Trial**: 7-day trial of Pro features
2. **Annual Plan**: Discount for yearly subscriptions ($99/year = ~$8.25/month)
3. **Team Plans**: Multi-user subscriptions for businesses
4. **Usage-Based Pricing**: Pay per export (alternative to subscription)
5. **Lifetime Deal**: One-time payment option
6. **Referral Program**: Free month for successful referrals
7. **Student Discount**: Verify .edu emails for 50% off

### Advanced Features
1. **Custom Watermarks**: Pro users upload their own logo
2. **Branded Exports**: Add custom intros/outros
3. **Export Presets**: Save favorite export settings
4. **Cloud Storage**: Store projects in Supabase Storage
5. **Collaboration**: Share projects with team members

---

## 📞 Support & Resources

### Useful Links
- **Supabase Docs**: https://supabase.com/docs
- **Stripe Docs**: https://stripe.com/docs
- **Stripe + Supabase Guide**: https://supabase.com/docs/guides/integrations/stripe
- **Chrome Extension Identity API**: https://developer.chrome.com/docs/extensions/reference/identity/

### Example Implementations
- Search GitHub for: "Supabase Stripe Chrome Extension"
- Reference: https://github.com/supabase/supabase/tree/master/examples/stripe-subscriptions

---

## ✅ Summary

This plan provides a comprehensive roadmap for adding authentication and subscription-based monetization to Recordio using:

1. **Supabase** for auth and database
2. **Stripe** for payments (recommended over Paddle for your use case)
3. **Zustand** for local state management
4. **Export restrictions** enforced in `ExportManager.ts`
5. **Watermarks** for free-tier exports

The system will clearly indicate subscription status throughout the UI and gracefully guide free users to upgrade when they attempt premium features.

**Next Steps**: Get approval on this plan, then proceed with Phase 1 implementation! 🚀
