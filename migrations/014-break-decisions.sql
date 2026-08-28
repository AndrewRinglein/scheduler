-- Exported verbatim from Supabase (supabase_migrations.schema_migrations).
-- Migration name: scheduler_014_break_decisions
-- Version:        20260811041527

-- Scheduler 014 — postpone and skip decisions.
--
-- The plan itself is NOT stored. It is recomputed from who is clocked in and
-- what has already happened, so it is never stale and there is no second copy
-- to drift. What must be stored is the manager's DECISIONS — postpone this
-- break, skip that one — because those are facts about the night that a page
-- refresh must not forget, and a skipped meal owes a premium hour.
--
-- Reversible: drop table public.sched_break_decisions;

create table if not exists public.sched_break_decisions (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid not null references public.sched_staff(id) on delete cascade,
  hall_id     text not null references public.halls(id) on delete cascade,
  work_date   date not null default current_date,
  kind        text not null check (kind in ('rest','meal')),
  seq         integer not null default 0,          -- 0 = first meal, 1 = second
  decision    text not null check (decision in ('postponed','skipped')),
  -- For a postponement, how much later. For a skip this is null.
  postpone_min integer check (postpone_min is null or postpone_min between 5 and 240),
  reason      text,
  decided_at  timestamptz not null default now(),
  decided_by  uuid references auth.users(id) on delete set null,
  unique (staff_id, work_date, kind, seq)
);

comment on table public.sched_break_decisions is
  'Manager overrides for one night. The break PLAN is recomputed live and never stored; only decisions are, because a skipped meal owes a premium hour and must survive a refresh.';

create index if not exists idx_break_dec_day on public.sched_break_decisions(hall_id, work_date);

alter table public.sched_break_decisions enable row level security;
create policy sched_break_decisions_auth_all on public.sched_break_decisions
  for all to authenticated using (true) with check (true);

-- Everything the board needs for one hall, in one round trip: who is clocked
-- in, when they started, their role and its floor, and what breaks they have
-- already had. The board recomputes the plan from this.
create or replace function public.break_board(p_hall text)
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'now', now(),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
        'staff_id', st.id, 'name', st.name, 'pet', st.pet,
        'role_id', r.id, 'role', r.name,
        'floor', coalesce(n.needed_floor, r.min_on_floor),
        'clock_in', t.clock_in, 'clock_out', t.clock_out,
        'entry_id', t.id,
        'scheduled_end', a.scheduled_end,
        'breaks', coalesce((
          select jsonb_agg(jsonb_build_object('kind', bp.kind,
                   'started_at', bp.started_at, 'ended_at', bp.ended_at)
                 order by bp.started_at)
          from public.sched_break_punches bp where bp.time_entry_id = t.id), '[]'::jsonb)
      ) order by r.sort, st.name)
      from public.sched_time_entries t
      join public.sched_staff st on st.id = t.staff_id
      left join lateral (
        select a2.role_id, a2.scheduled_end
        from public.sched_assignments a2
        join public.sched_sessions s2 on s2.id = a2.session_id
        where a2.staff_id = t.staff_id and s2.session_date = t.work_date and s2.hall_id = t.hall_id
        limit 1) a on true
      left join public.sched_roles r on r.id = a.role_id
      left join lateral (
        select nn.min_on_floor as needed_floor from public.sched_hall_role_needs nn
        where nn.hall_id = t.hall_id and nn.role_id = a.role_id
          and nn.dow = extract(dow from t.work_date)::int limit 1) n on true
      where t.hall_id = p_hall and t.work_date = current_date and t.clock_out is null
    ), '[]'::jsonb),
    'decisions', coalesce((
      select jsonb_agg(jsonb_build_object('staff_id', d.staff_id, 'kind', d.kind,
               'seq', d.seq, 'decision', d.decision, 'postpone_min', d.postpone_min))
      from public.sched_break_decisions d
      where d.hall_id = p_hall and d.work_date = current_date), '[]'::jsonb)
  );
$$;

create or replace function public.break_decide(
  p_staff uuid, p_hall text, p_kind text, p_seq int,
  p_decision text, p_postpone_min int default null, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  insert into public.sched_break_decisions
    (staff_id, hall_id, kind, seq, decision, postpone_min, reason, decided_by)
  values (p_staff, p_hall, p_kind, p_seq, p_decision, p_postpone_min, p_reason, auth.uid())
  on conflict (staff_id, work_date, kind, seq) do update
    set decision = excluded.decision, postpone_min = excluded.postpone_min,
        reason = excluded.reason, decided_at = now(), decided_by = excluded.decided_by;
  return jsonb_build_object('ok', true);
end $$;

-- Undo, because a postpone entered on the wrong person must be reversible
-- without a database console.
create or replace function public.break_undecide(p_staff uuid, p_hall text, p_kind text, p_seq int)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  delete from public.sched_break_decisions
   where staff_id = p_staff and hall_id = p_hall and work_date = current_date
     and kind = p_kind and seq = p_seq;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.break_board(text)                                   from anon;
revoke all on function public.break_decide(uuid,text,text,int,text,int,text)      from anon;
revoke all on function public.break_undecide(uuid,text,text,int)                  from anon;
grant execute on function public.break_board(text)                                to authenticated;
grant execute on function public.break_decide(uuid,text,text,int,text,int,text)   to authenticated;
grant execute on function public.break_undecide(uuid,text,text,int)               to authenticated;

select 'ready' as status;
