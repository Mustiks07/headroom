-- Foundation schema. Claude 3 must apply and verify it against the chosen project.
-- No raw uploaded documents are stored in these tables.
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  revision integer not null default 1 check (revision > 0),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);
create table public.plan_events (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('income_changed','coverage_changed','opportunity_changed','action_confirmed')),
  payload jsonb not null,
  occurred_at timestamptz not null default now(),
  foreign key (plan_id, owner_id) references public.plans(id, owner_id) on delete cascade
);
create table public.document_sources (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid,
  source_kind text not null,
  label text not null,
  excerpt text check (length(excerpt) <= 800),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (plan_id, owner_id) references public.plans(id, owner_id) on delete cascade
);
create table public.entitlements (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  mode text not null check (mode in ('demo','test','live')),
  product text not null default 'headroom_annual',
  provider_reference text unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index plans_owner_idx on public.plans(owner_id, updated_at desc);
create index plan_events_owner_idx on public.plan_events(owner_id, plan_id, occurred_at);
create index document_sources_owner_idx on public.document_sources(owner_id);
create index entitlements_owner_idx on public.entitlements(owner_id);

alter table public.plans enable row level security;
alter table public.plan_events enable row level security;
alter table public.document_sources enable row level security;
alter table public.entitlements enable row level security;

create policy plans_owner on public.plans for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy plan_events_owner on public.plan_events for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy document_sources_owner on public.document_sources for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy entitlements_owner_read on public.entitlements for select to authenticated
  using ((select auth.uid()) = owner_id);

grant select, insert, update, delete on public.plans, public.plan_events, public.document_sources to authenticated;
grant select on public.entitlements to authenticated;
revoke all on public.plans, public.plan_events, public.document_sources, public.entitlements from anon;
