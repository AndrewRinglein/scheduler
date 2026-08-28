-- Scheduler 005 — scheduled hours, clocked hours, and the workweek boundary.
-- Applied to the Operational DB (lkcfbgnuodqzvowschjn) on 2026-08-10.
--
-- Two separate numbers per person per shift, never to be conflated:
--   scheduled hours — what Rachel committed them to when she built the schedule
--   clocked hours   — what they actually worked
-- Overtime is OWED on what was worked; it is FORECAST on what was scheduled, so
-- she sees it before booking rather than after payroll.
--
-- Reversible:
--   drop table public.sched_time_entries;
--   alter table public.sched_assignments
--     drop column scheduled_start, drop column scheduled_end;
--   delete from public.settings where key = 'scheduler';

alter table public.sched_assignments
  add column if not exists scheduled_start time,
  add column if not exists scheduled_end   time;

create table if not exists public.sched_time_entries (
  id           uuid primary key default gen_random_uuid(),
  staff_id     uuid not null references public.sched_staff(id) on delete cascade,
  hall_id      text not null references public.halls(id) on delete cascade,
  work_date    date not null,
  clock_in     timestamptz,
  clock_out    timestamptz,
  hours_worked numeric(6,2),
  meal_taken         boolean not null default false,
  meal_start         timestamptz,
  meal_waived        boolean not null default false,
  second_meal_taken  boolean not null default false,
  second_meal_waived boolean not null default false,
  rest_breaks_taken  integer not null default 0 check (rest_breaks_taken >= 0),
  -- capped at one premium per category per workday, so booleans not counts
  meal_premium_owed boolean not null default false,
  rest_premium_owed boolean not null default false,
  is_worked_time boolean not null default true,
  category     text not null default 'worked'
               check (category in ('worked','vacation','holiday','sick','pto')),
  assignment_id uuid references public.sched_assignments(id) on delete set null,
  approved_by  uuid references auth.users(id) on delete set null,
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_time_staff_date on public.sched_time_entries(staff_id, work_date);
create index if not exists idx_time_hall_date  on public.sched_time_entries(hall_id, work_date);
create unique index if not exists idx_time_one_per_shift
  on public.sched_time_entries(staff_id, work_date, hall_id) where assignment_id is null;

alter table public.sched_time_entries enable row level security;
create policy sched_time_entries_auth_all on public.sched_time_entries
  for all to authenticated using (true) with check (true);

-- The workweek boundary. Legally a FIXED employer-designated period of seven
-- consecutive 24-hour periods, and NOT the pay period. Every overtime figure
-- depends on it. Recorded as an explicit unconfirmed placeholder rather than a
-- buried assumption.
insert into public.settings (key, value)
values ('scheduler', jsonb_build_object(
  'workweek_start_dow', 0,
  'workweek_start_confirmed', false,
  'note', 'Workweek start is a PLACEHOLDER (Sunday). Confirm with the employer before any overtime figure is used for pay.'
))
on conflict (key) do nothing;
