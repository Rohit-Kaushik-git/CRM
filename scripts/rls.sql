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

alter table activity_log enable row level security;
drop policy if exists act_read on activity_log;
create policy act_read on activity_log for select to authenticated using (true);

-- Column guard (spec 3: implementors may change only status on their own tasks).
-- The tsk_upd policy above grants row access; this trigger pins which columns a
-- non-admin may actually change (status + done_date — set together when marking Done).
-- Service-role callers (import script) have auth.uid() = null and are exempt.
create or replace function public.enforce_task_update_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not is_admin() then
    if new.title       is distinct from old.title
       or new.client_id   is distinct from old.client_id
       or new.template_id is distinct from old.template_id
       or new.assignee_id is distinct from old.assignee_id
       or new.due_date    is distinct from old.due_date
       or new.created_by  is distinct from old.created_by
       or new.created_at  is distinct from old.created_at then
      raise exception 'Implementors may only change task status';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists task_update_columns on tasks;
create trigger task_update_columns before update on tasks
for each row execute function public.enforce_task_update_columns();
