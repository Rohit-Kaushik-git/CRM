-- Documents tab v2: active vs leaver coverage, the migration window, and a
-- per-type breakdown (W-4, I-9, handbook...). Filled by the prod-refresh
-- document_counts job and copied here by push_to_crm, which copies EVERY
-- column - so run this BEFORE the new function is deployed, or the copy fails.
-- Additive only. Run once in the Supabase SQL editor (CRM project). Idempotent.
alter table client_document_counts add column if not exists active_with_docs     integer not null default 0;
alter table client_document_counts add column if not exists terminated_with_docs integer not null default 0;
alter table client_document_counts add column if not exists migrated_docs        integer not null default 0;
alter table client_document_counts add column if not exists first_migrated       date;
alter table client_document_counts add column if not exists last_migrated        date;
alter table client_document_counts add column if not exists last_upload          date;
alter table client_document_counts add column if not exists by_type              jsonb not null default '{}'::jsonb;
