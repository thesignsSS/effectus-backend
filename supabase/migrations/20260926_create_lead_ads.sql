-- Captação de leads via anúncios do Instagram (Meta Lead Ads).
--
-- As três tabelas são acessadas só pelo backend (service role). O RLS fica
-- ligado SEM nenhuma policy de propósito: o app tem a chave anon, e
-- `meta_connections` guarda o token de acesso da Meta da empresa. Qualquer
-- policy para `authenticated` exporia esse token via PostgREST.

create table if not exists public.meta_connections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null unique references public.companies (id) on delete cascade,
  connected_by_user_id uuid not null references auth.users (id) on delete cascade,
  meta_user_id text not null,
  page_id text not null,
  page_name text,
  instagram_business_id text not null,
  instagram_username text,
  ad_account_id text not null,
  user_access_token_encrypted text not null,
  page_access_token_encrypted text not null,
  token_expires_at timestamptz,
  status text not null default 'connected'
    check (status in ('connected', 'revoked')),
  connected_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- O webhook da Meta identifica a origem pela página, não pela empresa.
create index if not exists meta_connections_page_id_idx
  on public.meta_connections (page_id);

drop trigger if exists set_meta_connections_updated_at on public.meta_connections;
create trigger set_meta_connections_updated_at
before update on public.meta_connections
for each row
execute function public.set_updated_at();

alter table public.meta_connections enable row level security;

create table if not exists public.lead_ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  created_by_user_id uuid not null references auth.users (id) on delete cascade,
  meta_connection_id uuid references public.meta_connections (id) on delete set null,
  name text not null,
  instagram_media_id text not null,
  instagram_media_permalink text,
  instagram_media_thumbnail_url text,
  instagram_media_caption text,
  budget_cents bigint not null check (budget_cents > 0),
  budget_currency text not null default 'BRL',
  duration_days integer not null check (duration_days between 1 and 90),
  audience jsonb not null default '{}'::jsonb,
  status text not null default 'creating'
    check (status in ('creating', 'active', 'paused', 'completed', 'failed')),
  failure_reason text,
  meta_campaign_id text,
  meta_adset_id text,
  meta_creative_id text,
  meta_ad_id text,
  meta_lead_form_id text,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists lead_ad_campaigns_company_id_idx
  on public.lead_ad_campaigns (company_id, created_at desc);

create index if not exists lead_ad_campaigns_meta_ad_id_idx
  on public.lead_ad_campaigns (meta_ad_id);

drop trigger if exists set_lead_ad_campaigns_updated_at on public.lead_ad_campaigns;
create trigger set_lead_ad_campaigns_updated_at
before update on public.lead_ad_campaigns
for each row
execute function public.set_updated_at();

alter table public.lead_ad_campaigns enable row level security;

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  campaign_id uuid references public.lead_ad_campaigns (id) on delete set null,
  source text not null default 'meta_lead_ads',
  -- Unique: a Meta reenvia o mesmo webhook em caso de timeout/erro.
  meta_leadgen_id text unique,
  meta_form_id text,
  meta_ad_id text,
  full_name text,
  email text,
  phone text,
  raw_fields jsonb not null default '[]'::jsonb,
  status text not null default 'new'
    check (status in ('new', 'contacted', 'qualified', 'discarded')),
  received_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists leads_company_id_idx
  on public.leads (company_id, received_at desc);

create index if not exists leads_campaign_id_idx
  on public.leads (campaign_id, received_at desc);

drop trigger if exists set_leads_updated_at on public.leads;
create trigger set_leads_updated_at
before update on public.leads
for each row
execute function public.set_updated_at();

alter table public.leads enable row level security;
