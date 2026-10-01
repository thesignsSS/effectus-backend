-- Imóvel como cadastro único (spec BKL-093, seções 4 e 8).
-- Migration aditiva: só cria tabelas novas; propostas e engenharias existentes
-- não são tocadas (seção 1, item 5: não criar imóveis a partir delas).

create extension if not exists pgcrypto;

create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete restrict,

  -- Único dentro da empresa; gerado pelo backend quando vem em branco (8.6).
  reference_code text not null,
  -- Escolha definitiva de quem cadastra; só o ADM corrige (8.3 + decisão 6).
  type text not null
    check (type in ('novo', 'usado', 'terreno', 'na_planta', 'adjudicado')),
  sale_price numeric(14, 2) not null check (sale_price > 0),
  development_name text,

  -- Endereço (8.2): número, complemento e CEP opcionais (terreno pode não ter número).
  state char(2) not null,
  municipality text not null,
  municipality_ibge_code text,
  neighborhood text not null,
  street text not null,
  street_number text,
  complement text,
  postal_code text,

  private_area_m2 numeric(10, 2) check (private_area_m2 is null or private_area_m2 > 0),
  total_area_m2 numeric(10, 2) check (total_area_m2 is null or total_area_m2 > 0),
  registration_number text,

  -- Avaliação do imóvel (não é a avaliação de crédito do cliente).
  has_appraisal boolean not null default false,
  appraisal_value numeric(14, 2),
  appraisal_valid_until date,
  constraint properties_appraisal_coerente check (
    (has_appraisal and appraisal_value is not null and appraisal_value > 0 and appraisal_valid_until is not null)
    or (not has_appraisal and appraisal_value is null and appraisal_valid_until is null)
  ),

  -- Nunca visível ao público nem ao CCA (seção 5).
  internal_notes text,

  responsible_broker_id uuid not null references public.profiles (id) on delete restrict,
  -- Não existe rascunho: nasce Disponível (8.10).
  status text not null default 'disponivel'
    check (status in ('disponivel', 'em_negociacao', 'reservado', 'em_proposta', 'vendido', 'inativo')),
  status_changed_at timestamptz not null default timezone('utc', now()),

  created_by uuid not null references public.profiles (id) on delete restrict,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),

  constraint properties_reference_code_unico unique (company_id, reference_code),
  constraint properties_state_formato check (state ~ '^[A-Z]{2}$'),
  constraint properties_textos_obrigatorios check (
    char_length(btrim(municipality)) > 0
    and char_length(btrim(neighborhood)) > 0
    and char_length(btrim(street)) > 0
    and char_length(btrim(reference_code)) > 0
  )
);

create index if not exists properties_company_updated_idx
  on public.properties (company_id, updated_at desc);
create index if not exists properties_company_status_idx
  on public.properties (company_id, status);
create index if not exists properties_responsible_idx
  on public.properties (responsible_broker_id);

drop trigger if exists set_properties_updated_at on public.properties;
create trigger set_properties_updated_at
before update on public.properties
for each row
execute function public.set_updated_at();

-- Histórico do imóvel (4.4, 10.9, decisões 6 e 9). Legível por outros módulos
-- (Anúncios lê as mudanças de situação). actor_id nulo = "Sistema".
create table if not exists public.property_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete restrict,
  property_id uuid not null references public.properties (id) on delete cascade,
  kind text not null check (kind in (
    'created',
    'updated',
    'status_changed',
    'price_changed',
    'type_corrected',
    'photo_added',
    'photo_removed',
    'cover_changed',
    'transferred'
  )),
  actor_id uuid references public.profiles (id) on delete set null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists property_events_property_idx
  on public.property_events (property_id, created_at desc);
create index if not exists property_events_company_kind_idx
  on public.property_events (company_id, kind, created_at desc);

-- Acesso só pelo backend (service role, que ignora RLS). Sem policies para
-- anon/authenticated: a anon key é pública no bundle, e sem policy o PostgREST
-- não devolve nada por ela.
alter table public.properties enable row level security;
alter table public.property_events enable row level security;
