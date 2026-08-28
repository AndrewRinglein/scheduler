-- Scheduler 012 — the time clock. Applied 2026-08-10.
--
-- Shape: a tablet at the hall holds the shared staff@ session; a per-person
-- PIN says WHO is punching. Staff have no logins and are not getting them.
--
-- PINs are bcrypt via pgcrypto and never leave the database. The existing
-- admin_pin sits in settings as plaintext '4321' readable by anyone signed in
-- — tolerable for an inventory tool, not for something that decides pay. All
-- verification happens inside SECURITY DEFINER functions, so the hash cannot
-- be selected out and attacked offline.
--
-- NOTE: pgcrypto lives in the `extensions` schema on Supabase. The functions
-- pin search_path to `public, extensions` — pinning it is what stops a
-- search-path attack, so the fix is to include the schema, never to unpin.
--
-- Rest breaks are PAID and stay in the total; meal breaks are unpaid and are
-- subtracted at clock-out. A walk-up — someone working a shift they were not
-- scheduled for — is recorded and flagged for approval, never blocked. Sending
-- someone home because the software disagrees is worse than flagging it.
--
-- Reversible:
--   drop function if exists public.clock_punch(text,text,text,text);
--   drop function if exists public.clock_status(text);
--   drop function if exists public.set_staff_pin(uuid,text);
--   drop table if exists public.sched_break_punches;
--   alter table public.sched_staff drop column pin_hash;
--
-- Verified end to end against the live database: clock in, wrong PIN rejected,
-- double clock-in rejected, meal start, double-break rejected, meal end, rest
-- start, rest end, clock out, second clock-out rejected. Hash confirmed $2a$,
-- 60 chars, not equal to the PIN, and verifying correctly.

-- ---------------------------------------------------------------------
-- 013  Tap your name; the PIN is the manager's.
--
-- Per-person PINs are gone. Fifty PINs is fifty things to forget, reset and
-- share, and a PIN typed at a shared tablet in a busy hall is barely a secret.
-- Tapping a name is honest about what it is: a claim, not proof.
--
-- The manager PIN guards the case that actually matters — clocking in for a
-- shift you were not scheduled for, which is exactly how hours would be added
-- quietly. Everything else (breaks, clocking out) needs no secret, because
-- nobody gains by punching them for someone else.
--
-- One PIN to protect rather than fifty, bcrypt, verified inside the database.
--
-- Verified live: walk-up refused with no PIN, refused with a wrong PIN,
-- allowed and marked approved with the right one.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- Shift end times. Evening sessions finish at midnight; the early weekend
-- sessions at 18:30. ("6:30" read as 18:30 — an AM session starting 09:30
-- cannot end at 06:30.)
--
-- Resulting shift lengths, which matter because 10 hours is the second-meal
-- threshold and 12 is the double-time threshold:
--     Paymaster weekday  14:00-00:00 = 10.00h  <- exactly on the second-meal line
--     Paymaster Sat/Sun AM 09:30-18:30 = 9.00h
--     Callers weekday    15:15-00:00 =  8.75h  -> daily overtime every shift
--     Flash Runners PM   17:00-00:00 =  7.00h
-- ---------------------------------------------------------------------
update public.sched_hall_role_times
   set end_time = case when part = 'AM' then time '18:30' else time '00:00' end;


-- =====================================================================
-- FOLLOW-UP FIX — applied after the migration above.
--
-- Exported verbatim from Supabase (supabase_migrations.schema_migrations).
-- Migration name: scheduler_012b_pgcrypto_search_path
-- Version:        20260810085948
--
-- Why: pgcrypto lives in the `extensions` schema on Supabase, not public, so
-- the pinned search_path above hid crypt() and gen_salt(). The pinned path had
-- to include `extensions`; unpinning it was never an option.
-- =====================================================================

-- pgcrypto lives in the `extensions` schema on Supabase, not public. The
-- functions pin search_path for safety, which correctly excluded it — so
-- crypt() and gen_salt() were invisible. Add extensions to the pinned path
-- rather than unpinning it, which would reopen the search-path attack the
-- pinning exists to prevent.

create or replace function public.set_staff_pin(p_staff uuid, p_pin text)
returns void language plpgsql security definer
set search_path = public, extensions as $$
begin
  if p_pin is null or p_pin !~ '^[0-9]{4,8}$' then
    raise exception 'PIN must be 4 to 8 digits';
  end if;
  update public.sched_staff
     set pin_hash = crypt(p_pin, gen_salt('bf')), updated_at = now()
   where id = p_staff;
end $$;

create or replace function public.clock_status(p_pin text)
returns table(staff_id uuid, staff_name text, entry_id uuid, clocked_in boolean,
              on_break text, hours_so_far numeric, work_date date)
language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid; v_name text; v_entry public.sched_time_entries; v_open public.sched_break_punches;
begin
  select id, name into v_id, v_name from public.sched_staff
   where active and pin_hash is not null and pin_hash = crypt(p_pin, pin_hash) limit 1;
  if v_id is null then return; end if;

  select * into v_entry from public.sched_time_entries
   where staff_id = v_id and work_date = current_date order by created_at desc limit 1;

  if v_entry.id is not null then
    select * into v_open from public.sched_break_punches
     where time_entry_id = v_entry.id and ended_at is null order by started_at desc limit 1;
  end if;

  return query select v_id, v_name, v_entry.id,
    (v_entry.id is not null and v_entry.clock_out is null),
    v_open.kind,
    case when v_entry.clock_in is not null
         then round(extract(epoch from (coalesce(v_entry.clock_out, now()) - v_entry.clock_in))/3600.0, 2) end,
    coalesce(v_entry.work_date, current_date);
end $$;

create or replace function public.clock_punch(p_pin text, p_hall text, p_action text, p_kind text default 'rest')
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id uuid; v_name text; v_entry public.sched_time_entries; v_open public.sched_break_punches;
  v_unpaid numeric := 0; v_gross numeric; v_scheduled boolean;
begin
  select id, name into v_id, v_name from public.sched_staff
   where active and pin_hash is not null and pin_hash = crypt(p_pin, pin_hash) limit 1;
  if v_id is null then return jsonb_build_object('ok', false, 'error', 'PIN not recognised'); end if;

  select * into v_entry from public.sched_time_entries
   where staff_id = v_id and work_date = current_date order by created_at desc limit 1;

  if p_action = 'in' then
    if v_entry.id is not null and v_entry.clock_out is null then
      return jsonb_build_object('ok', false, 'error', v_name || ' is already clocked in');
    end if;
    select exists (select 1 from public.sched_assignments a
      join public.sched_sessions s on s.id = a.session_id
      where a.staff_id = v_id and s.session_date = current_date and s.hall_id = p_hall) into v_scheduled;

    insert into public.sched_time_entries
      (staff_id, hall_id, work_date, clock_in, is_worked_time, category, is_walk_up)
    values (v_id, p_hall, current_date, now(), true, 'worked', not v_scheduled)
    returning * into v_entry;

    return jsonb_build_object('ok', true, 'name', v_name, 'action', 'in',
      'walk_up', not v_scheduled, 'entry', v_entry.id);
  end if;

  if v_entry.id is null or v_entry.clock_out is not null then
    return jsonb_build_object('ok', false, 'error', v_name || ' is not clocked in');
  end if;

  select * into v_open from public.sched_break_punches
   where time_entry_id = v_entry.id and ended_at is null order by started_at desc limit 1;

  if p_action = 'break_start' then
    if v_open.id is not null then
      return jsonb_build_object('ok', false, 'error', 'already on a ' || v_open.kind || ' break');
    end if;
    insert into public.sched_break_punches (time_entry_id, kind) values (v_entry.id, p_kind);
    return jsonb_build_object('ok', true, 'name', v_name, 'action', 'break_start', 'kind', p_kind);

  elsif p_action = 'break_end' then
    if v_open.id is null then return jsonb_build_object('ok', false, 'error', 'not on a break'); end if;
    update public.sched_break_punches set ended_at = now() where id = v_open.id;
    if v_open.kind = 'meal' then
      update public.sched_time_entries set second_meal_taken = true
       where id = v_entry.id and meal_taken = true;
      update public.sched_time_entries set meal_taken = true, meal_start = v_open.started_at
       where id = v_entry.id and meal_taken = false;
    else
      update public.sched_time_entries set rest_breaks_taken = rest_breaks_taken + 1
       where id = v_entry.id;
    end if;
    return jsonb_build_object('ok', true, 'name', v_name, 'action', 'break_end', 'kind', v_open.kind);

  elsif p_action = 'out' then
    if v_open.id is not null then
      update public.sched_break_punches set ended_at = now() where id = v_open.id;
    end if;
    -- Meals are unpaid and come off the total. Rest breaks are PAID and stay in.
    select coalesce(sum(extract(epoch from (coalesce(ended_at, now()) - started_at))/3600.0), 0)
      into v_unpaid from public.sched_break_punches
     where time_entry_id = v_entry.id and kind = 'meal';

    v_gross := extract(epoch from (now() - v_entry.clock_in))/3600.0;

    update public.sched_time_entries
       set clock_out = now(),
           hours_worked = round(greatest(v_gross - v_unpaid, 0)::numeric, 2),
           updated_at = now()
     where id = v_entry.id;

    return jsonb_build_object('ok', true, 'name', v_name, 'action', 'out',
      'hours', round(greatest(v_gross - v_unpaid, 0)::numeric, 2), 'unpaid_meal', round(v_unpaid, 2));
  end if;

  return jsonb_build_object('ok', false, 'error', 'unknown action');
end $$;

grant execute on function public.set_staff_pin(uuid,text)         to authenticated;
grant execute on function public.clock_punch(text,text,text,text) to authenticated;
grant execute on function public.clock_status(text)               to authenticated;
revoke all on function public.set_staff_pin(uuid,text)            from anon;
revoke all on function public.clock_punch(text,text,text,text)    from anon;
revoke all on function public.clock_status(text)                  from anon;

select 'ready' as status;
