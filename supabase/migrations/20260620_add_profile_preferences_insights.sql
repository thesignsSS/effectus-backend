alter table public.profiles
  add column if not exists can_view_preferences_insights boolean not null default false;

alter table public.profiles
  add column if not exists ux_preferences jsonb;

alter table public.profiles
  add column if not exists ux_preferences_updated_at timestamptz;
