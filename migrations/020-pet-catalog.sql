-- 020 — the character catalog, and one character per person.
--
-- The art has existed all along in "Bingo Scheduler V2": 40 cats, 20 dogs and
-- 6 monsters, each with a sit and a walk pose. It is now copied to sched/art/
-- and this puts the catalog in the database so the picker has something to
-- read and exclusivity has something to enforce.
--
-- TIERS, from the picker prototype: floor runners take cats, senior staff
-- unlock dogs, managers get monsters. Cumulative — a senior may still choose a
-- cat if they want one. tier is the RANK, so "may I have this" is
-- pet.tier <= person's rank rather than a table of special cases.
--
-- ONE PET, ONE PERSON. Enforced by a unique index rather than by convention,
-- because convention is what produced the state this migration is fixing:
-- 51 people were sharing 32 names, and six of those names (bramble, cricket,
-- sesame, tofu, mango, waffle) were invented and have no art at all.
--
-- A "-d" suffix separates the dog from the cat of the same name. It is a file
-- naming detail and is stripped everywhere a person reads it: biscuit-d is
-- just "biscuit" to whoever owns it.

begin;

create table if not exists public.sched_pets (
  id      text primary key,
  kind    text not null check (kind in ('cat','dog','boss')),
  tier    integer not null,
  sort    integer not null default 0,
  retired boolean not null default false
);

insert into public.sched_pets (id, kind, tier, sort) values
  ('apricot','cat',0,0),
  ('bandit','cat',0,1),
  ('basil','cat',0,2),
  ('beans','cat',0,3),
  ('biscuit','cat',0,4),
  ('bruno','cat',0,5),
  ('cinnamon','cat',0,6),
  ('clover','cat',0,7),
  ('cocoa','cat',0,8),
  ('daisy','cat',0,9),
  ('domino','cat',0,10),
  ('duchess','cat',0,11),
  ('finn','cat',0,12),
  ('ginger','cat',0,13),
  ('hazel','cat',0,14),
  ('juniper','cat',0,15),
  ('luna','cat',0,16),
  ('maple','cat',0,17),
  ('marmalade','cat',0,18),
  ('midnight','cat',0,19),
  ('mittens','cat',0,20),
  ('mochi','cat',0,21),
  ('nutmeg','cat',0,22),
  ('olive','cat',0,23),
  ('peaches','cat',0,24),
  ('pepper','cat',0,25),
  ('pickles','cat',0,26),
  ('poppy','cat',0,27),
  ('pumpkin','cat',0,28),
  ('rusty','cat',0,29),
  ('sage','cat',0,30),
  ('shadow','cat',0,31),
  ('smokey','cat',0,32),
  ('snowball','cat',0,33),
  ('socks','cat',0,34),
  ('tiger','cat',0,35),
  ('truffle','cat',0,36),
  ('waffles','cat',0,37),
  ('willow','cat',0,38),
  ('zuzu','cat',0,39),
  ('bandit-d','dog',1,0),
  ('bear','dog',1,1),
  ('biscuit-d','dog',1,2),
  ('blue','dog',1,3),
  ('bruiser','dog',1,4),
  ('chico','dog',1,5),
  ('daisy-d','dog',1,6),
  ('gus','dog',1,7),
  ('kona','dog',1,8),
  ('mabel','dog',1,9),
  ('moose','dog',1,10),
  ('noodle','dog',1,11),
  ('olive-d','dog',1,12),
  ('pepper-d','dog',1,13),
  ('rocky','dog',1,14),
  ('rufus','dog',1,15),
  ('scout','dog',1,16),
  ('teddy','dog',1,17),
  ('waffle-d','dog',1,18),
  ('ziggy','dog',1,19),
  ('dragon','boss',2,0),
  ('ducky','boss',2,1),
  ('vampire','boss',2,2),
  ('werewolf','boss',2,3),
  ('witch','boss',2,4),
  ('zombie','boss',2,5)
on conflict (id) do update set kind = excluded.kind, tier = excluded.tier;

alter table public.sched_pets enable row level security;
drop policy if exists sched_pets_read on public.sched_pets;
create policy sched_pets_read on public.sched_pets for all to authenticated using (true) with check (true);

commit;
-- Everyone's rank, derived from what they are qualified to do rather than
-- stored, so a promotion in the capability matrix unlocks the dog tier by
-- itself. 2 = manager (can run the floor as MOD), 1 = senior (any named role
-- beyond flash runner), 0 = floor runner.
create or replace function public.sched_staff_tier(p_staff uuid)
returns integer language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.sched_staff_role_capability c
                   join public.sched_roles r on r.id = c.role_id
                  where c.staff_id = p_staff and r.name = 'MOD' and (c.can_do or c.is_deputy))
      then 2
    when public.sched_is_critical(p_staff) then 1
    else 0 end;
$$;

-- Wipe the old assignments: six of the names were invented and most of the
-- rest were shared. Nothing here is worth preserving.
update public.sched_staff set pet = null, pet_kind = null;

-- One pet, one person. A partial unique index so any number of people may have
-- no pet yet, but no two may hold the same one.
drop index if exists sched_staff_pet_unique;
create unique index sched_staff_pet_unique on public.sched_staff(pet) where pet is not null;

-- Assign by rank, best tier first, longest-serving first within a rank so the
-- people who have been here longest get first pick of what is left.
with ranked as (
  select s.id, public.sched_staff_tier(s.id) as tier,
         row_number() over (partition by public.sched_staff_tier(s.id)
                            order by s.created_at, s.name) as seat
  from public.sched_staff s where s.active
),
-- Managers take monsters, senior take dogs, runners take cats. Where a tier
-- runs out the leftovers of the tier below are used, which is what happens to
-- the runners: 51 of them and only 40 cats.
pool as (
  select p.id as pet, p.kind, p.tier,
         row_number() over (partition by p.tier order by p.sort) as slot
  from public.sched_pets p where not p.retired
),
managers as (
  select r.id, p.pet, p.kind from ranked r
  join pool p on p.tier = 2 and p.slot = r.seat where r.tier = 2
),
seniors as (
  select r.id, p.pet, p.kind from ranked r
  join pool p on p.tier = 1 and p.slot = r.seat where r.tier = 1
),
runners as (
  select r.id, p.pet, p.kind from ranked r
  join pool p on p.tier = 0 and p.slot = r.seat where r.tier = 0
),
all_assign as (
  select * from managers union all select * from seniors union all select * from runners
)
update public.sched_staff s
   set pet = a.pet, pet_kind = a.kind
  from all_assign a where a.id = s.id;

-- Runners who found no cat left take a spare dog rather than nothing. Ranked
-- by seniority again so it is not arbitrary who gets bumped up.
with spare as (
  select p.id as pet, p.kind,
         row_number() over (order by p.sort) as slot
  from public.sched_pets p
  where p.kind = 'dog' and not p.retired
    and not exists (select 1 from public.sched_staff s where s.pet = p.id)
),
without as (
  select s.id, row_number() over (order by s.created_at, s.name) as slot
  from public.sched_staff s
  where s.active and s.pet is null and public.sched_staff_tier(s.id) = 0
)
update public.sched_staff s set pet = sp.pet, pet_kind = sp.kind
  from without w join spare sp on sp.slot = w.slot where w.id = s.id;
-- The picker. Everyone gets a character and everyone may change it, so this
-- has to answer three things at once: what exists, what is already taken and
-- by whom, and what this particular person is allowed to take.
--
-- Owner names are FIRST names only. The point is "Gina has that one, pick
-- another", not a directory of who works here.
create or replace function public.pet_catalog(p_token text)
returns jsonb language plpgsql stable security definer
set search_path = public as $$
declare v_staff uuid; v_tier int;
begin
  v_staff := public.sched_token_staff(p_token);
  if v_staff is null then
    return jsonb_build_object('ok', false, 'error', 'This link is not valid any more.');
  end if;
  v_tier := public.sched_staff_tier(v_staff);

  return jsonb_build_object('ok', true, 'tier', v_tier,
    'mine', (select pet from public.sched_staff where id = v_staff),
    'pets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'kind', p.kind, 'tier', p.tier,
        'allowed', p.tier <= v_tier,
        'mine', o.id = v_staff,
        'taken_by', case when o.id is null or o.id = v_staff then null
                         else coalesce(o.first_name, o.name) end)
        order by p.tier, p.sort)
      from public.sched_pets p
      left join public.sched_staff o on o.pet = p.id and o.active
      where not p.retired), '[]'::jsonb));
end $$;

-- Claiming. The unique index is the real guard — two people tapping the same
-- cat at the same moment is a race no amount of checking-first can close, so
-- the insert is attempted and the violation is caught and explained.
create or replace function public.pet_claim(p_token text, p_pet text)
returns jsonb language plpgsql volatile security definer
set search_path = public as $$
declare v_staff uuid; v_tier int; v_pet public.sched_pets; v_who text;
begin
  v_staff := public.sched_token_staff(p_token);
  if v_staff is null then
    return jsonb_build_object('ok', false, 'error', 'This link is not valid any more.');
  end if;

  select * into v_pet from public.sched_pets where id = p_pet and not retired;
  if v_pet.id is null then
    return jsonb_build_object('ok', false, 'error', 'There is no character by that name.');
  end if;

  v_tier := public.sched_staff_tier(v_staff);
  if v_pet.tier > v_tier then
    return jsonb_build_object('ok', false,
      'error', case v_pet.kind when 'boss' then 'The monsters are for managers.'
                               else 'Dogs unlock for senior staff.' end);
  end if;

  begin
    update public.sched_staff set pet = v_pet.id, pet_kind = v_pet.kind where id = v_staff;
  exception when unique_violation then
    select coalesce(first_name, name) into v_who
      from public.sched_staff where pet = p_pet and active;
    return jsonb_build_object('ok', false,
      'error', coalesce(v_who, 'Someone') || ' just took that one — pick another.');
  end;

  return jsonb_build_object('ok', true, 'pet', v_pet.id, 'kind', v_pet.kind);
end $$;

revoke all on function public.pet_catalog(text) from public;
revoke all on function public.pet_claim(text, text) from public;
grant execute on function public.pet_catalog(text) to anon, authenticated;
grant execute on function public.pet_claim(text, text) to anon, authenticated;
