-- 021 — the character travels with the person to every screen.
--
-- clock_board did not return it at all and break_board returned only the id,
-- not the kind — and the kind decides which folder the sprite lives in
-- (monsters are not pets). Both now carry pet and pet_kind so the tablet and
-- the TV can draw a person the same way the manager app does.

-- clock_board gains two output columns, and Postgres treats the OUT-parameter
-- row type as part of a function's identity — so it has to be dropped and
-- rebuilt rather than replaced. Checked first: nothing depends on it. Its
-- grants go with it, so they are restored explicitly at the bottom.
drop function if exists public.clock_board(text);

create function public.clock_board(p_hall text)
returns table(staff_id uuid, staff_name text, scheduled boolean, entry_id uuid,
              clocked_in boolean, on_break text, since timestamptz, hours_so_far numeric,
              pet text, pet_kind text)
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
              then round(extract(epoch from (coalesce(t.clock_out, now()) - t.clock_in))/3600.0, 2) end,
         st.pet, st.pet_kind
  from public.sched_staff st
  left join roster r on r.staff_id = st.id
  left join today  t on t.staff_id = st.id
  where st.active and (r.staff_id is not null or t.id is not null)
  order by (r.staff_id is null), st.name;
$$;

create or replace function public.break_board(p_hall text)
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'now', now(),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
        'staff_id', st.id, 'name', st.name, 'pet', st.pet, 'pet_kind', st.pet_kind,
        'role_id', r.id, 'role', r.name,
        'floor', coalesce(n.needed_floor, r.min_on_floor),
        'cover_group', r.cover_group,
        'clock_in', t.clock_in, 'clock_out', t.clock_out,
        'entry_id', t.id,
        'scheduled_end', a.scheduled_end,
        'breaks', coalesce((
          select jsonb_agg(jsonb_build_object('kind', bp.kind,
                   'started_at', bp.started_at, 'ended_at', bp.ended_at)
                 order by bp.started_at)
          from public.sched_break_punches bp where bp.time_entry_id = t.id), '[]'::jsonb)
      ) order by r.sort, st.name)
      from public.sched_time_entries t
      join public.sched_staff st on st.id = t.staff_id
      left join lateral (
        select a2.role_id, a2.scheduled_end
        from public.sched_assignments a2
        join public.sched_sessions s2 on s2.id = a2.session_id
        where a2.staff_id = t.staff_id and s2.session_date = t.work_date and s2.hall_id = t.hall_id
        limit 1) a on true
      left join public.sched_roles r on r.id = a.role_id
      left join lateral (
        select nn.min_on_floor as needed_floor from public.sched_hall_role_needs nn
        where nn.hall_id = t.hall_id and nn.role_id = a.role_id
          and nn.dow = extract(dow from t.work_date)::int limit 1) n on true
      where t.hall_id = p_hall and t.work_date = current_date and t.clock_out is null
    ), '[]'::jsonb),
    'decisions', coalesce((
      select jsonb_agg(jsonb_build_object('staff_id', d.staff_id, 'kind', d.kind,
               'seq', d.seq, 'decision', d.decision, 'postpone_min', d.postpone_min))
      from public.sched_break_decisions d
      where d.hall_id = p_hall and d.work_date = current_date), '[]'::jsonb)
  );
$$;

-- Restored to match what the function had before it was dropped.
grant execute on function public.clock_board(text) to authenticated, service_role;
