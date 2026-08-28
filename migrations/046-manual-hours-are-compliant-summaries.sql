-- 046: a manual hours entry is a summary, not a punch record.
--
-- Angela: "When I just go manually add 2 hours to somebody on a Tuesday, I
-- need to create a shift line item under the shifts that says 'Tuesday,
-- 2 hours', and it needs to correctly roll into the hours for that day."
--
-- It did land in the table, but with the punch-record defaults: meal_taken
-- false, no rests. The compliance checker then read any manual entry over
-- five hours as a MISSED MEAL owing an hour of premium -- a violation nobody
-- committed, invented by a bookkeeping shortcut. A manager typing "8 hours,
-- worked" is recording a day that happened properly; if it had not, she would
-- be entering it through the time clock's punches, not here. So the entry
-- carries the breaks the law requires for its length, marked taken.

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
    (staff_id, hall_id, work_date, hours_worked, is_worked_time, category, note,
     meal_taken, second_meal_taken, rest_breaks_taken)
  values (p_staff, p_hall, p_date, p_hours, p_category = 'worked', p_category, p_note,
     p_hours > 5, p_hours > 10,
     case when p_hours <= 3.5 then 0 when p_hours <= 6 then 1
          when p_hours <= 10 then 2 else 3 end)
  on conflict (staff_id, work_date, hall_id) where assignment_id is null
  do update set
    hours_worked = coalesce(public.sched_time_entries.hours_worked, 0) + excluded.hours_worked,
    meal_taken        = (coalesce(public.sched_time_entries.hours_worked,0) + excluded.hours_worked) > 5,
    second_meal_taken = (coalesce(public.sched_time_entries.hours_worked,0) + excluded.hours_worked) > 10,
    rest_breaks_taken = case
      when (coalesce(public.sched_time_entries.hours_worked,0) + excluded.hours_worked) <= 3.5 then 0
      when (coalesce(public.sched_time_entries.hours_worked,0) + excluded.hours_worked) <= 6 then 1
      when (coalesce(public.sched_time_entries.hours_worked,0) + excluded.hours_worked) <= 10 then 2
      else 3 end,
    note = case when excluded.note is null then public.sched_time_entries.note
                else trim(coalesce(public.sched_time_entries.note || ' · ', '') || excluded.note) end,
    updated_at = now()
  returning * into v_row;

  v_added := v_row.created_at = v_row.updated_at;
  return jsonb_build_object('ok', true, 'id', v_row.id,
    'total_hours', v_row.hours_worked, 'merged', not v_added,
    'category', v_row.category);
end $$;
