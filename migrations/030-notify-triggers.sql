-- 030 — The four moments that send something.
--
-- PUBLISHING IS THE TRIGGER for booking messages, and the only one. Not saving
-- an assignment, not dragging a name into a slot, not any of the dozen edits
-- that happen while a fortnight is being built. If every dropdown the manager
-- touched messaged somebody, she would stop touching dropdowns — so the send
-- hangs off the one deliberate act that means "this is now real".
--
-- Re-publishing an already-published fortnight sends nothing at all:
-- schedule_publish returns early on status = 'published', so a second click, a
-- double submit or a reload cannot message 67 people twice.
--
-- Everything queues rather than sending inline. A provider outage must not roll
-- back a publish — the fortnight is published, the messages are rows, and the
-- rows go out when the sender next runs.

CREATE OR REPLACE FUNCTION public.schedule_publish(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_p public.sched_periods; v_n int := 0; v_unreachable int := 0; r record;
begin
  select * into v_p from public.sched_periods where id = p_id;
  if v_p.id is null then return jsonb_build_object('ok', false, 'error', 'No such fortnight.'); end if;

  -- Already published: change nothing and send nothing. Re-publishing must not
  -- message 67 people a second time.
  if v_p.status = 'published' then
    return jsonb_build_object('ok', true, 'already', true, 'sent', 0);
  end if;

  update public.sched_periods
     set status = 'published', published_at = coalesce(published_at, now())
   where id = p_id;

  for r in
    select a.staff_id, count(*) as shifts
      from public.sched_assignments a
      join public.sched_sessions s on s.id = a.session_id
     where a.staff_id is not null
       and s.session_date between v_p.starts_on and v_p.ends_on
     group by a.staff_id
  loop
    if (public.notify(r.staff_id, 'booked', jsonb_build_object(
          'dates', to_char(v_p.starts_on, 'Mon FMDD') || ' – ' || to_char(v_p.ends_on, 'Mon FMDD'),
          'count', r.shifts || ' shift' || case when r.shifts = 1 then '' else 's' end
        )) ->> 'unreachable')::boolean
    then v_unreachable := v_unreachable + 1; end if;
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('ok', true, 'told', v_n, 'unreachable', v_unreachable,
    'dates', to_char(v_p.starts_on, 'Mon FMDD') || ' – ' || to_char(v_p.ends_on, 'Mon FMDD'));
end $function$;

CREATE OR REPLACE FUNCTION public.availability_send(p_request uuid DEFAULT NULL::uuid, p_nudge boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_r public.sched_availability_requests; v_n int := 0; v_u int := 0; r record;
begin
  if p_request is null then
    select * into v_r from public.sched_availability_requests
     where sent_at is not null and closed_at is null order by period_start desc limit 1;
  else
    select * into v_r from public.sched_availability_requests where id = p_request;
  end if;
  if v_r.id is null then return jsonb_build_object('ok', false, 'error', 'No request.'); end if;

  for r in
    select rp.staff_id from public.sched_availability_replies rp
     where rp.request_id = v_r.id
       -- A nudge goes only to people who have not answered.
       and (not p_nudge or rp.replied_at is null)
  loop
    if (public.notify(r.staff_id, 'availability', jsonb_build_object(
          'dates', to_char(v_r.period_start, 'Mon FMDD') || ' – ' || to_char(v_r.period_end, 'Mon FMDD')
        )) ->> 'unreachable')::boolean
    then v_u := v_u + 1; end if;
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('ok', true, 'told', v_n, 'unreachable', v_u, 'nudge', p_nudge);
end $function$;

CREATE OR REPLACE FUNCTION public.staff_welcome(p_staff uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return public.notify(p_staff, 'welcome', '{}'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION public.handoff_notify(p_handoff uuid, p_event text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_h public.sched_handoffs; v_s public.sched_sessions; v_when text; v_from text;
begin
  select * into v_h from public.sched_handoffs where id = p_handoff;
  if v_h.id is null then return jsonb_build_object('ok', false); end if;
  select * into v_s from public.sched_sessions where id = v_h.session_id;
  v_when := to_char(v_s.session_date, 'FMDay FMDD Mon') || ' at ' || upper(v_s.hall_id);

  if p_event = 'ask' then
    select coalesce(first_name, name) into v_from from public.sched_staff where id = v_h.from_staff;
    return public.notify(v_h.to_staff, 'handoff_ask',
      jsonb_build_object('from', v_from, 'when', v_when));
  elsif p_event = 'taken' then
    select coalesce(first_name, name) into v_from from public.sched_staff where id = v_h.from_staff;
    return public.notify(v_h.to_staff, 'handoff_taken',
      jsonb_build_object('from', v_from, 'when', v_when));
  elsif p_event = 'declined' then
    select coalesce(first_name, name) into v_from from public.sched_staff where id = v_h.to_staff;
    return public.notify(v_h.from_staff, 'handoff_declined',
      jsonb_build_object('from', v_from, 'when', v_when));
  end if;
  return jsonb_build_object('ok', false, 'error', 'Unknown event.');
end $function$;

revoke all on function public.schedule_publish(uuid) from public, anon;
revoke all on function public.availability_send(uuid, boolean) from public, anon;
revoke all on function public.staff_welcome(uuid) from public, anon;
revoke all on function public.handoff_notify(uuid, text) from public, anon;

grant execute on function public.schedule_publish(uuid) to authenticated;
grant execute on function public.availability_send(uuid, boolean) to authenticated;
grant execute on function public.staff_welcome(uuid) to authenticated;
grant execute on function public.handoff_notify(uuid, text) to authenticated;
