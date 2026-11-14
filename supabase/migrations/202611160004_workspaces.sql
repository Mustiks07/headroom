-- Round 3 (Claude 3): household workspaces v2.0. Apply after 001, 002 and 003.
-- Not yet applied to a live project: no Supabase access was available when this was written.
-- The workspace document embeds its history events, so a revision and its event are one atomic row write.

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  revision integer not null check (revision > 0),
  payload jsonb not null check (pg_column_size(payload) < 2000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);
create index workspaces_owner_idx on public.workspaces(owner_id, updated_at desc);

create trigger workspaces_keep_owner before update on public.workspaces
  for each row execute function public.headroom_keep_owner();

-- Earlier revisions and the original v1 snapshot a workspace was migrated from.
create table public.workspace_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('revision', 'legacy_v1')),
  revision integer not null check (revision >= 0),
  payload jsonb not null check (pg_column_size(payload) < 2000000),
  saved_at timestamptz not null default now(),
  unique (workspace_id, kind, revision),
  foreign key (workspace_id, owner_id) references public.workspaces(id, owner_id) on delete cascade
);
create index workspace_snapshots_owner_idx on public.workspace_snapshots(owner_id, workspace_id, revision desc);

alter table public.workspaces enable row level security;
alter table public.workspace_snapshots enable row level security;

create policy workspaces_owner on public.workspaces for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy workspace_snapshots_owner_select on public.workspace_snapshots for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy workspace_snapshots_owner_insert on public.workspace_snapshots for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy workspace_snapshots_owner_delete on public.workspace_snapshots for delete to authenticated
  using ((select auth.uid()) = owner_id);

grant select, insert, update, delete on public.workspaces to authenticated;
grant select, insert, delete on public.workspace_snapshots to authenticated;
revoke all on public.workspaces, public.workspace_snapshots from anon;
