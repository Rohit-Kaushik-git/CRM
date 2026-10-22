-- Client 360 "Logins" button: a LINK to where a client's logins are kept (a
-- Drive/Docs file or a password-manager entry). Never a password - the app
-- accepts only https links on known hosts (site/views-admin.js isLoginsUrl).
-- Admin-editable through the existing cli_admin_upd policy.
-- Run once in the Supabase SQL editor (CRM project). Idempotent.
alter table clients add column if not exists logins_url text;
