# Authentication Setup Guide

## ✅ Phase 1 Complete: Foundation + Authentication UI

You've successfully completed the first phase! Here's what we've built:

### 📦 What's Been Implemented

1. **Dependencies Installed**
   - `@supabase/supabase-js` - Supabase client for authentication
   - `@stripe/stripe-js` - Stripe SDK for future payment integration

2. **Core Infrastructure**
   - `src/stores/useUserStore.ts` - Zustand store for user state and subscription management
   - `src/auth/AuthManager.ts` - Authentication manager with Supabase integration
   
3. **UI Components**
   - `src/components/ui/AuthModal.tsx` - Login/Signup modal
   - `src/components/ui/UserMenu.tsx` - User dropdown menu showing email and Pro status
   
4. **Integration**
   - `src/editor/components/Header.tsx` - Added Sign In button and UserMenu
   - `src/editor/App.tsx` - Auth state listener to sync with Supabase

---

## 🚀 Next Steps: Setting Up Supabase

### Step 1: Create a Supabase Project

1. Go to https://app.supabase.com
2. Click "New Project"
3. Choose an organization and project name
4. Set a database password (save this securely)
5. Select a region closest to your users
6. Wait for project to provision (~2 minutes)

### Step 2: Get Your API Keys

1. In your Supabase project dashboard, click **Settings** (gear icon in sidebar)
2. Click **API** in the settings menu
3. Copy these two values:
   - **Project URL** (looks like: `https://xxxxx.supabase.co`)
   - **anon public** key (long string starting with `eyJ...`)

### Step 3: Create Environment Variables

1. Create a `.env` file in the project root (already listed in .gitignore):
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and paste your values:
   ```env
   VITE_SUPABASE_URL=https://your-project-id.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   VITE_STRIPE_PUBLISHABLE_KEY=pk_test_... # Leave empty for now
   ```

### Step 4: Create Database Tables

1. In Supabase dashboard, click **SQL Editor** in sidebar
2. Click **New Query**
3. Paste this SQL and click **Run**:

```sql
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Profiles table (extends auth.users)
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
  user_id UUID REFERENCES auth.users(id) NOT NULL UNIQUE,
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'inactive',
  plan_id TEXT,
  current_period_start TIMESTAMP WITH TIME ZONE,
  current_period_end TIMESTAMP WITH TIME ZONE,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for profiles
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- RLS Policies for subscriptions
CREATE POLICY "Users can view own subscription"
  ON public.subscriptions FOR SELECT
  USING (auth.uid() = user_id);

-- Function to create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to auto-create profile
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

### Step 5: Configure Auth Settings

1. In Supabase dashboard, go to **Authentication** → **Providers**
2. Ensure **Email** is enabled
3. Optional: Configure **Email Templates** under **Email** section
   - Customize signup confirmation emails
   - Customize password reset emails
4. Optional: Enable OAuth providers (Google, GitHub, etc.)
   - Each provider requires setting up OAuth apps in their respective platforms

### Step 6: Test the Authentication

1. Rebuild the extension:
   ```bash
   npm run build:dev
   ```

2. Reload the extension in Chrome:
   - Go to `chrome://extensions`
   - Click reload button on Recordio extension

3. Open the editor (create/open a project)

4. Click **Sign In** button in the header

5. Try creating an account:
   - Enter an email and password (min 6 characters)
   - Click "Create Account"
   - Check your email for confirmation (if email confirmations are enabled)

6. After signup, you should see:
   - Your email in the UserMenu dropdown
   - "Free Plan" status (since no subscription yet)

---

## 🎯 Current Status

### ✅ What Works
- Sign up with email/password
- Sign in with email/password
- Sign out
- User state persists across page reloads
- UserMenu shows email and subscription status

### ⏸️ Not Yet Implemented
- Password reset flow
- Email confirmation flow (Supabase handles this, but no UI for it yet)
- OAuth providers (Google, GitHub)
- Subscription payments (Stripe integration)
- Export restrictions based on subscription
- Watermarks on free exports

---

## 🐛 Troubleshooting

### "Sign In" button doesn't do anything
- Check browser console for errors
- Verify `.env` file exists and has correct values
- Make sure you ran `npm run build:dev` after creating `.env`

### "Invalid API key" error
- Double-check your `VITE_SUPABASE_ANON_KEY` in `.env`
- Make sure it's the **anon public** key, not the **service_role secret** key
- The key should start with `eyJ...`

### Email confirmation not working
- Go to Supabase dashboard → **Authentication** → **Email**
- Check "Confirm email" setting
- For development, you can disable email confirmation temporarily

### Database errors
- Make sure all SQL from Step 4 ran successfully
- Check **Database** → **Tables** in Supabase to verify tables exist
- Check browser console for specific error messages

---

## 📋 Next Phase: Subscription & Payment

Once authentication is working, we can proceed to:
- Phase 2: Stripe integration
- Phase 3: Create Supabase Edge Functions for webhooks
- Phase 4: Implement export restrictions
- Phase 5: Add watermarks to free exports

**Ready to continue?** Let me know if you encounter any issues or when you're ready for the next phase!
