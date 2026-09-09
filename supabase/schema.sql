-- Supabase schema mirror. Local server (server.js) enforces the same rules in code.
-- RLS CHECK 1: enable RLS on every table. CHECK 2: deny-all default. CHECK 3: only explicit policies allow anon reads / service_role writes.

create table if not exists zips (
  id text primary key,
  title text not null,
  description text default '',
  file_name text,
  file_size bigint default 0,
  downloads bigint default 0,
  locked boolean default false,
  videos jsonb default '[]'::jsonb,
  created_at timestamptz default now()
);

create table if not exists visits (
  id bigserial primary key,
  ip text not null,
  path text default '/',
  country text default '?',
  city text default '?',
  isp text default '?',
  browser text default '?',
  os text default '?',
  device text default 'pc',
  origin text default 'direct',
  source_label text default 'Direct',
  ref text,
  user_agent text,
  hw jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists downloads (
  id bigserial primary key,
  ip text not null,
  zip_id text references zips(id) on delete cascade,
  ref text,
  created_at timestamptz default now()
);

create table if not exists referrals (
  code text primary key,
  owner_ip text,
  count bigint default 0
);

create table if not exists settings (
  id int primary key,
  bot_token text default '',
  chat_id text default '-5417526972'
);

-- CHECK 1: RLS on
alter table zips enable row level security;
alter table visits enable row level security;
alter table downloads enable row level security;
alter table referrals enable row level security;
alter table settings enable row level security;

-- CHECK 2: drop existing then deny by default (no permissive policy = deny)
drop policy if exists anon_read_zips on zips;
drop policy if exists admin_all_zips on zips;
drop policy if exists anon_insert_visits on visits;
drop policy if exists anon_read_visits on visits;
drop policy if exists admin_all_visits on visits;
drop policy if exists anon_insert_downloads on downloads;
drop policy if exists admin_all_downloads on downloads;
drop policy if exists anon_read_referrals on referrals;
drop policy if exists admin_all_referrals on referrals;
drop policy if exists admin_all_settings on settings;

-- CHECK 3: explicit minimal policies
-- anon can read zips (locked flag visible, file served only via signed server check)
create policy anon_read_zips on zips for select to anon using (true);
-- only service_role (admin, root/dark backend) can write zips
create policy admin_all_zips on zips for all to service_role using (true) with check (true);

-- anon can insert visits (server validates bot/mobile), cannot read or update
create policy anon_insert_visits on visits for insert to anon with check (true);
create policy admin_all_visits on visits for all to service_role using (true) with check (true);

-- anon can insert download events, cannot read others
create policy anon_insert_downloads on downloads for insert to anon with check (true);
create policy admin_all_downloads on downloads for all to service_role using (true) with check (true);

create policy anon_read_referrals on referrals for select to anon using (true);
create policy admin_all_referrals on referrals for all to service_role using (true) with check (true);

create policy admin_all_settings on settings for all to service_role using (true) with check (true);

-- Function security: lock search_path, security definer only for admin stats
create or replace function admin_stats()
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; begin
  if auth.role() <> 'service_role' then raise exception 'forbidden'; end if;
  select jsonb_build_object('visits',(select count(*) from visits),'downloads',(select count(*) from downloads)) into r;
  return r; end $$;
