alter table public.engineering_requests
  drop constraint if exists engineering_requests_status_check;

update public.engineering_requests
set status = case status
  when 'pending' then 'solicitar_engenharia'
  when 'in_progress' then 'ordem_servico'
  when 'completed' then 'engenharia_concluida'
  when 'cancelled' then 'pendencia'
  else status
end;

alter table public.engineering_requests
  add constraint engineering_requests_status_check
  check (
    status in (
      'solicitar_engenharia',
      'pendencia',
      'boleto_enviado',
      'ordem_servico',
      'engenharia_concluida'
    )
  );

alter table public.engineering_requests
  alter column status set default 'solicitar_engenharia';
