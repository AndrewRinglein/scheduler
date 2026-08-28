-- Exported verbatim from Supabase (supabase_migrations.schema_migrations).
-- Migration name: scheduler_011_materialise_upcoming_sessions
-- Version:        20260810080502

-- Scheduler 011 — keep the next two weeks of sessions materialised as drafts.
--
-- The schedule showed only sessions that already existed as rows, so the two
-- weeks Rachel is actually working on were simply absent until someone created
-- them by hand. This walks each hall's operating days forward and inserts any
-- that are missing, as drafts.
--
-- Idempotent by construction: the unique key on (hall, date, part) means an
-- existing session — draft, planned or deployed — is never touched. It only
-- ever fills gaps, so calling it on every page load is safe.
--
-- Reversible: drop function public.ensure_upcoming_sessions(int);

create or replace function public.ensure_upcoming_sessions(p_days int default 14)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  created integer;
begin
  if p_days < 1 or p_days > 120 then
    raise exception 'p_days must be between 1 and 120, got %', p_days;
  end if;

  with wanted as (
    select d.hall_id,
           gs::date as session_date,
           d.part,
           case when extract(dow from gs) in (0,6) then 'weekend' else 'weekday' end as day_type
    from public.sched_hall_days d
    cross join generate_series(current_date, current_date + (p_days - 1), interval '1 day') as gs
    where d.active
      and extract(dow from gs)::int = d.dow
  ),
  ins as (
    insert into public.sched_sessions (hall_id, session_date, part, day_type, status)
    select w.hall_id, w.session_date, w.part, w.day_type, 'draft'
    from wanted w
    on conflict (hall_id, session_date, part) do nothing
    returning 1
  )
  select count(*) into created from ins;

  return created;
end $$;

comment on function public.ensure_upcoming_sessions(int) is
  'Materialises missing sessions as drafts for the next N days from each hall''s operating pattern. Never modifies an existing session, so it is safe to call on every page load.';

grant execute on function public.ensure_upcoming_sessions(int) to authenticated;

select public.ensure_upcoming_sessions(14) as created;
