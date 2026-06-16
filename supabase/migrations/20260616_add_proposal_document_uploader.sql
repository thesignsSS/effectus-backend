alter table public.proposal_documents
  add column if not exists uploaded_by_user_id uuid references auth.users (id) on delete set null;

update public.proposal_documents
set uploaded_by_user_id = proposals.broker_user_id
from public.proposals
where proposal_documents.proposal_id = proposals.id
  and proposal_documents.uploaded_by_user_id is null;

create index if not exists proposal_documents_uploaded_by_user_id_idx
  on public.proposal_documents (uploaded_by_user_id);
