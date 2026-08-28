-- 023 — a schedule is a two-week bundle, not a rolling list of days.
--
-- This is how Rachel actually works: she sits down and builds a fortnight at a
-- time, and that fortnight is the unit she thinks in, publishes, and looks back
-- at. The app has been showing an endless stream of session cards, which is a
-- different object from the thing she is making.
--
-- ALWAYS STARTS ON A MONDAY. Enforced, not hoped for — a period beginning on a
-- Wednesday would split every week in the hall's operating pattern in half and
-- the caller rotation with it.
--
-- Periods MAY NOT OVERLAP. Sessions belong to a period by their date rather
-- than by a foreign key, so an overlap would put a session in two schedules at
-- once with no way to say which is authoritative. An exclusion constraint makes
-- that unrepresentable rather than merely discouraged.

create extension if not exists btree_gist;

create table if not exists public.sched_periods (
  id           uuid primary key default gen_random_uuid(),
  starts_on    date not null,
  ends_on      date generated always as (starts_on + 13) stored,
  label        text,
  status       text not null default 'draft'
               check (status in ('draft','published','archived')),
  note         text,
  created_at   timestamptz not null default now(),
  published_at timestamptz,
  constraint sched_periods_starts_monday
    check (extract(isodow from starts_on) = 1),
  constraint sched_periods_no_overlap
    exclude using gist (daterange(starts_on, starts_on + 14, '[)') with &&)
);

comment on table public.sched_periods is
  'A fortnight of scheduling, Monday to the Sunday thirteen days later. The '
  'unit Rachel builds, publishes and looks back at. Sessions belong to one by '
  'date; periods may not overlap, so that mapping is never ambiguous.';

alter table public.sched_periods enable row level security;
drop policy if exists sched_periods_rw on public.sched_periods;
create policy sched_periods_rw on public.sched_periods
  for all to authenticated using (true) with check (true);

-- The Monday on or before a date. Every period boundary derives from this, so
-- "which fortnight is today in" has exactly one answer.
create or replace function public.sched_monday_of(p_date date)
returns date language sql immutable set search_path = public as $$
  select p_date - (extract(isodow from p_date)::int - 1);
$$;

-- Create the fortnight containing a date, or return the one already there.
-- Materialises its sessions too: a period whose second week has no session
-- rows yet would show Rachel half a schedule and no hint why.
create or replace function public.schedule_period_ensure(p_any_date date default current_date)
returns jsonb language plpgsql volatile security definer
set search_path = public as $$
declare v_start date; v_id uuid; v_days int; v_sessions int;
begin
  v_start := public.sched_monday_of(p_any_date);

  select id into v_id from public.sched_periods where starts_on = v_start;
  if v_id is null then
    insert into public.sched_periods (starts_on) values (v_start) returning id into v_id;
  end if;

  v_days := (v_start + 13 - current_date) + 1;
  if v_days > 0 then perform public.ensure_upcoming_sessions(least(greatest(v_days, 14), 120)); end if;

  select count(*) into v_sessions from public.sched_sessions
   where session_date between v_start and v_start + 13;

  return jsonb_build_object('ok', true, 'id', v_id, 'starts_on', v_start,
    'ends_on', v_start + 13, 'sessions', v_sessions);
end $$;

-- Every period with enough about it to draw the picker, newest first.
create or replace function public.schedule_periods(p_limit int default 24)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'starts_on' desc), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', p.id, 'starts_on', p.starts_on, 'ends_on', p.ends_on,
      'label', p.label, 'status', p.status, 'note', p.note,
      'published_at', p.published_at,
      'is_current', current_date between p.starts_on and p.ends_on,
      'sessions', (select count(*) from public.sched_sessions s
                    where s.session_date between p.starts_on and p.ends_on),
      'filled', (select count(*) from public.sched_assignments a
                   join public.sched_sessions s on s.id = a.session_id
                  where a.staff_id is not null
                    and s.session_date between p.starts_on and p.ends_on),
      'slots', (select coalesce(sum(coalesce(sr.needed, n.needed, 0)), 0)
                  from public.sched_sessions s
                  join public.sched_hall_role_needs n
                    on n.hall_id = s.hall_id and n.part = s.part
                   and n.dow = extract(dow from s.session_date)::int
                  left join public.sched_session_roles sr
                    on sr.session_id = s.id and sr.role_id = n.role_id
                 where s.session_date between p.starts_on and p.ends_on)
    ) as x
    from public.sched_periods p
    order by p.starts_on desc limit p_limit) t;
$$;

create or replace function public.schedule_period_set(
  p_id uuid, p_label text default null, p_note text default null,
  p_status text default null)
returns jsonb language plpgsql volatile security definer
set search_path = public as $$
begin
  update public.sched_periods
     set label  = coalesce(nullif(trim(coalesce(p_label,'')),''), label),
         note   = coalesce(nullif(trim(coalesce(p_note,'')),''), note),
         status = coalesce(p_status, status),
         published_at = case when p_status = 'published' and published_at is null
                             then now() else published_at end
   where id = p_id;
  return jsonb_build_object('ok', found);
end $$;

revoke all on function public.schedule_period_ensure(date) from public, anon;
revoke all on function public.schedule_periods(int) from public, anon;
revoke all on function public.schedule_period_set(uuid, text, text, text) from public, anon;
grant execute on function public.schedule_period_ensure(date) to authenticated;
grant execute on function public.schedule_periods(int) to authenticated;
grant execute on function public.schedule_period_set(uuid, text, text, text) to authenticated;
-- Unpublishing must clear the timestamp. Leaving it set meant a period could
-- read status='draft' while still carrying a published_at, and anything that
-- treats "has a published_at" as "is published" would disagree with the status
-- column about the same row.
create or replace function public.schedule_period_set(
  p_id uuid, p_label text default null, p_note text default null,
  p_status text default null)
returns jsonb language plpgsql volatile security definer
set search_path = public as $$
begin
  update public.sched_periods
     set label  = coalesce(nullif(trim(coalesce(p_label,'')),''), label),
         note   = coalesce(nullif(trim(coalesce(p_note,'')),''), note),
         status = coalesce(p_status, status),
         published_at = case
           when coalesce(p_status, status) = 'published'
             then coalesce(published_at, now())
           else null
         end
   where id = p_id;
  return jsonb_build_object('ok', found);
end $$;
