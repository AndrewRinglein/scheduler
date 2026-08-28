-- 030b — Handoffs tell the person who has to act.
--
-- Asking somebody to cover a shift only works if they find out. These are 025's
-- two functions unchanged but for one line each: the ask notifies the person
-- being asked, and the answer notifies the person waiting on it.
--
-- Safe from an anonymous link: handoff_notify is never granted to anon. It is
-- called from inside these SECURITY DEFINER functions, which have already
-- established that the caller's token owns the shift being handed over, or is
-- the person the request was addressed to. A worker's token can therefore only
-- ever message somebody already party to the handoff it owns; it never names a
-- recipient, a template or an event itself.

CREATE OR REPLACE FUNCTION public.handoff_request(p_token text, p_assignment uuid, p_to uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_staff uuid; v_a public.sched_assignments; v_id uuid; v_c jsonb;
begin
  v_staff := public.sched_token_staff(p_token);
  if v_staff is null then
    return jsonb_build_object('ok', false, 'error', 'This link is not valid any more.');
  end if;
  select * into v_a from public.sched_assignments where id = p_assignment;
  if v_a.id is null or v_a.staff_id is distinct from v_staff then
    return jsonb_build_object('ok', false, 'error', 'That shift is not yours.');
  end if;

  v_c := public.handoff_candidates(p_token, p_assignment);
  if not (v_c->>'ok')::boolean then return v_c; end if;
  if not exists (select 1 from jsonb_array_elements(v_c->'people') p
                  where (p->>'staff_id')::uuid = p_to) then
    return jsonb_build_object('ok', false,
      'error', 'They are not able to cover that shift.');
  end if;

  begin
    insert into public.sched_handoffs (assignment_id, session_id, from_staff, to_staff)
    values (p_assignment, v_a.session_id, v_staff, p_to) returning id into v_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false,
      'error', 'You have already asked somebody about this shift.');
  end;

  perform public.handoff_notify(v_id, 'ask');
  return jsonb_build_object('ok', true, 'id', v_id);
end $function$;

CREATE OR REPLACE FUNCTION public.handoff_respond(p_token text, p_handoff uuid, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_staff uuid; v_h public.sched_handoffs; v_a public.sched_assignments;
begin
  v_staff := public.sched_token_staff(p_token);
  if v_staff is null then
    return jsonb_build_object('ok', false, 'error', 'This link is not valid any more.');
  end if;

  select * into v_h from public.sched_handoffs where id = p_handoff for update;
  if v_h.id is null or v_h.to_staff <> v_staff then
    return jsonb_build_object('ok', false, 'error', 'That request is not for you.');
  end if;
  if v_h.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'That has already been dealt with.');
  end if;

  if p_action = 'declined' then
    update public.sched_handoffs set status = 'declined', resolved_at = now()
     where id = p_handoff;
    -- The person who asked needs to know, or they wait for an answer that came.
    perform public.handoff_notify(p_handoff, 'declined');
    return jsonb_build_object('ok', true, 'status', 'declined');
  end if;

  if p_action <> 'accepted' then
    return jsonb_build_object('ok', false, 'error', 'Unknown action.');
  end if;

  select * into v_a from public.sched_assignments where id = v_h.assignment_id for update;
  if v_a.staff_id is distinct from v_h.from_staff then
    update public.sched_handoffs set status = 'expired', resolved_at = now()
     where id = p_handoff;
    return jsonb_build_object('ok', false,
      'error', 'That shift has already changed hands.');
  end if;

  update public.sched_assignments
     set staff_id = v_staff, handed_from = v_h.from_staff,
         response = 'accepted', responded_at = now(), updated_at = now()
   where id = v_h.assignment_id;
  update public.sched_handoffs set status = 'accepted', resolved_at = now()
   where id = p_handoff;

  perform public.handoff_notify(p_handoff, 'taken');
  return jsonb_build_object('ok', true, 'status', 'accepted');
end $function$;

revoke all on function public.handoff_request(text, uuid, uuid) from public;
revoke all on function public.handoff_respond(text, uuid, text) from public;

grant execute on function public.handoff_request(text, uuid, uuid) to anon, authenticated;
grant execute on function public.handoff_respond(text, uuid, text) to anon, authenticated;
