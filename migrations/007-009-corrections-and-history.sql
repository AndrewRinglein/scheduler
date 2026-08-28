-- Scheduler 007–009, applied 2026-08-10 to the Operational DB.
--
-- 007  Staff are not tied to a hall, and hourly rates are not held here.
--      home_hall implied a default that does not exist; rates live in payroll.
--      Consequence, stated because it changes what this app can show: without
--      a rate we cannot show overtime or commission in dollars. What we CAN
--      hand payroll is hours by category and commission by workweek, which is
--      what they actually need. Adds pet / pet_kind for the assigned character.
--
-- 008  Availability: standing binary yes/no per person per session of the week.
--      Absence of a row means AVAILABLE — with 53 people imported from a
--      spreadsheet, the alternative empties every dropdown on day one.
--
-- 009  'single' sessions are PM sessions. The template invented 'single' for
--      one-session days; the commission history calls every one of them PM,
--      and so does the business. Two names for one session meant two target
--      rows, one of them zero.

alter table public.sched_staff drop column if exists base_rate;
alter table public.sched_staff drop column if exists home_hall;
alter table public.sched_staff
  add column if not exists pet text,
  add column if not exists pet_kind text check (pet_kind in ('cat','dog','boss'));

create table if not exists public.sched_staff_availability (
  staff_id   uuid not null references public.sched_staff(id) on delete cascade,
  dow        integer not null check (dow between 0 and 6),
  part       text not null default 'PM' check (part in ('PM','AM')),
  available  boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (staff_id, dow, part)
);
create index if not exists idx_avail_staff on public.sched_staff_availability(staff_id);
alter table public.sched_staff_availability enable row level security;
create policy sched_staff_availability_auth_all on public.sched_staff_availability
  for all to authenticated using (true) with check (true);

update public.sched_hall_days       set part='PM' where part='single';
update public.sched_hall_role_needs set part='PM' where part='single';
update public.sched_hall_role_times set part='PM' where part='single';
update public.sched_sessions        set part='PM' where part='single';
update public.sched_role_times      set part='PM' where part='single';
delete from public.sched_rpa_defaults where part='single';

-- Go-forward RPA targets = the most recent target actually used for that
-- hall/day/part. Not an average and not derived — the last real number.
with latest as (
  select distinct on (hall_id, extract(dow from session_date)::int, part)
         hall_id, extract(dow from session_date)::int as dow, part, target_rpa
  from public.sched_sessions where target_rpa is not null
  order by hall_id, extract(dow from session_date)::int, part, session_date desc
)
insert into public.sched_rpa_defaults (hall_id, dow, part, target_rpa, updated_at)
select hall_id, dow, part, target_rpa, now() from latest
on conflict (hall_id, dow, part) do update set target_rpa = excluded.target_rpa, updated_at = now();

-- ---------------------------------------------------------------------
-- 010  Sales is the input; RPA is derived.
--
-- RPA = total sales / attendance. Storing actual_rpa as a typed figure meant
-- two sources of truth for one fact with no way to check either. Sales and
-- attendance are what someone actually counts at the end of a session.
--
-- actual_rpa becomes a generated column, so every existing query and the whole
-- commission calculation keep working untouched. Historical sales are
-- back-filled as rpa * attendance — exact, being the same division reversed —
-- and the migration refuses to drop the original column until it has proved
-- the derived one reproduces it on every row.
-- ---------------------------------------------------------------------
alter table public.sched_sessions add column if not exists total_sales numeric(12,2);
update public.sched_sessions set total_sales = round(actual_rpa * attendance, 2)
 where total_sales is null and actual_rpa is not null and attendance is not null;
alter table public.sched_sessions rename column actual_rpa to actual_rpa_legacy;
alter table public.sched_sessions add column actual_rpa numeric(10,2)
  generated always as (case when attendance > 0 and total_sales is not null
                            then round(total_sales / attendance, 2) end) stored;
do $$ declare bad int; begin
  select count(*) into bad from public.sched_sessions
   where actual_rpa_legacy is not null
     and (actual_rpa is null or abs(actual_rpa - actual_rpa_legacy) > 0.01);
  if bad > 0 then raise exception 'derived actual_rpa differs on % row(s)', bad; end if;
end $$;
alter table public.sched_sessions drop column actual_rpa_legacy;

alter table public.sched_staff
  add column if not exists deactivated_at timestamptz,
  add column if not exists note text;

-- ---------------------------------------------------------------------
-- RWC crew template: 1 MOD, 1 Opener, 1 Paymaster, 1 Flash Manager,
-- 4 Callers, 5 Flash Runners = 13 per session, on all three operating nights.
-- ---------------------------------------------------------------------
insert into public.sched_hall_role_needs (hall_id, role_id, dow, part, needed, updated_at)
select 'rwc', r.id, d.dow, d.part, v.needed, now()
from public.sched_hall_days d
join (values ('MOD',1), ('Opener/Swing Shift',1), ('Paymaster',1),
             ('Flash Manager',1), ('Callers/Strip',4), ('Flash Runners',5)
     ) as v(role, needed) on true
join public.sched_roles r on r.name = v.role
where d.hall_id = 'rwc' and d.active
on conflict (hall_id, role_id, dow, part)
  do update set needed = excluded.needed, updated_at = now();
