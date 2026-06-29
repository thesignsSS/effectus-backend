alter table public.proposal_documents
  add column if not exists document_scope text not null default 'proposal';

alter table public.proposal_documents
  drop constraint if exists proposal_documents_document_scope_check;

alter table public.proposal_documents
  add constraint proposal_documents_document_scope_check
  check (document_scope in ('proposal', 'income_validation'));

create index if not exists proposal_documents_proposal_id_scope_idx
  on public.proposal_documents (proposal_id, document_scope);
