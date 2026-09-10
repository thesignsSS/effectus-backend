alter table public.engineering_request_documents
  add column if not exists uploaded_by_user_id uuid references auth.users (id) on delete set null;

update public.engineering_request_documents as document
set uploaded_by_user_id = request.broker_user_id
from public.engineering_requests as request
where request.id = document.request_id
  and document.uploaded_by_user_id is null;

create index if not exists engineering_request_documents_uploaded_by_user_id_idx
  on public.engineering_request_documents (uploaded_by_user_id);
