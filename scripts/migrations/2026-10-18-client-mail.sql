-- Recent client mail threads for the Today page. Written hourly by the
-- "DSP Historical Data Mail" Apps Script (syncClientMail) from the mailbox
-- that runs it; one row per Gmail thread that names a DSP client in its
-- subject. Subject + who wrote last + when only: no mail body is stored.
-- The app only selects. Run once in the Supabase SQL editor (CRM project). Idempotent.
create table if not exists client_mail (
  thread_id      text primary key,
  mailbox        text not null,          -- whose inbox it came from
  dsp_short_code text,
  client_name    text,
  subject        text,
  last_from      text,                   -- display name of the last sender
  last_from_me   boolean not null default false,
  first_date     timestamptz,
  last_date      timestamptz,
  message_count  int,
  state          text check (state in ('needs_reply', 'waiting', 'fyi')),
  gmail_url      text,
  synced_at      timestamptz not null default now()
);
create index if not exists client_mail_last_date on client_mail (last_date desc);
alter table client_mail enable row level security;
drop policy if exists client_mail_read on client_mail;
create policy client_mail_read on client_mail for select to authenticated using (true);
grant select on client_mail to authenticated;
grant all on client_mail to service_role;
