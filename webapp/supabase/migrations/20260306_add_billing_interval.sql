-- Add billing_interval column to track monthly/yearly/lifetime
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS billing_interval text;
