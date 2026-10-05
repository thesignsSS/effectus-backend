-- Dados do anúncio no cadastro do imóvel (spec BKL-093, seção 12).
-- Migration aditiva: só colunas novas, todas opcionais (12.1).

alter table public.properties
  add column if not exists typology text
    check (typology is null or typology in ('apartamento', 'casa', 'casa_condominio', 'terreno', 'sala_loja')),
  add column if not exists ad_title text check (ad_title is null or char_length(ad_title) <= 40),
  add column if not exists ad_headline text check (ad_headline is null or char_length(ad_headline) <= 125),
  add column if not exists ad_description text,
  add column if not exists ad_highlights text[] not null default '{}'
    check (cardinality(ad_highlights) <= 8),
  add column if not exists bedrooms integer check (bedrooms is null or bedrooms >= 0),
  add column if not exists suites integer check (suites is null or suites >= 0),
  add column if not exists bathrooms integer check (bathrooms is null or bathrooms >= 0),
  add column if not exists parking_spaces integer check (parking_spaces is null or parking_spaces >= 0),
  add column if not exists accepts_financing text not null default 'nao_informado'
    check (accepts_financing in ('sim', 'nao', 'nao_informado')),
  add column if not exists accepts_fgts text not null default 'nao_informado'
    check (accepts_fgts in ('sim', 'nao', 'nao_informado')),
  add column if not exists accepts_mcmv text not null default 'nao_informado'
    check (accepts_mcmv in ('sim', 'nao', 'nao_informado')),
  -- 12.2: preço aparece por padrão; endereço completo não.
  add column if not exists show_price boolean not null default true,
  add column if not exists show_full_address boolean not null default false,
  -- 12.6: obtida do endereço; sem ponto no mapa quando não der para localizar.
  add column if not exists latitude numeric(9, 6),
  add column if not exists longitude numeric(9, 6);
