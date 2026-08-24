-- Row-Level Security. Run after schema.sql in the Supabase SQL editor. Re-runnable.

alter table app_config     enable row level security;
alter table users          enable row level security;
alter table clients        enable row level security;
alter table client_modules enable row level security;
alter table task_templates enable row level security;
alter table tasks          enable row level security;
alter table task_notes     enable row level security;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from users where id = auth.uid() and role = 'admin' and active) $$;

drop policy if exists cfg_read  on app_config;     drop policy if exists cfg_admin_upd on app_config;
drop policy if exists usr_read  on users;          drop policy if exists usr_admin_upd on users;
drop policy if exists cli_read  on clients;        drop policy if exists cli_admin_ins on clients;
drop policy if exists cli_admin_upd on clients;
drop policy if exists mod_read  on client_modules; drop policy if exists mod_admin_upd on client_modules;
drop policy if exists tpl_read  on task_templates;
drop policy if exists tsk_read  on tasks;          drop policy if exists tsk_admin_ins on tasks;
drop policy if exists tsk_upd   on tasks;
drop policy if exists nts_read  on task_notes;     drop policy if exists nts_ins on task_notes;

-- Reads: any signed-in team member. Anon: no policies => nothing.
create policy cfg_read on app_config     for select to authenticated using (true);
create policy usr_read on users          for select to authenticated using (true);
create policy cli_read on clients        for select to authenticated using (true);
create policy mod_read on client_modules for select to authenticated using (true);
create policy tpl_read on task_templates for select to authenticated using (true);
create policy tsk_read on tasks          for select to authenticated using (true);
create policy nts_read on task_notes     for select to authenticated using (true);

-- Writes.
create policy cfg_admin_upd on app_config     for update to authenticated using (is_admin());
create policy usr_admin_upd on users          for update to authenticated using (is_admin());
create policy cli_admin_ins on clients        for insert to authenticated with check (is_admin());
create policy cli_admin_upd on clients        for update to authenticated using (is_admin());
create policy mod_admin_upd on client_modules for update to authenticated using (is_admin());
create policy tsk_admin_ins on tasks          for insert to authenticated with check (is_admin());
create policy tsk_upd       on tasks          for update to authenticated
  using (is_admin() or assignee_id = auth.uid());
create policy nts_ins       on task_notes     for insert to authenticated
  with check (author_id = auth.uid());
