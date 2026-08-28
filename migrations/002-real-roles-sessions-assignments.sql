-- Scheduler 002 — corrected to match Rachel's actual schedule.
-- Applied to the Operational DB (lkcfbgnuodqzvowschjn) on 2026-08-10.
--
-- Four corrections the 7/31-8/10 Santa Clara sheet forced:
--   1. Real roles: MOD, Opener/Swing Shift, Paymaster, Flash Manager,
--      Callers/Strip, Flash Runners. "Session Staff" and "Bingo Manager"
--      never existed; MOD is what 001 wrongly called Bingo Manager.
--   2. Start times are per role x day-type x session part, not per role.
--      Paymaster is 2pm Fri/Mon, 9:30am Sat/Sun AM, 3:30pm Sat/Sun PM.
--   3. Weekend days run two sessions (AM and PM); Fri/Mon run one.
--      The halls operate Fri, Sat, Sun, Mon only.
--   4. Callers rotate through positions across three sections of a session.
--
-- Reversible: drop the tables created here, then re-run 001.

delete from public.sched_roles where name in ('Bingo Manager','Session Staff','Flash Runner');
alter table public.sched_roles drop column if exists default_start;
alter table public.sched_roles drop column if exists default_end;

insert into public.sched_roles (name, fixed_count, min_on_floor, sort, color) values
  ('MOD',                 1, 1, 1, '#6b4d8f'),
  ('Opener/Swing Shift',  1, 0, 2, '#8e6d3d'),
  ('Paymaster',           1, 1, 3, '#c4553e'),
  ('Flash Manager',       1, 1, 4, '#d1892f'),
  ('Callers/Strip',       4, 3, 5, '#3d6f8e'),
  ('Flash Runners',    null, 4, 6, '#2f7d63')
on conflict (name) do update set
  fixed_count=excluded.fixed_count, min_on_floor=excluded.min_on_floor,
  sort=excluded.sort, color=excluded.color, updated_at=now();

create table if not exists public.sched_role_times (
  role_id    uuid not null references public.sched_roles(id) on delete cascade,
  day_type   text not null check (day_type in ('weekday','weekend')),
  part       text not null default 'single' check (part in ('single','AM','PM')),
  start_time time not null,
  end_time   time,
  primary key (role_id, day_type, part)
);

create table if not exists public.sched_sessions (
  id           uuid primary key default gen_random_uuid(),
  hall_id      text not null references public.halls(id) on delete cascade,
  session_date date not null,
  part         text not null default 'single' check (part in ('single','AM','PM')),
  day_type     text not null check (day_type in ('weekday','weekend')),
  status       text not null default 'draft' check (status in ('draft','planned','deployed')),
  published_at timestamptz,
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (hall_id, session_date, part)
);

create table if not exists public.sched_session_roles (
  session_id uuid not null references public.sched_sessions(id) on delete cascade,
  role_id    uuid not null references public.sched_roles(id)    on delete cascade,
  needed     integer not null default 1 check (needed >= 0),
  primary key (session_id, role_id)
);

create table if not exists public.sched_assignments (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.sched_sessions(id) on delete cascade,
  role_id      uuid not null references public.sched_roles(id)    on delete cascade,
  staff_id     uuid references public.sched_staff(id) on delete set null,
  slot_index   integer not null default 0,
  early_start  boolean not null default false,   -- the '*' = early for buy-ins
  is_training  boolean not null default false,
  note         text,
  response     text not null default 'pending'
               check (response in ('pending','accepted','declined')),
  responded_at timestamptz,
  handed_from  uuid references public.sched_staff(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (session_id, role_id, slot_index)
);

create index if not exists idx_assign_session on public.sched_assignments(session_id);
create index if not exists idx_assign_staff   on public.sched_assignments(staff_id);
-- the case that must alert the manager: declined and nobody picked it up
create index if not exists idx_assign_open    on public.sched_assignments(session_id)
  where response = 'declined' and staff_id is null;

create table if not exists public.sched_caller_positions (
  session_id uuid not null references public.sched_sessions(id) on delete cascade,
  staff_id   uuid not null references public.sched_staff(id)    on delete cascade,
  section    integer not null check (section between 1 and 4),
  position   text not null,
  primary key (session_id, staff_id, section)
);

alter table public.sched_role_times       enable row level security;
alter table public.sched_sessions         enable row level security;
alter table public.sched_session_roles    enable row level security;
alter table public.sched_assignments      enable row level security;
alter table public.sched_caller_positions enable row level security;

create policy sched_role_times_auth_all       on public.sched_role_times
  for all to authenticated using (true) with check (true);
create policy sched_sessions_auth_all         on public.sched_sessions
  for all to authenticated using (true) with check (true);
create policy sched_session_roles_auth_all    on public.sched_session_roles
  for all to authenticated using (true) with check (true);
create policy sched_assignments_auth_all      on public.sched_assignments
  for all to authenticated using (true) with check (true);
create policy sched_caller_positions_auth_all on public.sched_caller_positions
  for all to authenticated using (true) with check (true);

-- Real start times, from column B of the spreadsheet.
insert into public.sched_role_times (role_id, day_type, part, start_time)
select r.id, t.day_type, t.part, t.start_time::time
from public.sched_roles r
join (values
  ('Paymaster',     'weekday','single','14:00'),
  ('Paymaster',     'weekend','AM',    '09:30'),
  ('Paymaster',     'weekend','PM',    '15:30'),
  ('Callers/Strip', 'weekday','single','15:15'),
  ('Callers/Strip', 'weekend','AM',    '10:45'),
  ('Callers/Strip', 'weekend','PM',    '16:30'),
  ('Flash Runners', 'weekday','single','15:15'),
  ('Flash Runners', 'weekend','AM',    '10:45'),
  ('Flash Runners', 'weekend','PM',    '17:00')
) as t(role, day_type, part, start_time) on t.role = r.name
on conflict (role_id, day_type, part) do update set start_time = excluded.start_time;
