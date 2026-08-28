-- 025b — worker_shifts carries handoff state. Replaces 024's function in place.
--
-- A shift with a request already out on it now SAYS SO. Without that marker the
-- person looks at a shift that appears untouched, asks somebody else as well,
-- and on the day two people turn up for one slot.
--
-- A request waiting on YOU arrives on the same page, under `incoming`, instead
-- of on a separate screen the worker has to know to go and look at.
--
-- Stale requests are swept first: handoff_expire_stale() runs at the top, so
-- nothing below can show a pending ask for a shift that has already passed.

CREATE OR REPLACE FUNCTION public.worker_shifts(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_staff uuid;
begin
  v_staff := public.sched_token_staff(p_token);
  if v_staff is null then
    return jsonb_build_object('ok', false, 'error', 'This link is not valid any more.');
  end if;

  perform public.handoff_expire_stale();

  return jsonb_build_object('ok', true,
    'shifts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'assignment_id', a.id,
        'session_id',    s.id,
        'date',          s.session_date,
        'part',          s.part,
        'hall',          s.hall_id,
        'role',          r.name,
        'role_id',       r.id,
        'starts',        to_char(coalesce(a.scheduled_start, t.start_time), 'HH24:MI'),
        'ends',          to_char(coalesce(a.scheduled_end,   t.end_time),   'HH24:MI'),
        'response',      a.response,
        'responded_at',  a.responded_at,
        'handed_from',   (select coalesce(f.first_name, f.name)
                            from public.sched_staff f where f.id = a.handed_from),
        'past',          s.session_date < current_date,
        'pending_handoff', (
          select jsonb_build_object('id', h.id,
                   'name', coalesce(w.first_name, w.name))
            from public.sched_handoffs h
            join public.sched_staff w on w.id = h.to_staff
           where h.assignment_id = a.id and h.status = 'pending' limit 1)
      ) order by s.session_date, s.part)
      from public.sched_assignments a
      join public.sched_sessions s on s.id = a.session_id
      join public.sched_roles r    on r.id = a.role_id
      join public.sched_periods p
        on s.session_date between p.starts_on and p.ends_on
       and p.status = 'published'
      left join public.sched_hall_role_times t
        on t.hall_id = s.hall_id and t.role_id = a.role_id and t.part = s.part
       and t.dow = extract(dow from s.session_date)::int
      where a.staff_id = v_staff
        and s.session_date >= current_date - 7
    ), '[]'::jsonb),
    'incoming', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',        h.id,
        'from_name', coalesce(f.first_name, f.name),
        'date',      s.session_date,
        'part',      s.part,
        'hall',      s.hall_id,
        'role',      r.name,
        'starts',    to_char(coalesce(a.scheduled_start, t.start_time), 'HH24:MI')
      ) order by s.session_date)
      from public.sched_handoffs h
      join public.sched_assignments a on a.id = h.assignment_id
      join public.sched_sessions s    on s.id = h.session_id
      join public.sched_roles r       on r.id = a.role_id
      join public.sched_staff f       on f.id = h.from_staff
      left join public.sched_hall_role_times t
        on t.hall_id = s.hall_id and t.role_id = a.role_id and t.part = s.part
       and t.dow = extract(dow from s.session_date)::int
      where h.to_staff = v_staff and h.status = 'pending'
    ), '[]'::jsonb));
end $function$;

revoke all on function public.worker_shifts(text) from public;
grant execute on function public.worker_shifts(text) to anon, authenticated;
