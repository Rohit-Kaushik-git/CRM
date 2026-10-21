-- SECURITY FIX (Supabase advisor "rls_disabled_in_public", 17-21 Oct 2026).
-- Row-Level Security was OFF on the seven core tables and none of them except
-- tasks (tsk_upd only) had a policy: scripts/rls.sql had never been applied to
-- this project. The public anon key in site/config.js could read, edit and
-- delete every row without signing in (21 Oct: clients 73, tasks 1261,
-- task_notes 335, users 7, client_modules 292, task_templates 17, app_config 4).
--
-- This applies rls.sql's policies and turns RLS on. tsk_upd (and can_work_task)
-- already existed and are left untouched. Service-role callers (Apps Script,
-- prod-refresh) bypass RLS. Applied 21 Oct 2026; verified anon reads 0 rows on
-- every public table afterwards. Safe to re-run.

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from users where id = auth.uid() and role = 'admin' and active) $$;

create or replace function public.in_team(team text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from users u
    join app_config cfg on cfg.key = case team
          when 'Data Team' then 'team_data_team'
          when 'Tax Team'  then 'team_tax_team'
          when 'Shruti'    then 'team_pto' end
    where u.id = auth.uid() and u.active
      and lower(u.email) = any(string_to_array(lower(replace(cfg.value, ' ', '')), ',')))
$$;

-- Reads: any signed-in user; anon gets nothing.
drop policy if exists cfg_read on app_config;     create policy cfg_read on app_config     for select to authenticated using (true);
drop policy if exists usr_read on users;          create policy usr_read on users          for select to authenticated using (true);
drop policy if exists cli_read on clients;        create policy cli_read on clients        for select to authenticated using (true);
drop policy if exists mod_read on client_modules; create policy mod_read on client_modules for select to authenticated using (true);
drop policy if exists tpl_read on task_templates; create policy tpl_read on task_templates for select to authenticated using (true);
drop policy if exists tsk_read on tasks;          create policy tsk_read on tasks          for select to authenticated using (true);
drop policy if exists nts_read on task_notes;     create policy nts_read on task_notes     for select to authenticated using (true);

-- Writes (tsk_upd already exists and is left as it is).
drop policy if exists cfg_admin_upd on app_config;     create policy cfg_admin_upd on app_config     for update to authenticated using (is_admin());
drop policy if exists usr_admin_upd on users;          create policy usr_admin_upd on users          for update to authenticated using (is_admin());
drop policy if exists cli_admin_ins on clients;        create policy cli_admin_ins on clients        for insert to authenticated with check (is_admin());
drop policy if exists cli_admin_upd on clients;        create policy cli_admin_upd on clients        for update to authenticated using (is_admin());
drop policy if exists mod_admin_upd on client_modules; create policy mod_admin_upd on client_modules for update to authenticated using (is_admin());
drop policy if exists tsk_admin_ins on tasks;          create policy tsk_admin_ins on tasks          for insert to authenticated with check (is_admin());
drop policy if exists nts_ins on task_notes;           create policy nts_ins       on task_notes     for insert to authenticated with check (author_id = auth.uid());

alter table app_config     enable row level security;
alter table users          enable row level security;
alter table clients        enable row level security;
alter table client_modules enable row level security;
alter table task_templates enable row level security;
alter table tasks          enable row level security;
alter table task_notes     enable row level security;

-- Check: every table rowsecurity = true with policies > 0.
select t.tablename, t.rowsecurity,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = t.tablename) as policies
from pg_tables t
where t.schemaname = 'public'
  and t.tablename in ('app_config', 'users', 'clients', 'client_modules', 'task_templates', 'tasks', 'task_notes')
order by t.tablename;
