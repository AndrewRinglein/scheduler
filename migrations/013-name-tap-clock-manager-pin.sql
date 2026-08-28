-- Exported verbatim from Supabase (supabase_migrations.schema_migrations).
-- Migration name: scheduler_013_name_tap_clock_manager_pin
-- Version:        20260810235705

-- Scheduler 013 — tap your name; the PIN is the manager's.
--
-- Replaces per-person PINs. Fifty PINs is fifty things to forget, reset and
-- share, and a PIN typed at a shared tablet in a busy hall is barely a secret
-- anyway. Tapping a name is honest about what it is: a claim, not proof.
--
-- The manager PIN guards the things that actually matter — approving a walk-up
-- and overriding a punch — so there is one secret to protect rather than fifty.

alter table public.sched_staff drop column if exists pin_hash;

drop function if exists public.clock_status(text);
drop function if exists public.clock_punch(text,text,text,text);
drop function if exists public.set_staff_pin(uuid,text);

-- One manager PIN, bcrypt, in settings. Never selectable by the app: the
-- existing admin_pin is plaintext '4321' readable by anyone signed in, and
-- this one decides pay, so it is verified inside the database only.
create or replace function public.set_manager_pin(p_pin text)
returns void language plpgsql security definer
set search_path = public, extensions as $$
begin
  if p_pin is null or p_pin !~ '^[0-9]{4,8}$' then
    raise exception 'PIN must be 4 to 8 digits';
  end if;
  insert into public.settings (key, value)
  values ('scheduler_manager_pin', jsonb_build_object('hash', crypt(p_pin, gen_salt('bf'))))
  on conflict (key) do update set value = excluded.value;
end $$;

create or replace function public.verify_manager_pin(p_pin text)
returns boolean language plpgsql security definer
set search_path = public, extensions as $$
declare h text;
begin
  select value->>'hash' into h from public.settings where key = 'scheduler_manager_pin';
  if h is null then return false; end if;
  return h = crypt(p_pin, h);
end $$;

-- Who is on tonight, and where each person stands. No secret involved: this is
-- the list of names the tablet shows.
create or replace function public.clock_board(p_hall text)
returns table(staff_id uuid, staff_name text, scheduled boolean, entry_id uuid,
              clocked_in boolean, on_break text, since timestamptz, hours_so_far numeric)
language sql security definer set search_path = public as $$
  with roster as (
    select distinct a.staff_id
    from public.sched_assignments a
    join public.sched_sessions s on s.id = a.session_id
    where s.session_date = current_date and s.hall_id = p_hall and a.staff_id is not null
  ),
  today as (
    select distinct on (staff_id) * from public.sched_time_entries
    where work_date = current_date and hall_id = p_hall
    order by staff_id, created_at desc
  )
  select st.id, st.name,
         (r.staff_id is not null),
         t.id,
         (t.id is not null and t.clock_out is null),
         (select bp.kind from public.sched_break_punches bp
           where bp.time_entry_id = t.id and bp.ended_at is null
           order by bp.started_at desc limit 1),
         coalesce(t.clock_in, null),
         case when t.clock_in is not null
              then round(extract(epoch from (coalesce(t.clock_out, now()) - t.clock_in))/3600.0, 2) end
  from public.sched_staff st
  left join roster r on r.staff_id = st.id
  left join today  t on t.staff_id = st.id
  where st.active and (r.staff_id is not null or t.id is not null)
  order by (r.staff_id is null), st.name;
$$;

-- Punch by staff id. p_manager_pin is required only for an override.
create or replace function public.clock_punch(
  p_staff uuid, p_hall text, p_action text,
  p_kind text default 'rest', p_manager_pin text default null)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_name text; v_entry public.sched_time_entries; v_open public.sched_break_punches;
  v_unpaid numeric := 0; v_gross numeric; v_scheduled boolean; v_override boolean := false;
begin
  select name into v_name from public.sched_staff where id = p_staff and active;
  if v_name is null then return jsonb_build_object('ok', false, 'error', 'Unknown person'); end if;

  if p_manager_pin is not null then
    if not public.verify_manager_pin(p_manager_pin) then
      return jsonb_build_object('ok', false, 'error', 'Manager PIN not recognised');
    end if;
    v_override := true;
  end if;

  select * into v_entry from public.sched_time_entries
   where staff_id = p_staff and work_date = current_date and hall_id = p_hall
   order by created_at desc limit 1;

  if p_action = 'in' then
    if v_entry.id is not null and v_entry.clock_out is null then
      return jsonb_build_object('ok', false, 'error', v_name || ' is already clocked in');
    end if;
    select exists (
      select 1 from public.sched_assignments a
      join public.sched_sessions s on s.id = a.session_id
      where a.staff_id = p_staff and s.session_date = current_date and s.hall_id = p_hall
    ) into v_scheduled;

    -- A walk-up is allowed but needs a manager PIN, because an unscheduled
    -- shift is exactly the case someone would use to add hours quietly.
    if not v_scheduled and not v_override then
      return jsonb_build_object('ok', false, 'needs_manager', true,
        'error', v_name || ' is not on tonight''s schedule — a manager PIN is needed');
    end if;

    insert into public.sched_time_entries
      (staff_id, hall_id, work_date, clock_in, is_worked_time, category, is_walk_up, approved_at)
    values (p_staff, p_hall, current_date, now(), true, 'worked',
            not v_scheduled, case when v_override then now() end)
    returning * into v_entry;

    return jsonb_build_object('ok', true, 'name', v_name, 'action', 'in', 'walk_up', not v_scheduled);
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
      update public.sched_time_entries set rest_breaks_taken = rest_breaks_taken + 1 where id = v_entry.id;
    end if;
    return jsonb_build_object('ok', true, 'name', v_name, 'action', 'break_end', 'kind', v_open.kind);

  elsif p_action = 'out' then
    if v_open.id is not null then
      update public.sched_break_punches set ended_at = now() where id = v_open.id;
    end if;
    select coalesce(sum(extract(epoch from (coalesce(ended_at, now()) - started_at))/3600.0), 0)
      into v_unpaid from public.sched_break_punches
     where time_entry_id = v_entry.id and kind = 'meal';
    v_gross := extract(epoch from (now() - v_entry.clock_in))/3600.0;
    update public.sched_time_entries
       set clock_out = now(),
           hours_worked = round(greatest(v_gross - v_unpaid, 0)::numeric, 2), updated_at = now()
     where id = v_entry.id;
    return jsonb_build_object('ok', true, 'name', v_name, 'action', 'out',
      'hours', round(greatest(v_gross - v_unpaid, 0)::numeric, 2), 'unpaid_meal', round(v_unpaid, 2));
  end if;

  return jsonb_build_object('ok', false, 'error', 'unknown action');
end $$;

revoke all on function public.set_manager_pin(text)                       from anon;
revoke all on function public.verify_manager_pin(text)                    from anon;
revoke all on function public.clock_board(text)                           from anon;
revoke all on function public.clock_punch(uuid,text,text,text,text)       from anon;
grant execute on function public.set_manager_pin(text)                    to authenticated;
grant execute on function public.verify_manager_pin(text)                 to authenticated;
grant execute on function public.clock_board(text)                        to authenticated;
grant execute on function public.clock_punch(uuid,text,text,text,text)    to authenticated;

-- The live manager PIN was set here when this migration was first run. The
-- literal has been removed: a PIN checked into the repo is a PIN that anyone
-- with read access to the folder can use to approve their own walk-up shift or
-- override a punch. Set it once, by hand, from a psql prompt or the Supabase
-- SQL editor, and do not commit the value:
--
--   select set_manager_pin('<the pin>');
--
-- The function bcrypts it; the plaintext is never stored and never comes back
-- out. Rotate the current one — it has been sitting in a file on the desktop.
select 'ready' as status;
