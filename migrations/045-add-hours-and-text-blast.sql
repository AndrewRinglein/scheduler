-- 045: Add Hours on a person, and "Text everybody the schedule".
--
-- Two functions Angela asked for from the staff view, plus the blast.
--
-- add_worked_hours: "You can choose a day, and then you just create hours,
-- and it's like creating a mini shift. It might be 1 hour, it might be 5."
-- These are WORKED time entries -- her choice, asked explicitly -- so they
-- land in payroll and the person's hours immediately. Category carries
-- vacation/sick/PTO/holiday, which set is_worked_time false exactly as the
-- reconciliation import does. Adding hours twice on the same day ADDS -- two
-- one-hour stints are a real thing -- against the existing partial unique
-- index (one manual row per person/day/hall, assignment_id null).
--
-- schedule_blast: a send-any-time button, separate from publishing. And it is
-- SMS ONLY, on her instruction: "we're not emailing. We're doing SMS. It's
-- not going to work yet. Just make it so it looks like it works." So this
-- does NOT call notify(), whose whole point is falling back to email --
-- it queues an SMS row per person directly. Queued rows sit until the SMS
-- provider is wired (H6), at which point they actually go; nothing is
-- fabricated, the queue is simply ahead of its provider. People without a
-- phone number are counted and named, never silently skipped.

create or replace function public.add_worked_hours(
  p_staff uuid, p_hall text, p_date date, p_hours numeric,
  p_category text default 'worked', p_note text default null)
returns jsonb language plpgsql volatile security definer
set search_path = public as $$
declare v_row public.sched_time_entries; v_added boolean;
begin
  if p_hours is null or p_hours <= 0 or p_hours > 16 then
    return jsonb_build_object('ok', false, 'error', 'Hours must be between 0 and 16.');
  end if;
  if p_category not in ('worked','vacation','holiday','sick','pto') then
    return jsonb_build_object('ok', false, 'error', 'Unknown category ' || p_category);
  end if;

  insert into public.sched_time_entries
    (staff_id, hall_id, work_date, hours_worked, is_worked_time, category, note)
  values (p_staff, p_hall, p_date, p_hours, p_category = 'worked', p_category, p_note)
  on conflict (staff_id, work_date, hall_id) where assignment_id is null
  do update set
    hours_worked = coalesce(public.sched_time_entries.hours_worked, 0) + excluded.hours_worked,
    note = case when excluded.note is null then public.sched_time_entries.note
                else trim(coalesce(public.sched_time_entries.note || ' · ', '') || excluded.note) end,
    updated_at = now()
  returning * into v_row;

  v_added := v_row.created_at = v_row.updated_at;
  return jsonb_build_object('ok', true, 'id', v_row.id,
    'total_hours', v_row.hours_worked, 'merged', not v_added,
    'category', v_row.category);
end $$;

-- The message people get. Deliberately its own template rather than reusing
-- 'booked', so Rachel can reword a re-send without changing what publishing
-- says. on conflict do nothing: an edit she makes later must survive
-- re-running this file.
insert into public.sched_message_templates (key, subject, body) values
  ($tpl$schedule_blast$tpl$, $tpl$Your shifts for {{dates}}$tpl$,
   $tpl$Hi {{name}} — your schedule for {{dates}} is ready ({{count}}).

Tap to see your shifts and confirm:

{{link}}$tpl$)
on conflict (key) do nothing;

create or replace function public.schedule_blast(
  p_period uuid, p_only_unconfirmed boolean default false)
returns jsonb language plpgsql volatile security definer
set search_path = public as $$
declare
  v_p public.sched_periods; v_t public.sched_message_templates;
  r record; v_tok text; v_link text; v_vars jsonb;
  v_sent int := 0; v_no_phone text[] := '{}';
begin
  select * into v_p from public.sched_periods where id = p_period;
  if v_p.id is null then
    return jsonb_build_object('ok', false, 'error', 'No such fortnight.');
  end if;
  select * into v_t from public.sched_message_templates where key = 'schedule_blast';

  for r in
    select a.staff_id, st.name, st.first_name, st.phone,
           count(*) as shifts,
           count(*) filter (where a.response = 'yes') as confirmed
      from public.sched_assignments a
      join public.sched_sessions s on s.id = a.session_id
      join public.sched_staff st on st.id = a.staff_id
     where a.staff_id is not null
       and s.session_date between v_p.starts_on and v_p.ends_on
     group by a.staff_id, st.name, st.first_name, st.phone
  loop
    -- "Only people who have not confirmed" means not confirmed ALL of their
    -- shifts -- someone who said yes to three of five still needs the nudge.
    if p_only_unconfirmed and r.confirmed >= r.shifts then continue; end if;

    if r.phone is null or r.phone = '' then
      v_no_phone := v_no_phone || r.name;
      continue;
    end if;

    select token into v_tok from public.sched_staff_tokens
     where staff_id = r.staff_id and revoked_at is null;
    if v_tok is null then
      v_tok := public.sched_new_token();
      insert into public.sched_staff_tokens (staff_id, token) values (r.staff_id, v_tok)
      on conflict (staff_id) do update set token = excluded.token, revoked_at = null;
    end if;
    v_link := coalesce((select value #>> '{}' from public.settings where key = 'worker_link_base'),
                       'https://vanguard.bingobuyin.com/sched/me.html') || '?t=' || v_tok;

    v_vars := jsonb_build_object(
      'name', coalesce(r.first_name, r.name), 'link', v_link,
      'dates', to_char(v_p.starts_on, 'Mon FMDD') || ' – ' || to_char(v_p.ends_on, 'Mon FMDD'),
      'count', r.shifts || ' shift' || case when r.shifts = 1 then '' else 's' end);

    insert into public.sched_messages
      (staff_id, template, channel, to_addr, subject, body, status, context)
    values (r.staff_id, 'schedule_blast', 'sms', r.phone,
            public.sched_render(coalesce(v_t.subject, ''), v_vars),
            public.sched_render(v_t.body, v_vars),
            'queued', v_vars);
    v_sent := v_sent + 1;
  end loop;

  return jsonb_build_object('ok', true, 'texted', v_sent,
    'no_phone', to_jsonb(v_no_phone),
    'dates', to_char(v_p.starts_on, 'Mon FMDD') || ' – ' || to_char(v_p.ends_on, 'Mon FMDD'));
end $$;

revoke all on function public.add_worked_hours(uuid, text, date, numeric, text, text) from public, anon;
revoke all on function public.schedule_blast(uuid, boolean) from public, anon;
grant execute on function public.add_worked_hours(uuid, text, date, numeric, text, text) to authenticated;
grant execute on function public.schedule_blast(uuid, boolean) to authenticated;
