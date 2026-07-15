alter table public.proposal_documents
  drop constraint if exists proposal_documents_document_scope_check;

alter table public.proposal_documents
  add constraint proposal_documents_document_scope_check
  check (
    document_scope in (
      'proposal',
      'income_validation',
      'seller',
      'property'
    )
  );
