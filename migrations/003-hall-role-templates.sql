-- Scheduler 003 — roles configured per hall.
-- Applied to the Operational DB (lkcfbgnuodqzvowschjn) on 2026-08-10.
--
-- Santa Clara and Redwood City run different schedules, so "which roles does a
-- session need, and how many of each" is a per-hall question. sched_roles stays
-- the shared catalogue of job names so that "Paymaster" means the same thing in
-- both halls and a person's capability travels with them; this table says how
-- each hall actually uses them.
--
-- part is included because weekend AM and PM are genuinely different sessions:
-- SC's Sat PM runs a smaller Flash Runner crew than Sat AM.
--
-- Reversible: drop table public.sched_hall_roles;

create table if not exists public.sched_hall_roles (
  hall_id      text not null references public.halls(id) on delete cascade,
  role_id      uuid not null references public.sched_roles(id) on delete cascade,
  day_type     text not null check (day_type in ('weekday','weekend')),
  part         text not null default 'single' check (part in ('single','AM','PM')),
  needed       integer not null default 1 check (needed >= 0),
  min_on_floor integer,          -- null = fall back to sched_roles.min_on_floor
  sort         integer not null default 0,
  active       boolean not null default true,
  updated_at   timestamptz not null default now(),
  primary key (hall_id, role_id, day_type, part)
);

create index if not exists idx_hall_roles_hall on public.sched_hall_roles(hall_id) where active;
alter table public.sched_hall_roles enable row level security;
create policy sched_hall_roles_auth_all on public.sched_hall_roles
  for all to authenticated using (true) with check (true);

-- Seed Santa Clara from what Rachel actually rostered: modal headcount per role
-- per day-type/part across the imported 7/31-8/10 schedule. Real data, not guesses.
insert into public.sched_hall_roles (hall_id, role_id, day_type, part, needed, sort)
select 'sc', a.role_id, s.day_type, s.part,
       mode() within group (order by cnt), max(r.sort)
from (select session_id, role_id, count(*) as cnt
      from public.sched_assignments group by 1,2) a
join public.sched_sessions s on s.id = a.session_id
join public.sched_roles r on r.id = a.role_id
where s.hall_id = 'sc'
group by a.role_id, s.day_type, s.part
on conflict (hall_id, role_id, day_type, part) do update
  set needed = excluded.needed, updated_at = now();

-- RWC: seeded from SC as a first draft to edit. Its schedule differs and nobody
-- has looked at it yet — this is a starting point, not a claim.
insert into public.sched_hall_roles (hall_id, role_id, day_type, part, needed, sort, active)
select 'rwc', role_id, day_type, part, needed, sort, true
from public.sched_hall_roles where hall_id = 'sc'
on conflict (hall_id, role_id, day_type, part) do nothing;
