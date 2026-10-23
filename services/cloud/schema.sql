-- Apply with the Supabase SQL editor before enabling the service.
-- No client (anon/authenticated) may mutate billing or usage tables/functions.
create table if not exists public.bb_accounts (
  id uuid primary key references auth.users(id) on delete cascade,
  tier text not null default 'free' check (tier in ('free','individual','pro_plus','pro_max')),
  paid_until timestamptz,
  stripe_customer text unique
);
create table if not exists public.bb_usage_buckets (
  bucket text primary key,
  used bigint not null default 0 check (used >= 0)
);
create table if not exists public.bb_search_requests (
  id uuid primary key,
  account_id uuid not null references public.bb_accounts(id),
  created_at timestamptz not null default now()
);
create table if not exists public.bb_billing_events (
  id text primary key,
  type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  reconciled_at timestamptz
);
create table if not exists public.bb_service_limits (
  id boolean primary key default true check (id),
  monthly_search_cap bigint not null default 1000 check (monthly_search_cap >= 0)
);
insert into public.bb_service_limits(id) values(true) on conflict do nothing;

alter table public.bb_accounts enable row level security;
alter table public.bb_usage_buckets enable row level security;
alter table public.bb_search_requests enable row level security;
alter table public.bb_billing_events enable row level security;
alter table public.bb_service_limits enable row level security;
revoke all on public.bb_accounts, public.bb_usage_buckets, public.bb_search_requests, public.bb_billing_events, public.bb_service_limits from anon, authenticated;
grant all on public.bb_accounts, public.bb_usage_buckets, public.bb_search_requests, public.bb_billing_events, public.bb_service_limits to service_role;

create or replace function public.bb_usage(account_id uuid) returns jsonb
language plpgsql set search_path = public as $$
declare t text; lim int; period text; k text; n bigint;
begin
  insert into bb_accounts(id) values(account_id) on conflict do nothing;
  select case when paid_until > now() then tier else 'free' end into t from bb_accounts where id=account_id;
  lim := case t when 'individual' then 500 when 'pro_plus' then 1000 when 'pro_max' then 1800 else 10 end;
  period := case when t='free' then to_char(now() at time zone 'UTC','YYYY-MM-DD') else to_char(now() at time zone 'UTC','YYYY-MM') end;
  k := account_id::text || ':' || t || ':' || period;
  select used into n from bb_usage_buckets where bucket=k;
  return jsonb_build_object('tier',t,'limit',lim,'used',coalesce(n,0),'remaining',greatest(0,lim-coalesce(n,0)),'period',period,'bucket',k);
end $$;

create or replace function public.bb_reserve_search(account_id uuid, request_id uuid) returns jsonb
language plpgsql set search_path = public as $$
declare u jsonb; global_key text; global_used bigint; user_used bigint; cap bigint;
begin
  -- One globally shared row lock serializes allocation across ALL instances.
  -- This is a low-volume launch design, not an in-memory per-instance counter.
  select monthly_search_cap into cap from bb_service_limits where id=true for update;
  if cap is null then raise exception 'Service cap is not configured'; end if;
  u := bb_usage(account_id);
  if exists(select 1 from bb_search_requests where id=request_id) then
    return u || jsonb_build_object('allowed',false,'reason','duplicate');
  end if;
  global_key := 'global:' || to_char(now() at time zone 'UTC','YYYY-MM');
  insert into bb_usage_buckets(bucket) values(global_key),(u->>'bucket') on conflict do nothing;
  select used into global_used from bb_usage_buckets where bucket=global_key for update;
  select used into user_used from bb_usage_buckets where bucket=u->>'bucket' for update;
  if global_used >= cap or user_used >= (u->>'limit')::int then
    return u || jsonb_build_object('allowed',false,'reason',case when global_used >= cap then 'service_capacity' else 'account_limit' end);
  end if;
  insert into bb_search_requests(id,account_id) values(request_id,account_id);
  update bb_usage_buckets set used=used+1 where bucket in (global_key,u->>'bucket');
  return bb_usage(account_id) || jsonb_build_object('allowed',true);
end $$;

create or replace function public.bb_queue_billing_event(event_id text, event_type text, payload jsonb) returns void
language sql set search_path = public as $$
  insert into bb_billing_events(id,type,payload) values(event_id,event_type,payload) on conflict do nothing;
$$;
revoke execute on function public.bb_usage(uuid), public.bb_reserve_search(uuid,uuid), public.bb_queue_billing_event(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.bb_usage(uuid), public.bb_reserve_search(uuid,uuid), public.bb_queue_billing_event(text,text,jsonb) to service_role;
