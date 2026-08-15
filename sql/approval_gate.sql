-- ============================================================
-- RadioVerse admin-approval gate
--
-- Email confirmation proves the address is real, but does NOT
-- activate the account. Activation happens only when an admin
-- sets the user's status to 'approved' in this table.
--
-- Safe to re-run (idempotent). Run in: Supabase Dashboard > SQL Editor
-- ============================================================

-- 1) Profiles table carrying approval status + per-user preferences
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  is_admin boolean not null default false,
  default_country text,
  created_at timestamptz not null default now()
);

-- 2) Add new columns if upgrading an existing install
alter table public.profiles add column if not exists is_admin boolean not null default false;
alter table public.profiles add column if not exists default_country text;

-- 3) Auto-create a profile row ('pending') whenever a new user signs up
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

-- 4) Enable RLS
alter table public.profiles enable row level security;

-- 5) Users can read their own profile (needed for status + default country)
drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- 6) Admins can read every profile (so the dashboard can render the user list)
drop policy if exists "Admins can read all profiles" on public.profiles;
create policy "Admins can read all profiles"
  on public.profiles for select
  using (lower(auth.jwt() ->> 'email') = lower('anurag171@gmail.com'));

-- 7) Backfill: existing accounts stay active (upsert, in case a row exists)
insert into public.profiles (id, email, status)
select id, email, 'approved' from auth.users
on conflict (id) do update set status = 'approved';

-- 8) Grant admin role to the owner account (case-insensitive)
update public.profiles
set is_admin = true, status = 'approved'
where lower(email) = lower('anurag171@gmail.com');
