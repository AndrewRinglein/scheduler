-- 028 — Four defects found by a code review of Blocks A and B. Nothing new is
-- built here; this is the review's findings applied to the three functions that
-- carried them.
--
-- 1. PUBLISHED WAS CHECKED IN ONE FUNCTION OF FOUR. worker_shifts filtered on
-- it; worker_shift_respond, handoff_candidates and handoff_request did not. A
-- worker with the page already open when the manager unpublishes a fortnight to
-- rework it could still decline out of the draft — emptying a slot the manager
-- was in the middle of rebuilding, and writing a decline against something that
-- is no longer a commitment anybody made. The check now sits in all four.
--
-- 2. handoff_candidates READ THE WRONG AVAILABILITY TABLE. It consulted
-- sched_staff_availability — the manager's standing weekly grid — but never
-- sched_availability_off, which is where the fortnightly form people actually
-- fill in writes. Somebody who had said "I can't work Saturday the 15th" was
-- being offered as cover for Saturday the 15th. Both are read now.
--
-- 3. handoff_candidates IGNORED sched_declines, so the person who had refused
-- that exact session an hour earlier came straight back up the list as a
-- replacement for it.
--
-- 4. DECLINING LEFT AN OUTSTANDING HANDOFF PENDING FOREVER. The shift was
-- emptied but the ask stayed live, so the person who had been asked could still
-- accept a shift that by then belonged to nobody. A decline cancels it now.
--
-- handoff_request gets defect 1 fixed for free: it calls handoff_candidates and
-- returns its error verbatim, so the published check and the eligibility rule
-- cannot drift apart from each other.

CREATE OR REPLACE FUNCTION public.worker_shift_respond(p_token text, p_assignment uuid, p_action text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_staff uuid; v_a public.sched_assignments; v_s public.sched_sessions;
begin
  v_staff := public.sched_token_staff(p_token);
  if v_staff is null then
    return jsonb_build_object('ok', false, 'error', 'This link is not valid any more.');
  end if;

  select * into v_a from public.sched_assignments where id = p_assignment;
  if v_a.id is null or v_a.staff_id is distinct from v_staff then
    return jsonb_build_object('ok', false, 'error', 'That shift is not yours.');
  end if;
  select * into v_s from public.sched_sessions where id = v_a.session_id;

  -- A draft is the manager still thinking. Nothing in it may be acted on.
  if not exists (select 1 from public.sched_periods p
                  where v_s.session_date between p.starts_on and p.ends_on
                    and p.status = 'published') then
    return jsonb_build_object('ok', false,
      'error', 'That schedule is not published any more — check with your manager.');
  end if;

  if p_action = 'accepted' then
    update public.sched_assignments
       set response = 'accepted', responded_at = now(), updated_at = now()
     where id = p_assignment;
    return jsonb_build_object('ok', true, 'response', 'accepted');

  elsif p_action = 'declined' then
    insert into public.sched_declines (staff_id, session_id, role_id, slot_index, reason)
    values (v_staff, v_a.session_id, v_a.role_id, v_a.slot_index,
            nullif(trim(coalesce(p_reason,'')),''));
    -- Any request out on this shift dies with it. Leaving it pending would let
    -- somebody accept a shift that now belongs to nobody.
    update public.sched_handoffs set status = 'cancelled', resolved_at = now()
     where assignment_id = p_assignment and status = 'pending';
    update public.sched_assignments
       set staff_id = null, response = 'declined', responded_at = now(), updated_at = now()
     where id = p_assignment;
    return jsonb_build_object('ok', true, 'response', 'declined',
      'date', v_s.session_date, 'hall', v_s.hall_id);
  end if;

  return jsonb_build_object('ok', false, 'error', 'Unknown action.');
end $function$;

CREATE OR REPLACE FUNCTION public.handoff_candidates(p_token text, p_assignment uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_staff uuid; v_a public.sched_assignments; v_s public.sched_sessions;
begin
  v_staff := public.sched_token_staff(p_token);
  if v_staff is null then
    return jsonb_build_object('ok', false, 'error', 'This link is not valid any more.');
  end if;

  select * into v_a from public.sched_assignments where id = p_assignment;
  if v_a.id is null or v_a.staff_id is distinct from v_staff then
    return jsonb_build_object('ok', false, 'error', 'That shift is not yours.');
  end if;
  select * into v_s from public.sched_sessions where id = v_a.session_id;

  if not exists (select 1 from public.sched_periods p
                  where v_s.session_date between p.starts_on and p.ends_on
                    and p.status = 'published') then
    return jsonb_build_object('ok', false,
      'error', 'That schedule is not published any more.');
  end if;

  return jsonb_build_object('ok', true, 'people', coalesce((
    select jsonb_agg(jsonb_build_object(
      'staff_id', c.id, 'name', coalesce(c.first_name, c.name),
      'pet', c.pet, 'pet_kind', c.pet_kind) order by coalesce(c.first_name, c.name))
    from public.sched_staff c
    where c.active
      and c.id <> v_staff
      and (
        (select r.name from public.sched_roles r where r.id = v_a.role_id) = 'Flash Runners'
        or exists (select 1 from public.sched_staff_role_capability k
                    where k.staff_id = c.id and k.role_id = v_a.role_id
                      and (k.can_do or k.is_deputy)))
      -- Not already in a chair this session.
      and not exists (select 1 from public.sched_assignments b
                       where b.session_id = v_a.session_id and b.staff_id = c.id)
      -- Not standing-marked unavailable for this weekday and part.
      and not exists (select 1 from public.sched_staff_availability av
                       where av.staff_id = c.id
                         and av.dow = extract(dow from v_s.session_date)::int
                         and av.part = v_s.part
                         and av.available = false)
      -- Nor unavailable for this SPECIFIC date on the fortnightly form, which
      -- is where people actually record their time off.
      and not exists (select 1 from public.sched_availability_off o
                       where o.staff_id = c.id
                         and o.session_date = v_s.session_date
                         and o.part = v_s.part)
      -- Nor somebody who has already refused this very session.
      and not exists (select 1 from public.sched_declines d
                       where d.staff_id = c.id and d.session_id = v_a.session_id)
  ), '[]'::jsonb));
end $function$;

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

  -- One call, reused: it carries the published check and the whole
  -- eligibility rule, so the two can never disagree with each other.
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
  return jsonb_build_object('ok', true, 'id', v_id);
end $function$;

revoke all on function public.worker_shift_respond(text, uuid, text, text) from public;
revoke all on function public.handoff_candidates(text, uuid) from public;
revoke all on function public.handoff_request(text, uuid, uuid) from public;

grant execute on function public.worker_shift_respond(text, uuid, text, text) to anon, authenticated;
grant execute on function public.handoff_candidates(text, uuid) to anon, authenticated;
grant execute on function public.handoff_request(text, uuid, uuid) to anon, authenticated;
