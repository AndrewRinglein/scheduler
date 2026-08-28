-- 042: a wider cast, and no rank on who may wear it.
--
-- Two changes, asked for together.
--
-- 1. Sixty-six new characters -- heroes, critters, robots, snacks and the
--    smaller monsters -- join the forty cats, twenty dogs and six manager
--    monsters already in the catalog.
--
-- 2. The rank gate comes off. Until now a runner could only take a cat, a
--    dog unlocked for senior staff and the monsters were manager-only, which
--    made most of the library unreachable for most of the hall. Everything is
--    now tier 0: anybody may take anything that nobody else has. Uniqueness is
--    still the rule -- one character, one person -- and it is still enforced by
--    the unique index, not by checking first.
--
-- The managers keep the characters they already have. Nothing in here
-- reassigns them; a monster is simply no longer reserved.
--
-- Reversible: set the tiers back (monsters 2, dogs 1) and restore the two
-- functions from 020 to gate on sched_staff_tier again.

begin;

-- The kind column was a three-value check (cat, dog, boss) written when that
-- was the whole library. Widen it first, on both tables, or every insert
-- below fails on the constraint rather than on anything meaningful.
alter table public.sched_pets  drop constraint if exists sched_pets_kind_check;
alter table public.sched_staff drop constraint if exists sched_staff_pet_kind_check;
alter table public.sched_pets  add constraint sched_pets_kind_check
  check (kind in ('cat','dog','boss','hero','critter','robot','snack','monster'));
alter table public.sched_staff add constraint sched_staff_pet_kind_check
  check (pet_kind is null or pet_kind in
    ('cat','dog','boss','hero','critter','robot','snack','monster'));

insert into public.sched_pets (id, kind, tier, sort) values
  ('cobbler', 'critter', 0, 300),
  ('suds', 'critter', 0, 301),
  ('honeydew', 'critter', 0, 302),
  ('lily', 'critter', 0, 303),
  ('blueberry', 'critter', 0, 304),
  ('tangerine', 'critter', 0, 305),
  ('bubblegum', 'critter', 0, 306),
  ('porcelain', 'critter', 0, 307),
  ('inkwell', 'critter', 0, 308),
  ('ember', 'critter', 0, 309),
  ('river', 'critter', 0, 310),
  ('pebble', 'critter', 0, 311),
  ('sorrel', 'critter', 0, 312),
  ('tangle', 'critter', 0, 313),
  ('clementine', 'critter', 0, 314),
  ('molasses', 'critter', 0, 315),
  ('rascal', 'critter', 0, 316),
  ('hoots', 'critter', 0, 317),
  ('thistle', 'critter', 0, 318),
  ('pokey', 'critter', 0, 319),
  ('honey', 'critter', 0, 320),
  ('acorn', 'critter', 0, 321),
  ('dumpling', 'critter', 0, 322),
  ('popcorn', 'critter', 0, 323),
  ('gumnut', 'critter', 0, 324),
  ('bao', 'critter', 0, 325),
  ('fawn', 'critter', 0, 326),
  ('timber', 'critter', 0, 327),
  ('swirl', 'critter', 0, 328),
  ('pinchy', 'critter', 0, 329),
  ('boo', 'monster', 0, 330),
  ('gloop', 'monster', 0, 331),
  ('jelly', 'monster', 0, 332),
  ('rattle', 'monster', 0, 333),
  ('wraps', 'monster', 0, 334),
  ('howl', 'monster', 0, 335),
  ('shamble', 'monster', 0, 336),
  ('frost', 'monster', 0, 337),
  ('snag', 'monster', 0, 338),
  ('grit', 'monster', 0, 339),
  ('kraken', 'monster', 0, 340),
  ('patch', 'monster', 0, 341),
  ('tinny', 'robot', 0, 342),
  ('beep', 'robot', 0, 343),
  ('hover', 'robot', 0, 344),
  ('springs', 'robot', 0, 345),
  ('crumbs', 'robot', 0, 346),
  ('bolt', 'robot', 0, 347),
  ('orbit', 'robot', 0, 348),
  ('pixel', 'robot', 0, 349),
  ('spike', 'snack', 0, 350),
  ('guac', 'snack', 0, 351),
  ('sprinkles', 'snack', 0, 352),
  ('java', 'snack', 0, 353),
  ('button', 'snack', 0, 354),
  ('tapioca', 'snack', 0, 355),
  ('sunny', 'snack', 0, 356),
  ('gherkin', 'snack', 0, 357),
  ('berry', 'snack', 0, 358),
  ('wedge', 'snack', 0, 359),
  ('tusk', 'hero', 0, 360),
  ('shade', 'hero', 0, 361),
  ('totem', 'hero', 0, 362),
  ('glaive', 'hero', 0, 363),
  ('anvil', 'hero', 0, 364),
  ('sprocket', 'hero', 0, 365)
on conflict (id) do update set kind = excluded.kind, tier = excluded.tier;

-- The gate comes off the DATA, so anything reading sched_pets.tier agrees.
update public.sched_pets set tier = 0 where tier > 0;

-- ...and off the two functions, which had the comparison hard-coded.
create or replace function public.pet_catalog(p_token text)
returns jsonb language plpgsql stable security definer
set search_path = public as $$
declare v_staff uuid;
begin
  v_staff := public.sched_token_staff(p_token);
  if v_staff is null then
    return jsonb_build_object('ok', false, 'error', 'This link is not valid any more.');
  end if;

  /* 'tier' and 'allowed' stay in the payload so the page keeps working
     unchanged; allowed is simply true for everybody now. */
  return jsonb_build_object('ok', true, 'tier', public.sched_staff_tier(v_staff),
    'mine', (select pet from public.sched_staff where id = v_staff),
    'pets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'kind', p.kind, 'tier', p.tier,
        'allowed', true,
        'mine', o.id = v_staff,
        'taken_by', case when o.id is null or o.id = v_staff then null
                         else coalesce(o.first_name, o.name) end)
        order by p.kind, p.sort)
      from public.sched_pets p
      left join public.sched_staff o on o.pet = p.id and o.active
      where not p.retired), '[]'::jsonb));
end $$;

create or replace function public.pet_claim(p_token text, p_pet text)
returns jsonb language plpgsql volatile security definer
set search_path = public as $$
declare v_staff uuid; v_pet public.sched_pets; v_who text;
begin
  v_staff := public.sched_token_staff(p_token);
  if v_staff is null then
    return jsonb_build_object('ok', false, 'error', 'This link is not valid any more.');
  end if;

  select * into v_pet from public.sched_pets where id = p_pet and not retired;
  if v_pet.id is null then
    return jsonb_build_object('ok', false, 'error', 'There is no character by that name.');
  end if;

  /* No rank check any more. The only rule left is that two people cannot
     have the same character, and the unique index is what says so. */
  begin
    update public.sched_staff set pet = v_pet.id, pet_kind = v_pet.kind where id = v_staff;
  exception when unique_violation then
    select coalesce(first_name, name) into v_who
      from public.sched_staff where pet = p_pet and active;
    return jsonb_build_object('ok', false,
      'error', coalesce(v_who, 'Someone') || ' just took that one -- pick another.');
  end;

  return jsonb_build_object('ok', true, 'pet', v_pet.id, 'kind', v_pet.kind);
end $$;

revoke all on function public.pet_catalog(text) from public;
revoke all on function public.pet_claim(text, text) from public;
grant execute on function public.pet_catalog(text) to anon, authenticated;
grant execute on function public.pet_claim(text, text) to anon, authenticated;

commit;
