-- 043: spread the crew across the whole cast.
--
-- Before this, everybody who is not a manager was a cat or a dog, because
-- those were the only two things a non-manager could hold. 042 opened the
-- library; this deals the new characters out so the floor actually looks
-- mixed -- a hero next to a robot next to a snack next to a cat.
--
-- Who is NOT touched:
--   * the managers (tier 2) -- they keep the creatures they have
--   * Brandon, who was given the orc warrior on purpose
--   * anybody inactive
--
-- The deal is a round-robin across kinds rather than a shuffle, so it is
-- deterministic: run it twice and you get the same board. Pets already held
-- by someone outside the set being dealt to are excluded, so the unique
-- index has nothing to complain about.
--
-- Reversible in the only sense that matters: everyone may change their own
-- character from their portal, and nothing here is load-bearing.

begin;

create temporary table _deal on commit drop as
with folks as (
  select s.id, row_number() over (order by s.name) rn
  from public.sched_staff s
  where s.active and public.sched_staff_tier(s.id) < 2 and s.name <> 'Brandon'
),
pool as (
  select p.id, p.kind, row_number() over (partition by p.kind order by p.sort) k_rn
  from public.sched_pets p
  where not p.retired and p.kind <> 'boss' and p.id <> 'tusk'
    and p.id not in (select pet from public.sched_staff
                     where pet is not null and id not in (select id from folks))
),
ordered as (
  select id, kind, row_number() over (
    order by k_rn,
      case kind when 'hero' then 1 when 'critter' then 2 when 'robot' then 3
                when 'snack' then 4 when 'monster' then 5 when 'cat' then 6
                else 7 end) rn
  from pool
)
select f.id as staff_id, o.id as pet, o.kind as pet_kind
from folks f join ordered o on o.rn = f.rn;

-- Clear first. A straight UPDATE would trip the one-character-one-person
-- unique index the moment two rows swap, and the index is not deferrable.
update public.sched_staff s set pet = null, pet_kind = null
where s.id in (select staff_id from _deal);

update public.sched_staff s set pet = d.pet, pet_kind = d.pet_kind
from _deal d where s.id = d.staff_id;

commit;
