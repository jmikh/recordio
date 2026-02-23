-- Create user_metadata table (replaces empty profiles table)
-- Run this in Supabase Dashboard → SQL Editor

-- 1. Create table
create table public.user_metadata (
    id uuid primary key references auth.users(id) on delete cascade,
    free_credits_used integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- 2. Enable RLS
alter table public.user_metadata enable row level security;

-- 3. RLS: users can read their own row
create policy "Users can read own metadata"
    on public.user_metadata for select
    using (auth.uid() = id);

-- 4. Trigger function: auto-create row on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
    insert into public.user_metadata (id)
    values (new.id);
    return new;
end;
$$ language plpgsql security definer;

-- 5. Attach trigger to auth.users
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- 6. Backfill existing users
insert into public.user_metadata (id)
select id from auth.users
where id not in (select id from public.user_metadata);

-- =============================================================================
-- Migration: Per-project free credit system
-- Drop free_credits_used, add free_credits_remaining (default 1)
-- =============================================================================

alter table public.user_metadata drop column free_credits_used;
alter table public.user_metadata add column free_credits_remaining integer not null default 1;

-- Project unlocks table (per-project free credit tracking)
create table public.project_unlocks (
    user_id uuid not null references auth.users(id) on delete cascade,
    project_id text not null,
    created_at timestamptz not null default now(),
    primary key (user_id, project_id)
);

alter table public.project_unlocks enable row level security;

create policy "Users can read own unlocks"
    on public.project_unlocks for select
    using (auth.uid() = user_id);
