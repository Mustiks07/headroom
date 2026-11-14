-- Round 5 (Claude 3): durable AI spend budget for ALL AI endpoints and anonymous aggregate analytics.
-- Apply after 001–004. Not applied to the live project by Claude 3 (Codex applies migrations).
-- Only the server (secret key / service_role) can call these functions; no client policies exist.

-- 1. Spend per day and scope (global / guest / hashed IP), in micro-USD.
create table public.ai_spend (
  day date not null,
  scope text not null check (scope in ('global', 'guest', 'ip')),
  key text not null,
  reserved_microusd bigint not null default 0 check (reserved_microusd >= 0),
  spent_microusd bigint not null default 0 check (spent_microusd >= 0),
  calls integer not null default 0 check (calls >= 0),
  primary key (day, scope, key)
);

-- One row per provider call: reserved before the call, settled with actual token usage after it.
-- Unsettled rows (crashed function) keep their reservation for the day: fail-safe, never cheaper.
create table public.ai_reservations (
  id uuid primary key default gen_random_uuid(),
  day date not null,
  guest_key text not null,
  ip_key text not null,
  feature text not null check (feature in ('extraction', 'proposal', 'explanation')),
  model text not null,
  reserved_microusd bigint not null check (reserved_microusd >= 0),
  actual_microusd bigint,
  input_tokens integer,
  output_tokens integer,
  outcome text,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index ai_reservations_day_idx on public.ai_reservations(day, feature);

alter table public.ai_spend enable row level security;
alter table public.ai_reservations enable row level security;
revoke all on public.ai_spend, public.ai_reservations from anon, authenticated;

create or replace function public.headroom_reserve_ai_spend(
  p_guest text, p_ip text, p_feature text, p_model text, p_reserve bigint,
  p_global_limit bigint, p_guest_limit bigint, p_ip_limit bigint)
returns table (reservation_id uuid, outcome text) language plpgsql security definer set search_path = '' as $$
declare
  d date := (now() at time zone 'utc')::date;
  g bigint; u bigint; i bigint; rid uuid;
begin
  insert into public.ai_spend(day, scope, key) values (d, 'global', 'all'), (d, 'guest', p_guest), (d, 'ip', p_ip) on conflict do nothing;
  -- Fixed lock order avoids deadlocks between concurrent requests.
  select reserved_microusd + spent_microusd into g from public.ai_spend where day = d and scope = 'global' and key = 'all' for update;
  select reserved_microusd + spent_microusd into u from public.ai_spend where day = d and scope = 'guest' and key = p_guest for update;
  select reserved_microusd + spent_microusd into i from public.ai_spend where day = d and scope = 'ip' and key = p_ip for update;
  if g + p_reserve > p_global_limit then return query select null::uuid, 'global_budget'; return; end if;
  if u + p_reserve > p_guest_limit then return query select null::uuid, 'guest_budget'; return; end if;
  if i + p_reserve > p_ip_limit then return query select null::uuid, 'ip_budget'; return; end if;
  update public.ai_spend set reserved_microusd = reserved_microusd + p_reserve, calls = calls + 1
    where day = d and ((scope = 'global' and key = 'all') or (scope = 'guest' and key = p_guest) or (scope = 'ip' and key = p_ip));
  insert into public.ai_reservations(day, guest_key, ip_key, feature, model, reserved_microusd)
    values (d, p_guest, p_ip, p_feature, p_model, p_reserve) returning id into rid;
  return query select rid, 'ok';
end $$;

-- Idempotent: a reservation is settled once; later calls are no-ops.
create or replace function public.headroom_settle_ai_spend(
  p_reservation uuid, p_actual bigint, p_input integer, p_output integer, p_outcome text)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.ai_reservations%rowtype;
begin
  select * into r from public.ai_reservations where id = p_reservation for update;
  if not found or r.settled_at is not null then return; end if;
  update public.ai_spend set reserved_microusd = greatest(0, reserved_microusd - r.reserved_microusd), spent_microusd = spent_microusd + greatest(0, p_actual)
    where day = r.day and ((scope = 'global' and key = 'all') or (scope = 'guest' and key = r.guest_key) or (scope = 'ip' and key = r.ip_key));
  update public.ai_reservations set actual_microusd = greatest(0, p_actual), input_tokens = p_input, output_tokens = p_output,
    outcome = left(p_outcome, 40), settled_at = now() where id = p_reservation;
end $$;

revoke all on function public.headroom_reserve_ai_spend(text, text, text, text, bigint, bigint, bigint, bigint) from public, anon, authenticated;
revoke all on function public.headroom_settle_ai_spend(uuid, bigint, integer, integer, text) from public, anon, authenticated;
grant execute on function public.headroom_reserve_ai_spend(text, text, text, text, bigint, bigint, bigint, bigint) to service_role;
grant execute on function public.headroom_settle_ai_spend(uuid, bigint, integer, integer, text) to service_role;

-- 2. Anonymous aggregate product analytics: daily counters only (no ids, text, amounts or documents).
create table public.analytics_daily (
  day date not null,
  event text not null check (length(event) <= 40),
  data_kind text not null check (data_kind in ('sample', 'own', 'unknown')),
  input_path text not null check (input_path in ('document', 'paste', 'manual', 'provider', 'none')),
  count integer not null default 0 check (count >= 0),
  primary key (day, event, data_kind, input_path)
);
alter table public.analytics_daily enable row level security;
revoke all on public.analytics_daily from anon, authenticated;

create or replace function public.headroom_count_event(p_event text, p_data_kind text, p_input_path text)
returns void language sql security definer set search_path = '' as $$
  insert into public.analytics_daily(day, event, data_kind, input_path, count)
  values ((now() at time zone 'utc')::date, p_event, p_data_kind, p_input_path, 1)
  on conflict (day, event, data_kind, input_path) do update set count = public.analytics_daily.count + 1;
$$;
revoke all on function public.headroom_count_event(text, text, text) from public, anon, authenticated;
grant execute on function public.headroom_count_event(text, text, text) to service_role;
