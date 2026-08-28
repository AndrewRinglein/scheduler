-- 016 — the management roles have no coverage floor.
--
-- MOD, Paymaster and Flash Manager each had min_on_floor = 1. With exactly one
-- person in the role that is unsatisfiable: sending them on their break would
-- drop the role to zero, so the planner refused every one of their breaks and
-- the board showed a standing red conflict at both halls every night —
-- roughly two premium hours a night that were not actually owed.
--
-- Rachel's answer: nobody relieves them. They take their break and other
-- people cover. So the floor was never 1; the role simply is not one that has
-- to be continuously staffed by that specific person.
--
-- Opener/Swing Shift was already 0. Callers (3 of 4) and Flash Runners (4)
-- keep their floors — those roles genuinely cannot thin out mid-session.

begin;

update public.sched_roles
   set min_on_floor = 0
 where name in ('MOD', 'Paymaster', 'Flash Manager');

comment on column public.sched_roles.min_on_floor is
  'How many of this role must remain on the floor while others are on break. '
  'Zero means the role is covered informally by whoever is around, so the '
  'break planner may send its only person without needing a relief.';

commit;

-- Acceptance: no role may have a floor it cannot satisfy at its own headcount.
-- (Reported, not enforced — a genuine 2-of-3 floor is legitimate.)
select r.name, r.fixed_count, r.min_on_floor,
       case when r.fixed_count is not null and r.min_on_floor >= r.fixed_count
            then 'UNSATISFIABLE — nobody in this role could ever break'
            else 'ok' end as check
  from public.sched_roles r order by r.sort;
