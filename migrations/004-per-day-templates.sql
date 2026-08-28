-- Scheduler 004 — templates by day of week, not by weekday/weekend.
-- Applied to the Operational DB (lkcfbgnuodqzvowschjn) on 2026-08-10.
--
-- 003 modelled two day types because the Santa Clara sample only contained
-- Fri/Sat/Sun/Mon and they fell neatly into that shape. That was an artefact of
-- one hall's two-week sample, not the rule: Tuesday needs a different crew from
-- Sunday morning, and the two halls do not even operate the same days.
--
-- Key is now (hall, role, day-of-week, part). dow follows Postgres and
-- JavaScript: 0 = Sunday ... 6 = Saturday. Times move to the same key, because
-- there is no reason Redwood City opens when Santa Clara does.
--
-- Reversible:
--   drop table public.sched_hall_days;
--   drop table public.sched_hall_role_needs;
--   drop table public.sched_hall_role_times;

create table if not exists public.sched_hall_days (
  hall_id text not null references public.halls(id) on delete cascade,
  dow     integer not null check (dow between 0 and 6),
  part    text not null default 'single' check (part in ('single','AM','PM')),
  active  boolean not null default true,
  primary key (hall_id, dow, part)
);

create table if not exists public.sched_hall_role_needs (
  hall_id      text not null references public.halls(id) on delete cascade,
  role_id      uuid not null references public.sched_roles(id) on delete cascade,
  dow          integer not null check (dow between 0 and 6),
  part         text not null default 'single' check (part in ('single','AM','PM')),
  needed       integer not null default 0 check (needed >= 0),
  min_on_floor integer,
  updated_at   timestamptz not null default now(),
  primary key (hall_id, role_id, dow, part)
);

create table if not exists public.sched_hall_role_times (
  hall_id    text not null references public.halls(id) on delete cascade,
  role_id    uuid not null references public.sched_roles(id) on delete cascade,
  dow        integer not null check (dow between 0 and 6),
  part       text not null default 'single' check (part in ('single','AM','PM')),
  start_time time not null,
  end_time   time,
  primary key (hall_id, role_id, dow, part)
);

create index if not exists idx_hall_days_hall  on public.sched_hall_days(hall_id) where active;
create index if not exists idx_hall_needs_hall on public.sched_hall_role_needs(hall_id);

alter table public.sched_hall_days       enable row level security;
alter table public.sched_hall_role_needs enable row level security;
alter table public.sched_hall_role_times enable row level security;

create policy sched_hall_days_auth_all       on public.sched_hall_days
  for all to authenticated using (true) with check (true);
create policy sched_hall_role_needs_auth_all on public.sched_hall_role_needs
  for all to authenticated using (true) with check (true);
create policy sched_hall_role_times_auth_all on public.sched_hall_role_times
  for all to authenticated using (true) with check (true);

-- SC's operating days, taken from the sessions actually imported, not assumed.
insert into public.sched_hall_days (hall_id, dow, part, active)
select distinct 'sc', extract(dow from session_date)::int, part, true
from public.sched_sessions where hall_id = 'sc'
on conflict do nothing;

-- Expand 003's weekday/weekend template onto the specific days SC runs.
insert into public.sched_hall_role_needs (hall_id, role_id, dow, part, needed)
select d.hall_id, hr.role_id, d.dow, d.part, hr.needed
from public.sched_hall_days d
join public.sched_hall_roles hr
  on hr.hall_id = d.hall_id and hr.part = d.part
 and hr.day_type = case when d.dow in (0,6) then 'weekend' else 'weekday' end
where d.hall_id = 'sc'
on conflict (hall_id, role_id, dow, part) do update set needed = excluded.needed;

insert into public.sched_hall_role_times (hall_id, role_id, dow, part, start_time)
select d.hall_id, rt.role_id, d.dow, d.part, rt.start_time
from public.sched_hall_days d
join public.sched_role_times rt
  on rt.part = d.part
 and rt.day_type = case when d.dow in (0,6) then 'weekend' else 'weekday' end
where d.hall_id = 'sc'
on conflict (hall_id, role_id, dow, part) do nothing;

-- Redwood City: deliberately NOT seeded. Its schedule differs and nobody has
-- looked at it. An empty template is honest; a copy of SC's would be a lie that
-- looks like data.

-- ---------------------------------------------------------------------
-- 004b — the real operating pattern, from the user.
--
--   Santa Clara:  Monday, Friday, and Saturday + Sunday (two sessions each)
--   Redwood City: Tuesday, Wednesday, Thursday (one session each)
--
-- Tue/Wed/Thu times match Santa Clara's Monday.
-- Crew sizes for RWC are NOT set here — days and times were specified,
-- headcounts were not, and an invented crew size is indistinguishable from
-- a real one once it is in the table.
-- ---------------------------------------------------------------------
insert into public.sched_hall_days (hall_id, dow, part, active)
values ('rwc',2,'single',true), ('rwc',3,'single',true), ('rwc',4,'single',true)
on conflict (hall_id, dow, part) do update set active = true;

insert into public.sched_hall_role_times (hall_id, role_id, dow, part, start_time)
select 'rwc', t.role_id, d.dow, 'single', t.start_time
from public.sched_hall_role_times t
cross join (values (2),(3),(4)) as d(dow)
where t.hall_id = 'sc' and t.dow = 1 and t.part = 'single'
on conflict (hall_id, role_id, dow, part) do update set start_time = excluded.start_time;
