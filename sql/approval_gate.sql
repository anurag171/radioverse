-- ============================================================
-- RadioVerse admin-approval gate
--
-- Email confirmation proves the address is real, but does NOT
-- activate the account. Activation happens only when an admin
-- sets the user's status to 'approved' in this table.
--
-- Run this once in: Supabase Dashboard > SQL Editor
-- ============================================================

-- 1) Profiles table carrying the approval status
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

-- 2) Auto-create a profile row ('pending') whenever a new user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, status)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name', 'pending')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3) Enable RLS and let a user read only their own status
alter table public.profiles enable row level security;

create policy "Users can read own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- 4) Backfill: existing accounts stay active
insert into public.profiles (id, email, status)
select id, email, 'approved' from auth.users
on conflict (id) do nothing;
