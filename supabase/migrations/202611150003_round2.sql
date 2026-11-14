-- Round 2 (Claude 3). Apply after 202611140001_foundation.sql and 202611140002_hardening.sql.
-- Not yet applied to a live project: no Supabase access was available when this was written.

-- 1. New additive plan event kind: recalculated with newer engine/rules.
alter table public.plan_events drop constraint if exists plan_events_kind_check;
alter table public.plan_events add constraint plan_events_kind_check
  check (kind in ('income_changed','coverage_changed','opportunity_changed','action_confirmed','rules_updated'));

-- 2. Earlier plan revisions are kept as history (e.g. before a rules upgrade or an edit).
create table public.plan_revisions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  revision integer not null check (revision > 0),
  payload jsonb not null check (pg_column_size(payload) < 2000000),
  saved_at timestamptz not null default now(),
  unique (plan_id, revision),
  foreign key (plan_id, owner_id) references public.plans(id, owner_id) on delete cascade
);
create index plan_revisions_owner_idx on public.plan_revisions(owner_id, plan_id, revision desc);
alter table public.plan_revisions enable row level security;
create policy plan_revisions_owner_select on public.plan_revisions for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy plan_revisions_owner_insert on public.plan_revisions for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy plan_revisions_owner_delete on public.plan_revisions for delete to authenticated
  using ((select auth.uid()) = owner_id);
grant select, insert, delete on public.plan_revisions to authenticated;
revoke all on public.plan_revisions from anon;

-- 3. Durable daily quota for the paid document-analysis provider. Works across Vercel instances.
-- Only the server (secret key / service_role) can call it; no client policies exist.
create table public.ai_usage (
  day date not null,
  scope text not null check (scope in ('global','user','ip')),
  key text not null,
  count integer not null default 0 check (count >= 0),
  primary key (day, scope, key)
);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;

create or replace function public.headroom_consume_ai_quota(
  p_user text, p_ip text, p_user_limit integer, p_ip_limit integer, p_global_limit integer)
returns text language plpgsql security definer set search_path = '' as $$
declare
  d date := (now() at time zone 'utc')::date;
  g integer; u integer; i integer;
begin
  insert into public.ai_usage(day, scope, key, count)
    values (d, 'global', 'all', 0), (d, 'user', p_user, 0), (d, 'ip', p_ip, 0)
    on conflict do nothing;
  -- Fixed lock order (global, user, ip) avoids deadlocks between concurrent requests.
  select count into g from public.ai_usage where day = d and scope = 'global' and key = 'all' for update;
  select count into u from public.ai_usage where day = d and scope = 'user' and key = p_user for update;
  select count into i from public.ai_usage where day = d and scope = 'ip' and key = p_ip for update;
  if g >= p_global_limit then return 'global_limit'; end if;
  if u >= p_user_limit then return 'user_limit'; end if;
  if i >= p_ip_limit then return 'ip_limit'; end if;
  update public.ai_usage set count = count + 1
    where day = d and ((scope = 'global' and key = 'all') or (scope = 'user' and key = p_user) or (scope = 'ip' and key = p_ip));
  return 'ok';
end $$;
revoke all on function public.headroom_consume_ai_quota(text, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.headroom_consume_ai_quota(text, text, integer, integer, integer) to service_role;
