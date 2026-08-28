-- Scheduler 006 — commission, and the pay data overtime needs.
-- Applied to the Operational DB (lkcfbgnuodqzvowschjn) on 2026-08-10.
--
-- Brings the commission tracker's model into the scheduler, because they are
-- not separate problems: commission is a NON-DISCRETIONARY bonus, so it enters
-- the regular rate, and the regular rate is what overtime premiums are paid on.
-- Keeping them in different apps guarantees overtime gets paid on base rate
-- alone, which underpays every time commission is earned in an overtime week.
--
-- Reversible: drop the tables created here and the added columns.

alter table public.sched_staff
  add column if not exists base_rate numeric(8,2),
  add column if not exists employee_ref text;

create table if not exists public.sched_rpa_defaults (
  hall_id    text not null references public.halls(id) on delete cascade,
  dow        integer not null check (dow between 0 and 6),
  part       text not null default 'single' check (part in ('single','AM','PM')),
  target_rpa numeric(10,2) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (hall_id, dow, part)
);

-- target_rpa is COPIED onto the session when results are entered, never read
-- live from the default — editing a default must not rewrite whether past
-- sessions qualified.
alter table public.sched_sessions
  add column if not exists target_rpa  numeric(10,2),
  add column if not exists actual_rpa  numeric(10,2),
  add column if not exists attendance  integer,
  add column if not exists comm_rate   numeric(5,4) not null default 0.15,
  add column if not exists commission_confirmed_at timestamptz,
  add column if not exists commission_confirmed_by uuid references auth.users(id);

create table if not exists public.sched_session_shares (
  session_id uuid not null references public.sched_sessions(id) on delete cascade,
  staff_id   uuid not null references public.sched_staff(id) on delete cascade,
  shares     numeric(3,1) not null default 1.0 check (shares >= 0 and shares <= 3),
  updated_at timestamptz not null default now(),
  primary key (session_id, staff_id)
);

-- Stores inputs as well as output so a payout can be explained months later
-- even if the session, rate or shares have since changed.
create table if not exists public.sched_commission_payouts (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references public.sched_sessions(id) on delete cascade,
  staff_id        uuid not null references public.sched_staff(id) on delete cascade,
  session_date    date not null,
  shares          numeric(3,1) not null,
  total_shares    numeric(6,1) not null,
  commission_pool numeric(10,2) not null,
  payout_amount   numeric(10,2) not null,
  confirmed_at    timestamptz not null default now(),
  unique (session_id, staff_id)
);

create index if not exists idx_payout_staff_date on public.sched_commission_payouts(staff_id, session_date);
create index if not exists idx_shares_session    on public.sched_session_shares(session_id);

alter table public.sched_rpa_defaults       enable row level security;
alter table public.sched_session_shares     enable row level security;
alter table public.sched_commission_payouts enable row level security;

create policy sched_rpa_defaults_auth_all on public.sched_rpa_defaults
  for all to authenticated using (true) with check (true);
create policy sched_session_shares_auth_all on public.sched_session_shares
  for all to authenticated using (true) with check (true);
create policy sched_commission_payouts_auth_all on public.sched_commission_payouts
  for all to authenticated using (true) with check (true);

update public.settings
set value = value || jsonb_build_object(
  'show_commission_rate_adjustment', true,
  'pay_period', 'semimonthly_1_16',
  'pay_period_note', 'Pay periods are 1st-15th and 16th-EOM. Overtime is still calculated per WORKWEEK, not per pay period.',
  'minimum_wage', 16.50)
where key = 'scheduler';

-- RPA defaults for every session each hall actually runs, at 0 until set.
insert into public.sched_rpa_defaults (hall_id, dow, part, target_rpa)
select hall_id, dow, part, 0 from public.sched_hall_days where active
on conflict (hall_id, dow, part) do nothing;
