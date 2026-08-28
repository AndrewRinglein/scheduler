-- 015 — every role can be staffed, and the four salaried-ish roles get times.
--
-- Two problems, one cause. MOD, Opener/Swing Shift and Flash Manager had no row
-- in sched_hall_role_times or sched_hall_role_needs at all, so the scheduler
-- rendered no row for them, the break board could not see them, and their hours
-- were never scheduled. Separately, sched_roles.fixed_count made the UI treat
-- MOD/Opener/Paymaster/Flash Manager as un-addable, so even a role that DID
-- render could not take a second person.
--
-- Rachel needs to add a second MOD, a fifth caller, whatever the night needs.
-- fixed_count stays on the table as the DEFAULT headcount — it is no longer a
-- ceiling. The UI stops treating it as one.
--
-- The times seeded here are PLACEHOLDERS. They copy the Paymaster's start and
-- end for the same hall/day/part, because Paymaster is the earliest-arriving
-- role we have real times for. They are flagged so nobody mistakes a guess for
-- a fact, and so the ones still needing a real answer can be listed.

begin;

alter table public.sched_hall_role_times
  add column if not exists is_placeholder boolean not null default false;

comment on column public.sched_hall_role_times.is_placeholder is
  'True when this start/end was guessed to make the role schedulable, not '
  'supplied by the hall. Clear it when a manager confirms the real time.';

comment on column public.sched_roles.fixed_count is
  'DEFAULT headcount for the role, not a maximum. Any role may be given extra '
  'people for a session via sched_session_roles.';

-- Seed times for the three roles that have none, mirroring the Paymaster.
insert into public.sched_hall_role_times
  (hall_id, role_id, dow, part, start_time, end_time, is_placeholder)
select pm.hall_id, r.id, pm.dow, pm.part, pm.start_time, pm.end_time, true
from public.sched_hall_role_times pm
join public.sched_roles pr on pr.id = pm.role_id and pr.name = 'Paymaster'
cross join public.sched_roles r
where r.name in ('MOD', 'Opener/Swing Shift', 'Flash Manager')
  and not exists (
    select 1 from public.sched_hall_role_times x
    where x.hall_id = pm.hall_id and x.role_id = r.id
      and x.dow = pm.dow and x.part = pm.part)
on conflict (hall_id, role_id, dow, part) do nothing;

-- And a headcount, so the role actually renders a slot to fill.
insert into public.sched_hall_role_needs (hall_id, role_id, dow, part, needed)
select t.hall_id, t.role_id, t.dow, t.part, coalesce(r.fixed_count, 1)
from public.sched_hall_role_times t
join public.sched_roles r on r.id = t.role_id
where r.name in ('MOD', 'Opener/Swing Shift', 'Flash Manager')
  and not exists (
    select 1 from public.sched_hall_role_needs n
    where n.hall_id = t.hall_id and n.role_id = t.role_id
      and n.dow = t.dow and n.part = t.part)
on conflict (hall_id, role_id, dow, part) do nothing;

commit;
