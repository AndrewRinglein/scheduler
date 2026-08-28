-- 027 — The manager's "what needs me" list.
--
-- She gets no texts. Nothing is pushed at her; everything collects here and she
-- reads it when she chooses to. This one call is the whole inbox.
--
-- THE LIST HOLDS TWO KINDS OF THING, and they are not interchangeable.
-- EVENTS happened at a moment — somebody declined, a handoff completed. They
-- are news, they stay true forever, and once read they can be marked seen.
-- STATES are conditions that are true right now — nobody replied, somebody is
-- over their cap, a session is short-crewed. They stay true until somebody
-- fixes the underlying thing, so marking a state seen would be a lie. Only
-- events are filtered by sched_manager_seen; states are recomputed every call.

create table if not exists public.sched_manager_seen (
  who      text        primary key,
  seen_at  timestamptz not null default now()
);

alter table public.sched_manager_seen enable row level security;

drop policy if exists sched_manager_seen_rw on public.sched_manager_seen;
create policy sched_manager_seen_rw on public.sched_manager_seen
  for all to authenticated using (true) with check (true);

CREATE OR REPLACE FUNCTION public.manager_attention()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_seen timestamptz; v_req uuid;
begin
  select seen_at into v_seen from public.sched_manager_seen where who = 'manager';
  v_seen := coalesce(v_seen, now() - interval '30 days');

  select id into v_req from public.sched_availability_requests
   where sent_at is not null and closed_at is null
   order by period_start desc limit 1;

  return jsonb_build_object(
    'ok', true, 'seen_at', v_seen,

    -- EVENT: somebody refused a shift. The slot is already empty.
    'declines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'name', coalesce(st.first_name, st.name), 'pet', st.pet,
        'pet_kind', st.pet_kind, 'date', s.session_date, 'hall', s.hall_id,
        'role', r.name, 'reason', d.reason, 'at', d.declined_at)
        order by d.declined_at desc)
      from public.sched_declines d
      join public.sched_staff st on st.id = d.staff_id
      join public.sched_sessions s on s.id = d.session_id
      left join public.sched_roles r on r.id = d.role_id
      where d.declined_at > v_seen), '[]'::jsonb),

    -- EVENT: a shift changed hands. She is told, not asked.
    'handoffs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', h.id, 'from', coalesce(f.first_name, f.name),
        'to', coalesce(w.first_name, w.name),
        'date', s.session_date, 'hall', s.hall_id, 'at', h.resolved_at)
        order by h.resolved_at desc)
      from public.sched_handoffs h
      join public.sched_staff f on f.id = h.from_staff
      join public.sched_staff w on w.id = h.to_staff
      join public.sched_sessions s on s.id = h.session_id
      where h.status = 'accepted' and h.resolved_at > v_seen), '[]'::jsonb),

    -- STATE: asked and never answered. True until they answer.
    'no_reply', coalesce((
      select jsonb_agg(jsonb_build_object(
        'staff_id', st.id, 'name', coalesce(st.first_name, st.name),
        'pet', st.pet, 'pet_kind', st.pet_kind,
        'reachable', (st.phone is not null and st.phone <> '')
                  or (st.email is not null and st.email <> ''))
        order by coalesce(st.first_name, st.name))
      from public.sched_availability_replies rp
      join public.sched_staff st on st.id = rp.staff_id
      where rp.request_id = v_req and rp.replied_at is null), '[]'::jsonb),

    -- STATE: critical staff over their allowance, awaiting a decision.
    'over_cap', coalesce((
      select jsonb_agg(jsonb_build_object(
        'staff_id', st.id, 'name', coalesce(st.first_name, st.name),
        'note', rp.note,
        'days_off', (select count(distinct o.session_date)
                       from public.sched_availability_off o
                      where o.request_id = rp.request_id and o.staff_id = rp.staff_id))
        order by coalesce(st.first_name, st.name))
      from public.sched_availability_replies rp
      join public.sched_staff st on st.id = rp.staff_id
      where rp.request_id = v_req and rp.needs_review and rp.reviewed_at is null), '[]'::jsonb),

    -- STATE: a published session that is not fully crewed.
    'short', coalesce((
      select jsonb_agg(x order by x->>'date') from (
        select jsonb_build_object(
          'session_id', s.id, 'date', s.session_date, 'hall', s.hall_id,
          'part', s.part, 'short_by', sum(coalesce(sr.needed, n.needed, 0)) - count(a.staff_id)
        ) as x
        from public.sched_sessions s
        join public.sched_periods p
          on s.session_date between p.starts_on and p.ends_on and p.status = 'published'
        join public.sched_hall_role_needs n
          on n.hall_id = s.hall_id and n.part = s.part
         and n.dow = extract(dow from s.session_date)::int
        left join public.sched_session_roles sr
          on sr.session_id = s.id and sr.role_id = n.role_id
        left join public.sched_assignments a
          on a.session_id = s.id and a.role_id = n.role_id and a.staff_id is not null
        where s.session_date >= current_date
        group by s.id, s.session_date, s.hall_id, s.part
        having sum(coalesce(sr.needed, n.needed, 0)) > count(a.staff_id)
      ) t), '[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.manager_mark_seen()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.sched_manager_seen (who, seen_at) values ('manager', now())
  on conflict (who) do update set seen_at = now();
  return jsonb_build_object('ok', true);
end $function$;

revoke all on function public.manager_attention() from public, anon;
revoke all on function public.manager_mark_seen() from public, anon;
grant execute on function public.manager_attention() to authenticated;
grant execute on function public.manager_mark_seen() to authenticated;
