-- 026 — What the worker is owed: hours, and the fortnight they fall in.
--
-- PAY PERIODS ARE FOURTEEN DAYS, not the 1st-to-15th. They run from a Monday
-- anchor held in the `settings` table under the key `pay_period_anchor`, so the
-- boundary moves by editing one row rather than by editing this function.
--
-- worker_hours RETURNS RAW DAILY HOURS. It deliberately does not compute
-- overtime. Overtime is classified by sched/js/ca-overtime.js, which is tested
-- against the actual California rules; a second implementation in SQL would
-- mean two versions of wage law, and they would drift apart.

insert into public.settings (key, value) values ('pay_period_anchor', to_jsonb('2026-08-03'::text)) on conflict (key) do nothing;

CREATE OR REPLACE FUNCTION public.pay_period_for(p_date date DEFAULT CURRENT_DATE)
 RETURNS TABLE(starts_on date, ends_on date, idx integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with a as (
    select coalesce((select (value #>> '{}')::date from public.settings
                      where key = 'pay_period_anchor'), '2026-08-03'::date) as anchor
  ),
  i as (select floor((p_date - anchor)::numeric / 14)::int as n, anchor from a)
  select (anchor + n * 14)::date, (anchor + n * 14 + 13)::date, n from i;
$function$;

CREATE OR REPLACE FUNCTION public.worker_hours(p_token text, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_staff uuid; v_start date; v_end date;
begin
  v_staff := public.sched_token_staff(p_token);
  if v_staff is null then
    return jsonb_build_object('ok', false, 'error', 'This link is not valid any more.');
  end if;

  select starts_on + (p_offset * 14), ends_on + (p_offset * 14)
    into v_start, v_end from public.pay_period_for(current_date);

  return jsonb_build_object('ok', true,
    'start', v_start, 'end', v_end, 'offset', p_offset,
    -- One row per day worked. The page runs classifyWorkweek() over these.
    'days', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', t.work_date,
        'hours', round(coalesce(t.hours_worked, 0)::numeric, 2),
        'worked', coalesce(t.is_worked_time, true),
        'meal_premium', coalesce(t.meal_premium_owed, false),
        'rest_premium', coalesce(t.rest_premium_owed, false)) order by t.work_date)
      from public.sched_time_entries t
      where t.staff_id = v_staff and t.work_date between v_start and v_end
    ), '[]'::jsonb),
    'commission', coalesce((
      select round(sum(p.amount)::numeric, 2) from public.sched_commission_payouts p
       join public.sched_sessions s on s.id = p.session_id
      where p.staff_id = v_staff and s.session_date between v_start and v_end), 0),
    'shifts', coalesce((
      select count(*) from public.sched_time_entries t
       where t.staff_id = v_staff and t.work_date between v_start and v_end
         and t.clock_in is not null), 0));
end $function$;

revoke all on function public.worker_hours(text, int) from public;
grant execute on function public.worker_hours(text, int) to anon, authenticated;
grant execute on function public.pay_period_for(date) to anon, authenticated;
