alter table public.profiles
  add column if not exists is_active boolean not null default true;

create or replace function public.ensure_active_admin_remains()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  remaining_active_admins bigint;
  will_remove_active_admin boolean;
begin
  will_remove_active_admin :=
    old.role = 'admin'
    and old.is_active = true
    and (
      tg_op = 'DELETE'
      or new.role <> 'admin'
      or new.is_active = false
    );

  if will_remove_active_admin then
    select count(*)
    into remaining_active_admins
    from public.profiles
    where role = 'admin'
      and is_active = true
      and id <> old.id;

    if remaining_active_admins = 0 then
      raise exception 'O sistema precisa de pelo menos um administrador ativo';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists ensure_active_admin_remains_on_profiles on public.profiles;

create trigger ensure_active_admin_remains_on_profiles
before update or delete on public.profiles
for each row
execute function public.ensure_active_admin_remains();
