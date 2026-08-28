-- 019 — one permanent personal link per worker, and the fortnightly
--       availability request that is the first thing it serves.
--
-- THE LINK IS THE CREDENTIAL. There is no worker login, and deliberately so:
-- every sched_ table currently grants any authenticated user full read and
-- write, so handing a worker an account would hand them the whole hall's hours
-- and commission. A token read inside a SECURITY DEFINER function opens exactly
-- one keyhole instead. The tables stay closed to anon; only these functions
-- speak for a worker, and each one is scoped to a single staff_id.
--
-- Treat the link like a key. Anyone holding it is that person as far as this
-- system is concerned. revoked_at is the answer to a lost phone.
--
-- AVAILABILITY IS OPT-OUT. Every session in the period starts available and the
-- worker turns days off, so only the OFF rows are stored. The consequence is
-- that an untouched form is indistinguishable from a form that said yes to
-- everything — which is why replied_at is recorded separately and why the
-- manager's "still waiting on" list is not a nicety.

begin;

-- ---------------------------------------------------------------- the link

create table if not exists public.sched_staff_tokens (
  staff_id     uuid primary key references public.sched_staff(id) on delete cascade,
  token        text unique not null,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at   timestamptz
);

alter table public.sched_staff_tokens enable row level security;
-- No policy for anon on purpose. Only SECURITY DEFINER functions read this.
drop policy if exists sched_staff_tokens_rw on public.sched_staff_tokens;
create policy sched_staff_tokens_rw on public.sched_staff_tokens
  for all to authenticated using (true) with check (true);

-- 16 random bytes, url-safe. Long enough that guessing is not a strategy.
create or replace function public.sched_new_token()
returns text language sql volatile
set search_path = public, extensions as $$
  select replace(replace(replace(
           encode(gen_random_bytes(16), 'base64'), '+', '-'), '/', '_'), '=', '');
$$;

-- ------------------------------------------------------- the request itself

create table if not exists public.sched_availability_requests (
  id            uuid primary key default gen_random_uuid(),
  period_start  date not null,
  period_end    date not null,
  critical_cap  integer not null default 2
                check (critical_cap >= 0),
  note          text,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz,
  closed_at     timestamptz,
  check (period_end >= period_start)
);

-- One row per person asked. replied_at is the whole point: with an opt-out
-- form, silence and "I am free for everything" produce identical answers.
create table if not exists public.sched_availability_replies (
  request_id   uuid not null references public.sched_availability_requests(id) on delete cascade,
  staff_id     uuid not null references public.sched_staff(id) on delete cascade,
  is_critical  boolean not null default false,
  replied_at   timestamptz,
  note         text,
  needs_review boolean not null default false,
  reviewed_at  timestamptz,
  primary key (request_id, staff_id)
);

-- Only the declines are stored. Available is the absence of a row.
create table if not exists public.sched_availability_off (
  request_id   uuid not null references public.sched_availability_requests(id) on delete cascade,
  staff_id     uuid not null references public.sched_staff(id) on delete cascade,
  session_date date not null,
  part         text not null,
  created_at   timestamptz not null default now(),
  primary key (request_id, staff_id, session_date, part)
);

create index if not exists sched_avail_off_staff on public.sched_availability_off(staff_id, session_date);

do $$ begin
  execute 'alter table public.sched_availability_requests enable row level security';
  execute 'alter table public.sched_availability_replies  enable row level security';
  execute 'alter table public.sched_availability_off      enable row level security';
end $$;

drop policy if exists sched_avail_req_rw on public.sched_availability_requests;
create policy sched_avail_req_rw on public.sched_availability_requests
  for all to authenticated using (true) with check (true);
drop policy if exists sched_avail_rep_rw on public.sched_availability_replies;
create policy sched_avail_rep_rw on public.sched_availability_replies
  for all to authenticated using (true) with check (true);
drop policy if exists sched_avail_off_rw on public.sched_availability_off;
create policy sched_avail_off_rw on public.sched_availability_off
  for all to authenticated using (true) with check (true);

-- ------------------------------------------------------- who counts as critical
--
-- Anyone qualified for a role other than the universal floor-runner one.
-- Derived rather than flagged, so it cannot drift out of step with the
-- capability matrix Rachel actually maintains.
create or replace function public.sched_is_critical(p_staff uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.sched_staff_role_capability c
    join public.sched_roles r on r.id = c.role_id
    where c.staff_id = p_staff
      and r.name <> 'Flash Runners'
      and (c.can_do or c.is_deputy));
$$;

commit;
-- Defence in depth. RLS already blocks anon (no policy names them), but this
-- table holds the credentials themselves, so it should not also be one
-- accidental permissive policy away from exposure. Supabase grants SELECT to
-- anon on every new public table by default; take it back here.
revoke all on public.sched_staff_tokens from anon;

-- Resolve a token to a person. Returns null for unknown or revoked tokens.
-- Every worker-facing function goes through this and nothing else.
create or replace function public.sched_token_staff(p_token text)
returns uuid language plpgsql volatile security definer
set search_path = public as $$
declare v_id uuid;
begin
  if p_token is null or length(p_token) < 16 then return null; end if;
  select t.staff_id into v_id
    from public.sched_staff_tokens t
    join public.sched_staff s on s.id = t.staff_id
   where t.token = p_token and t.revoked_at is null and s.active;
  if v_id is not null then
    update public.sched_staff_tokens set last_seen_at = now() where staff_id = v_id;
  end if;
  return v_id;
end $$;

-- Everything one worker's page needs, for one worker, in a single call.
-- Scoped hard to the token's own staff_id: there is no parameter here that
-- could widen it to somebody else's data.
create or replace function public.worker_home(p_token text)
returns jsonb language plpgsql stable security definer
set search_path = public as $$
declare
  v_staff uuid; v_req public.sched_availability_requests; v_crit boolean;
begin
  v_staff := public.sched_token_staff(p_token);
  if v_staff is null then
    return jsonb_build_object('ok', false, 'error', 'This link is not valid any more.');
  end if;

  select * into v_req from public.sched_availability_requests
   where sent_at is not null and closed_at is null
   order by period_start desc limit 1;

  v_crit := public.sched_is_critical(v_staff);

  return jsonb_build_object(
    'ok', true,
    'me', (select jsonb_build_object('id', s.id, 'name', s.name,
             'first_name', s.first_name, 'pet', s.pet, 'critical', v_crit)
             from public.sched_staff s where s.id = v_staff),
    'request', case when v_req.id is null then null else jsonb_build_object(
        'id', v_req.id, 'start', v_req.period_start, 'end', v_req.period_end,
        'cap', v_req.critical_cap, 'note', v_req.note,
        'replied_at', (select r.replied_at from public.sched_availability_replies r
                        where r.request_id = v_req.id and r.staff_id = v_staff),
        'my_note', (select r.note from public.sched_availability_replies r
                     where r.request_id = v_req.id and r.staff_id = v_staff),
        'sessions', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'date', s.session_date, 'part', s.part, 'hall', s.hall_id,
                   'off', exists (select 1 from public.sched_availability_off o
                                   where o.request_id = v_req.id and o.staff_id = v_staff
                                     and o.session_date = s.session_date and o.part = s.part))
                 order by s.session_date, s.part)
          from public.sched_sessions s
          where s.session_date between v_req.period_start and v_req.period_end),
          '[]'::jsonb))
    end);
end $$;

-- Turn one session off or back on. Availability is the ABSENCE of a row, so
-- "available" deletes and "unavailable" inserts.
create or replace function public.worker_availability_set(
  p_token text, p_date date, p_part text, p_available boolean)
returns jsonb language plpgsql volatile security definer
set search_path = public as $$
declare v_staff uuid; v_req uuid; v_days int; v_cap int; v_crit boolean;
begin
  v_staff := public.sched_token_staff(p_token);
  if v_staff is null then
    return jsonb_build_object('ok', false, 'error', 'This link is not valid any more.');
  end if;

  select id, critical_cap into v_req, v_cap from public.sched_availability_requests
   where sent_at is not null and closed_at is null
   order by period_start desc limit 1;
  if v_req is null then
    return jsonb_build_object('ok', false, 'error', 'There is no availability request open.');
  end if;

  if not exists (select 1 from public.sched_sessions s
                  where s.session_date = p_date and s.part = p_part) then
    return jsonb_build_object('ok', false, 'error', 'No session on that date.');
  end if;

  if p_available then
    delete from public.sched_availability_off
     where request_id = v_req and staff_id = v_staff
       and session_date = p_date and part = p_part;
  else
    insert into public.sched_availability_off (request_id, staff_id, session_date, part)
    values (v_req, v_staff, p_date, p_part) on conflict do nothing;
  end if;

  -- The cap is reported, never enforced. Somebody with jury duty on a third
  -- day still has jury duty, and a form that refuses the answer produces a
  -- no-show instead of a decline.
  v_crit := public.sched_is_critical(v_staff);
  select count(distinct session_date) into v_days
    from public.sched_availability_off
   where request_id = v_req and staff_id = v_staff;

  update public.sched_availability_replies
     set needs_review = (v_crit and v_days > v_cap)
   where request_id = v_req and staff_id = v_staff;

  return jsonb_build_object('ok', true, 'days_off', v_days,
    'critical', v_crit, 'cap', case when v_crit then v_cap end,
    'days_left', case when v_crit then greatest(0, v_cap - v_days) end,
    'needs_review', v_crit and v_days > v_cap);
end $$;

-- "I'm done." The only thing that distinguishes a considered yes-to-everything
-- from a form nobody opened.
create or replace function public.worker_availability_submit(p_token text, p_note text default null)
returns jsonb language plpgsql volatile security definer
set search_path = public as $$
declare v_staff uuid; v_req uuid; v_cap int; v_days int; v_crit boolean;
begin
  v_staff := public.sched_token_staff(p_token);
  if v_staff is null then
    return jsonb_build_object('ok', false, 'error', 'This link is not valid any more.');
  end if;
  select id, critical_cap into v_req, v_cap from public.sched_availability_requests
   where sent_at is not null and closed_at is null order by period_start desc limit 1;
  if v_req is null then
    return jsonb_build_object('ok', false, 'error', 'There is no availability request open.');
  end if;

  v_crit := public.sched_is_critical(v_staff);
  select count(distinct session_date) into v_days
    from public.sched_availability_off where request_id = v_req and staff_id = v_staff;

  insert into public.sched_availability_replies
    (request_id, staff_id, is_critical, replied_at, note, needs_review)
  values (v_req, v_staff, v_crit, now(), nullif(trim(coalesce(p_note,'')),''),
          v_crit and v_days > v_cap)
  on conflict (request_id, staff_id) do update
    set replied_at = now(), note = excluded.note,
        is_critical = excluded.is_critical, needs_review = excluded.needs_review;

  return jsonb_build_object('ok', true, 'days_off', v_days,
    'needs_review', v_crit and v_days > v_cap);
end $$;

revoke all on function public.worker_home(text) from public;
revoke all on function public.worker_availability_set(text, date, text, boolean) from public;
revoke all on function public.worker_availability_submit(text, text) from public;
grant execute on function public.worker_home(text) to anon, authenticated;
grant execute on function public.worker_availability_set(text, date, text, boolean) to anon, authenticated;
grant execute on function public.worker_availability_submit(text, text) to anon, authenticated;
-- sched_token_staff is internal plumbing; nobody calls it directly.
revoke all on function public.sched_token_staff(text) from public, anon;
-- Manager side of the availability request, plus the thing the smoke test
-- exposed: sessions are only materialised 14 days out, so a request for the
-- fortnight AFTER next would silently cover half the days it claimed to.
-- Creating a request now guarantees its own period exists first.

create or replace function public.availability_request_create(
  p_start date, p_end date, p_cap int default 2, p_note text default null,
  p_send boolean default true)
returns jsonb language plpgsql volatile security definer
set search_path = public as $$
declare v_id uuid; v_asked int; v_sessions int; v_days int;
begin
  if p_end < p_start then
    return jsonb_build_object('ok', false, 'error', 'The period ends before it starts.');
  end if;
  v_days := (p_end - current_date) + 1;
  if v_days > 120 then
    return jsonb_build_object('ok', false, 'error', 'That period is more than 120 days out.');
  end if;

  -- Materialise far enough ahead that every day in the period has its sessions.
  -- Without this a request can quietly cover fewer nights than it says.
  if v_days > 0 then perform public.ensure_upcoming_sessions(greatest(v_days, 14)); end if;

  select count(*) into v_sessions from public.sched_sessions
   where session_date between p_start and p_end;
  if v_sessions = 0 then
    return jsonb_build_object('ok', false,
      'error', 'No sessions fall in that period — check the dates.');
  end if;

  insert into public.sched_availability_requests
    (period_start, period_end, critical_cap, note, sent_at)
  values (p_start, p_end, p_cap, nullif(trim(coalesce(p_note,'')),''),
          case when p_send then now() end)
  returning id into v_id;

  -- Everyone active is asked. A reply row per person from the outset is what
  -- makes "still waiting on" answerable: with an opt-out form, no row and a
  -- form full of yeses look identical, so absence has to be recorded up front.
  insert into public.sched_availability_replies (request_id, staff_id, is_critical)
  select v_id, s.id, public.sched_is_critical(s.id)
    from public.sched_staff s where s.active;
  get diagnostics v_asked = row_count;

  -- Anyone without a link cannot answer. Mint one rather than leave a hole.
  insert into public.sched_staff_tokens (staff_id, token)
  select s.id, public.sched_new_token() from public.sched_staff s
   where s.active and not exists (
     select 1 from public.sched_staff_tokens t where t.staff_id = s.id)
  on conflict (staff_id) do nothing;

  return jsonb_build_object('ok', true, 'id', v_id, 'asked', v_asked,
    'sessions', v_sessions, 'days', (p_end - p_start) + 1);
end $$;

-- What Rachel looks at: who has answered, who has not, and who wants more
-- than their two days.
create or replace function public.availability_status(p_request uuid default null)
returns jsonb language plpgsql stable security definer
set search_path = public as $$
declare v_req public.sched_availability_requests;
begin
  if p_request is null then
    select * into v_req from public.sched_availability_requests
     where sent_at is not null and closed_at is null
     order by period_start desc limit 1;
  else
    select * into v_req from public.sched_availability_requests where id = p_request;
  end if;
  if v_req.id is null then return jsonb_build_object('ok', false, 'error', 'No request.'); end if;

  return jsonb_build_object('ok', true,
    'request', jsonb_build_object('id', v_req.id, 'start', v_req.period_start,
      'end', v_req.period_end, 'cap', v_req.critical_cap, 'note', v_req.note,
      'sent_at', v_req.sent_at, 'closed_at', v_req.closed_at),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
        'staff_id', s.id, 'name', s.name, 'pet', s.pet,
        'critical', r.is_critical,
        'replied_at', r.replied_at,
        'note', r.note,
        'needs_review', r.needs_review,
        'reviewed_at', r.reviewed_at,
        'token', t.token,
        'days_off', (select count(distinct o.session_date)
                       from public.sched_availability_off o
                      where o.request_id = v_req.id and o.staff_id = s.id),
        'off', coalesce((select jsonb_agg(jsonb_build_object('date', o.session_date, 'part', o.part)
                                 order by o.session_date, o.part)
                    from public.sched_availability_off o
                   where o.request_id = v_req.id and o.staff_id = s.id), '[]'::jsonb))
        order by (r.replied_at is not null), r.is_critical desc, s.name)
      from public.sched_availability_replies r
      join public.sched_staff s on s.id = r.staff_id
      left join public.sched_staff_tokens t on t.staff_id = s.id and t.revoked_at is null
     where r.request_id = v_req.id), '[]'::jsonb));
end $$;

-- Rachel accepting a third day off. Records that a human looked.
create or replace function public.availability_review(p_request uuid, p_staff uuid)
returns jsonb language plpgsql volatile security definer
set search_path = public as $$
begin
  update public.sched_availability_replies
     set reviewed_at = now()
   where request_id = p_request and staff_id = p_staff;
  return jsonb_build_object('ok', found);
end $$;

-- A lost phone, or somebody who left.
create or replace function public.staff_link_reset(p_staff uuid, p_revoke boolean default false)
returns jsonb language plpgsql volatile security definer
set search_path = public as $$
declare v_tok text;
begin
  if p_revoke then
    update public.sched_staff_tokens set revoked_at = now() where staff_id = p_staff;
    return jsonb_build_object('ok', true, 'revoked', true);
  end if;
  v_tok := public.sched_new_token();
  insert into public.sched_staff_tokens (staff_id, token) values (p_staff, v_tok)
  on conflict (staff_id) do update set token = v_tok, revoked_at = null, created_at = now();
  return jsonb_build_object('ok', true, 'token', v_tok);
end $$;

revoke all on function public.availability_request_create(date, date, int, text, boolean) from public, anon;
revoke all on function public.availability_status(uuid) from public, anon;
revoke all on function public.availability_review(uuid, uuid) from public, anon;
revoke all on function public.staff_link_reset(uuid, boolean) from public, anon;
grant execute on function public.availability_request_create(date, date, int, text, boolean) to authenticated;
grant execute on function public.availability_status(uuid) to authenticated;
grant execute on function public.availability_review(uuid, uuid) to authenticated;
grant execute on function public.staff_link_reset(uuid, boolean) to authenticated;
