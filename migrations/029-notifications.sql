-- 029 — Telling people things.
--
-- One place decides, renders and records every message the system sends. Not
-- three places that drifted apart; one.
--
-- THE CALLING CODE NEVER NAMES A CHANNEL. Publishing a fortnight says "tell
-- these people", not "text these people". Nothing above this file knows whether
-- a message left as an SMS or an email, and nothing above it should — that is
-- what makes turning SMS on later a switch rather than a rewrite.
--
-- notify() picks: SMS if we hold a number, email if we hold an address, never
-- both. Somebody with neither is written down as UNREACHABLE, not silently
-- skipped. That distinction is the point of this file. 42 of 67 staff currently
-- have no contact detail on record, and a send that quietly reaches a third of
-- the workforce while reporting success is worse than one that says plainly how
-- many it could not reach — the manager can go and get a phone number, but only
-- if she is told one is missing.
--
-- Templates live in the database, so fixing a wording mistake is an update
-- statement rather than a rebuild and a redeploy. sched_render does {{name}}
-- substitution and nothing cleverer.
--
-- Nothing here talks to a provider. notify() writes a queued row; something
-- outside drains it with messages_pending() and reports back with
-- message_settled().

create table if not exists public.sched_message_templates (
  key        text primary key,
  subject    text,
  body       text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.sched_messages (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid references public.sched_staff(id) on delete set null,
  template    text not null,
  channel     text not null check (channel in ('sms','email','none')),
  to_addr     text,
  subject     text,
  body        text not null,
  status      text not null default 'queued'
              check (status in ('queued','sent','failed','unreachable')),
  provider_id text,
  error       text,
  context     jsonb,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);

create index if not exists sched_messages_staff on public.sched_messages (staff_id, created_at desc);
create index if not exists sched_messages_status on public.sched_messages (status);

alter table public.sched_message_templates enable row level security;
drop policy if exists sched_message_templates_rw on public.sched_message_templates;
create policy sched_message_templates_rw on public.sched_message_templates
  for all to authenticated using (true) with check (true);

alter table public.sched_messages enable row level security;
drop policy if exists sched_messages_rw on public.sched_messages;
create policy sched_messages_rw on public.sched_messages
  for all to authenticated using (true) with check (true);

-- The six messages this system can send, exactly as they read on a phone.
insert into public.sched_message_templates (key, subject, body) values
  ($tpl$availability$tpl$, $tpl$Can you work these two weeks?$tpl$, $tpl$Hi {{name}} — we need your availability for {{dates}}.

Everything starts as available; just turn off the days you cannot work:

{{link}}

It takes about ten seconds.$tpl$),
  ($tpl$booked$tpl$, $tpl$Your shifts for {{dates}}$tpl$, $tpl$Hi {{name}} — the schedule for {{dates}} is out and you are on it for {{count}}.

See them, and let us know you have got them:

{{link}}$tpl$),
  ($tpl$handoff_ask$tpl$, $tpl$Can you cover a shift?$tpl$, $tpl$Hi {{name}} — {{from}} has asked if you can take their shift on {{when}}.

Say yes or no here:

{{link}}$tpl$),
  ($tpl$handoff_declined$tpl$, $tpl$They cannot cover that shift$tpl$, $tpl$Hi {{name}} — {{from}} cannot take your shift on {{when}}, so it is still yours.

You can ask somebody else here:

{{link}}$tpl$),
  ($tpl$handoff_taken$tpl$, $tpl$You are covering a shift$tpl$, $tpl$Hi {{name}} — you are now on {{when}}, covering for {{from}}. It is in your shifts:

{{link}}$tpl$),
  ($tpl$welcome$tpl$, $tpl$Your shifts at Frontier Bingo$tpl$, $tpl$Hi {{name}} — this is your personal link for shifts, availability and picking your character:

{{link}}

Keep it: it is yours and it does not expire.$tpl$)
on conflict (key) do nothing;

-- Where a worker's personal link points. A setting, not a constant, because the
-- day the domain changes nobody should have to find it inside a function body.
insert into public.settings (key, value)
values ('worker_link_base', to_jsonb('https://vanguard.bingobuyin.com/sched/me.html'::text))
on conflict (key) do nothing;

CREATE OR REPLACE FUNCTION public.sched_render(p_body text, p_vars jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare k text; out text := p_body;
begin
  for k in select jsonb_object_keys(p_vars) loop
    out := replace(out, '{{' || k || '}}', coalesce(p_vars ->> k, ''));
  end loop;
  return out;
end $function$;

CREATE OR REPLACE FUNCTION public.notify(p_staff uuid, p_template text, p_vars jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_s public.sched_staff; v_t public.sched_message_templates;
  v_ch text; v_to text; v_vars jsonb; v_link text; v_id uuid; v_tok text;
begin
  select * into v_s from public.sched_staff where id = p_staff;
  if v_s.id is null then
    return jsonb_build_object('ok', false, 'error', 'No such person.');
  end if;
  select * into v_t from public.sched_message_templates where key = p_template;
  if v_t.key is null then
    return jsonb_build_object('ok', false, 'error', 'No template called ' || p_template);
  end if;

  -- Their own link, minted if they have never had one.
  select token into v_tok from public.sched_staff_tokens
   where staff_id = p_staff and revoked_at is null;
  if v_tok is null then
    v_tok := public.sched_new_token();
    insert into public.sched_staff_tokens (staff_id, token) values (p_staff, v_tok)
    on conflict (staff_id) do update set token = excluded.token, revoked_at = null;
  end if;
  v_link := coalesce((select value #>> '{}' from public.settings where key = 'worker_link_base'),
                     'https://vanguard.bingobuyin.com/sched/me.html')
            || '?t=' || v_tok;

  v_vars := p_vars
    || jsonb_build_object('name', coalesce(v_s.first_name, v_s.name), 'link', v_link);

  -- SMS if we have a number, email if we have an address, never both.
  if v_s.phone is not null and v_s.phone <> '' then
    v_ch := 'sms';   v_to := v_s.phone;
  elsif v_s.email is not null and v_s.email <> '' then
    v_ch := 'email'; v_to := v_s.email;
  else
    v_ch := 'none';  v_to := null;
  end if;

  insert into public.sched_messages
    (staff_id, template, channel, to_addr, subject, body, status, context)
  values (p_staff, p_template, v_ch, v_to,
          public.sched_render(coalesce(v_t.subject,''), v_vars),
          public.sched_render(v_t.body, v_vars),
          case when v_ch = 'none' then 'unreachable' else 'queued' end,
          v_vars)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'channel', v_ch,
    'unreachable', v_ch = 'none');
end $function$;

CREATE OR REPLACE FUNCTION public.messages_pending(p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id, 'channel', m.channel, 'to', m.to_addr,
    'subject', m.subject, 'body', m.body) order by m.created_at), '[]'::jsonb)
  from public.sched_messages m
  where m.status = 'queued'
  limit p_limit;
$function$;

CREATE OR REPLACE FUNCTION public.message_settled(p_id uuid, p_ok boolean, p_provider text DEFAULT NULL::text, p_error text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.sched_messages
     set status = case when p_ok then 'sent' else 'failed' end,
         provider_id = p_provider, error = p_error,
         sent_at = case when p_ok then now() end
   where id = p_id;
  return jsonb_build_object('ok', found);
end $function$;

revoke all on function public.sched_render(text, jsonb) from public, anon;
revoke all on function public.notify(uuid, text, jsonb) from public, anon;
revoke all on function public.messages_pending(integer) from public, anon;
revoke all on function public.message_settled(uuid, boolean, text, text) from public, anon;

grant execute on function public.sched_render(text, jsonb) to authenticated;
grant execute on function public.notify(uuid, text, jsonb) to authenticated;
grant execute on function public.messages_pending(integer) to authenticated;
grant execute on function public.message_settled(uuid, boolean, text, text) to authenticated;
