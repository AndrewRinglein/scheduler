-- Exported verbatim from Supabase (supabase_migrations.schema_migrations).
-- Migration name: scheduler_010_sales_input_and_staff_flags
-- Version:        20260810080012

-- Scheduler 010 — sales is the input; RPA is derived.
--
-- RPA = total sales / attendance. Storing actual_rpa as a typed figure meant
-- two sources of truth for the same fact and no way to check one against the
-- other. Sales and attendance are what someone actually counts at the end of a
-- session, so those are what get entered.
--
-- actual_rpa stays as a generated column so every existing query, index and
-- the whole commission calculation keep working untouched.
--
-- Historical rows have actual_rpa but no sales. Rather than discard the RPA we
-- already trust, sales is back-filled from it: sales = rpa * attendance. That
-- is exact, not an estimate — it is the same division run backwards.

alter table public.sched_sessions add column if not exists total_sales numeric(12,2);

update public.sched_sessions
set total_sales = round(actual_rpa * attendance, 2)
where total_sales is null and actual_rpa is not null and attendance is not null;

-- Swap actual_rpa for a generated column derived from sales and attendance.
alter table public.sched_sessions rename column actual_rpa to actual_rpa_legacy;

alter table public.sched_sessions
  add column actual_rpa numeric(10,2)
  generated always as (
    case when attendance is not null and attendance > 0 and total_sales is not null
         then round(total_sales / attendance, 2) end
  ) stored;

-- Prove the generated column reproduces what was there before dropping it.
do $$
declare bad int;
begin
  select count(*) into bad from public.sched_sessions
   where actual_rpa_legacy is not null
     and (actual_rpa is null or abs(actual_rpa - actual_rpa_legacy) > 0.01);
  if bad > 0 then
    raise exception 'derived actual_rpa differs from the stored value on % row(s) — not dropping the original', bad;
  end if;
end $$;

alter table public.sched_sessions drop column actual_rpa_legacy;

-- Staff activation is already a boolean; add a note for why someone is off.
alter table public.sched_staff
  add column if not exists deactivated_at timestamptz,
  add column if not exists note text;

select count(*) as sessions,
       count(total_sales) as with_sales,
       count(actual_rpa) as with_rpa
from public.sched_sessions;
