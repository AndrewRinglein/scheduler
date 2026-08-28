-- Scheduler 001 — roles and staff.
-- Applied to the Operational DB (lkcfbgnuodqzvowschjn) on 2026-08-05.
--
-- Single tenant (Frontier Gaming Systems, two halls), so no customer_id.
-- Matches this database's existing convention: RLS on, authenticated users
-- have full access, same as halls_auth_all.
--
-- NOTE: the roles seeded here were WRONG — they came from the prototypes,
-- not from Rachel's real schedule. Migration 002 corrects them. The table
-- definitions below are still current.
--
-- Reversible:
--   drop table if exists public.sched_staff_role_capability;
--   drop table if exists public.sched_staff;
--   drop table if exists public.sched_roles;

create table if not exists public.sched_roles (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  color         text,
  fixed_count   integer check (fixed_count is null or fixed_count >= 0),
  min_on_floor  integer not null default 0 check (min_on_floor >= 0),
  default_start time,          -- dropped in 002
  default_end   time,          -- dropped in 002
  sort          integer not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.sched_staff (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  phone      text,
  email      text unique,
  home_hall  text references public.halls(id) on delete set null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ADVISORY capability. Never filters a dropdown, never blocks a save.
--   can_do    -> no caution, one of their normal jobs
--   is_deputy -> no caution, approved cover
--   neither   -> "not trained for this role" caution, save still succeeds
create table if not exists public.sched_staff_role_capability (
  staff_id   uuid not null references public.sched_staff(id) on delete cascade,
  role_id    uuid not null references public.sched_roles(id) on delete cascade,
  can_do     boolean not null default false,
  is_deputy  boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (staff_id, role_id)
);

create index if not exists idx_sched_roles_active on public.sched_roles(sort) where active;
create index if not exists idx_sched_staff_active on public.sched_staff(name) where active;

alter table public.sched_roles                 enable row level security;
alter table public.sched_staff                 enable row level security;
alter table public.sched_staff_role_capability enable row level security;

create policy sched_roles_auth_all      on public.sched_roles
  for all to authenticated using (true) with check (true);
create policy sched_staff_auth_all      on public.sched_staff
  for all to authenticated using (true) with check (true);
create policy sched_capability_auth_all on public.sched_staff_role_capability
  for all to authenticated using (true) with check (true);
