-- Fotos do imóvel (spec BKL-093, seção 11). Migration aditiva.

-- Bucket privado: o endereço de uma foto não pode ser alcançável por outra
-- empresa (11.15). Sem policies em storage.objects para este bucket: envio e
-- leitura só por URL assinada que o backend gera depois de checar a empresa.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'property-photos',
  'property-photos',
  false,
  31457280, -- 30 MB por foto [PROVISÓRIO], igual a MAX_PHOTO_BYTES no backend
  array['image/jpeg', 'image/png']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.property_photos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete restrict,
  property_id uuid not null references public.properties (id) on delete cascade,
  -- {company_id}/{property_id}/{uuid}.{ext} no bucket property-photos.
  storage_path text not null unique,
  original_name text not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png')),
  size_bytes integer not null check (size_bytes > 0),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  is_cover boolean not null default false,
  -- Ordem de inclusão (11.4); a capa aparece primeiro na leitura.
  position integer not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists property_photos_property_idx
  on public.property_photos (property_id, position);

-- Uma capa por imóvel (11.3).
create unique index if not exists property_photos_one_cover_idx
  on public.property_photos (property_id)
  where is_cover;

alter table public.property_photos enable row level security;
