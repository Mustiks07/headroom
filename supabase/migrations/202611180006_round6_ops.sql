-- Round 6 (Claude 3): developer data kind for analytics and anonymous AI call counters for the
-- operational report. No content, amounts, identifiers or payloads are stored. Server-only.
-- Apply after 001–005. Idempotent.

-- 1. Analytics: separate developer runs (localhost / previews / opted-in testers) from own data.
alter table public.analytics_daily drop constraint if exists analytics_daily_data_kind_check;
alter table public.analytics_daily add constraint analytics_daily_data_kind_check
  check (data_kind in ('sample', 'own', 'developer', 'unknown'));

-- 2. AI calls per day / feature / provider / outcome: counts, latency and token totals only.
create table if not exists public.ai_calls_daily (
  day date not null,
  feature text not null check (feature in ('extraction', 'proposal', 'explanation')),
  provider text not null check (provider in ('anthropic', 'basisweb')),
  outcome text not null check (length(outcome) between 1 and 40),
  calls integer not null default 0 check (calls >= 0),
  latency_ms_sum bigint not null default 0 check (latency_ms_sum >= 0),
  latency_ms_max integer not null default 0 check (latency_ms_max >= 0),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  usage_unknown integer not null default 0 check (usage_unknown >= 0),
  primary key (day, feature, provider, outcome)
);
alter table public.ai_calls_daily enable row level security;
revoke all on public.ai_calls_daily from anon, authenticated;

create or replace function public.headroom_count_ai_call(p_feature text, p_provider text, p_outcome text, p_latency_ms integer,
  p_input integer, p_output integer)
returns void language sql security definer set search_path = '' as $$
  insert into public.ai_calls_daily(day, feature, provider, outcome, calls, latency_ms_sum, latency_ms_max, input_tokens, output_tokens, usage_unknown)
  values ((now() at time zone 'utc')::date, p_feature, p_provider, left(p_outcome, 40), 1, greatest(p_latency_ms, 0), greatest(p_latency_ms, 0),
          greatest(coalesce(p_input, 0), 0), greatest(coalesce(p_output, 0), 0), case when p_input is null then 1 else 0 end)
  on conflict (day, feature, provider, outcome) do update set
    calls = public.ai_calls_daily.calls + 1,
    latency_ms_sum = public.ai_calls_daily.latency_ms_sum + excluded.latency_ms_sum,
    latency_ms_max = greatest(public.ai_calls_daily.latency_ms_max, excluded.latency_ms_max),
    input_tokens = public.ai_calls_daily.input_tokens + excluded.input_tokens,
    output_tokens = public.ai_calls_daily.output_tokens + excluded.output_tokens,
    usage_unknown = public.ai_calls_daily.usage_unknown + excluded.usage_unknown;
$$;
revoke all on function public.headroom_count_ai_call(text, text, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.headroom_count_ai_call(text, text, text, integer, integer, integer) to service_role;
