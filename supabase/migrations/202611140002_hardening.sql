-- Claude 3 hardening on top of the foundation schema. Not yet applied to a live project
-- (no Supabase credentials were available); apply after 202611140001_foundation.sql.

-- Plans: payload size bound and immutable ownership.
alter table public.plans add constraint plans_payload_size check (pg_column_size(payload) < 2000000);

create or replace function public.headroom_keep_owner() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'owner_id cannot be changed';
  end if;
  return new;
end $$;

create trigger plans_keep_owner before update on public.plans
  for each row execute function public.headroom_keep_owner();

-- Plan events are an append-only history: owners may read, add and (via plan/data deletion) delete.
drop policy if exists plan_events_owner on public.plan_events;
create policy plan_events_owner_select on public.plan_events for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy plan_events_owner_insert on public.plan_events for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy plan_events_owner_delete on public.plan_events for delete to authenticated
  using ((select auth.uid()) = owner_id);
revoke update on public.plan_events from authenticated;
alter table public.plan_events add constraint plan_events_payload_size check (pg_column_size(payload) < 20000);

-- Source metadata stays minimal: no raw document bodies.
alter table public.document_sources add constraint document_sources_metadata_size check (pg_column_size(metadata) < 4000);

-- Entitlements: only the trusted server path (secret key, which bypasses RLS) writes rows.
-- Owners can read their own rows (foundation policy). Demo/test rows are never 'live'.
revoke insert, update, delete on public.entitlements from authenticated;
