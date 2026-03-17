-- ============================================================================
-- Email unsubscribes table
-- Tracks users who have opted out of marketing/transactional emails
-- ============================================================================

create table if not exists public.email_unsubscribes (
    user_id uuid primary key references auth.users(id) on delete cascade,
    created_at timestamptz not null default now()
);

alter table public.email_unsubscribes enable row level security;

-- Users can read and insert their own unsubscribe row
create policy "Users can manage own unsubscribe"
    on public.email_unsubscribes for all
    using (auth.uid() = user_id);
