-- 017 — cover groups: who prefers not to be on break at the same moment.
--
-- min_on_floor cannot express this. MOD, Opener/Swing Shift, Paymaster and
-- Flash Manager are each alone in their own role, so a per-role floor can only
-- be 0 or "never breaks". With 0 the planner correctly gives them all their
-- breaks — and sends all four at 18:15, leaving nobody in charge.
--
-- A cover group is a SOFT preference: roles in the same group are staggered
-- when there is room, and the preference is dropped rather than refuse anybody
-- a break. A missed break costs a premium hour; an empty office at 18:15 costs
-- nothing legally. So the law wins and the preference bends.
--
-- Null means the role is its own group and only its floor constrains it.

begin;

alter table public.sched_roles
  add column if not exists cover_group text;

comment on column public.sched_roles.cover_group is
  'Roles sharing a group prefer not to be on break simultaneously. A soft '
  'preference only — never enforced at the cost of somebody missing a break. '
  'Null means the role stands alone.';

update public.sched_roles
   set cover_group = 'management'
 where name in ('MOD', 'Opener/Swing Shift', 'Paymaster', 'Flash Manager');

commit;

select name, fixed_count, min_on_floor, cover_group
  from public.sched_roles order by sort;

-- 017b — break_board carries the group through to the page.
create or replace function public.break_board(p_hall text)
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'now', now(),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
        'staff_id', st.id, 'name', st.name, 'pet', st.pet,
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
