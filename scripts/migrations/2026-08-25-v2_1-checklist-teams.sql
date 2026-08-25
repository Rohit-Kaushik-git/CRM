-- v2.1: 11-item onboarding checklist, owner teams, vendor 'New', N/A rules.
-- Run in the Supabase SQL editor. Destroys onboarding-task history (accepted).
begin;

-- vendor gains 'New' ("previous system" semantics)
do $drop$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'clients'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) like '%vendor%';
  if c is not null then execute format('alter table clients drop constraint %I', c); end if;
end $drop$;
alter table clients add constraint clients_vendor_check
  check (vendor in ('ADP','Paycom','New'));

-- owner team on templates
alter table task_templates add column if not exists owner_team text not null
  default 'Implementor'
  check (owner_team in ('Implementor','Data Team','Tax Team','Shruti'));

-- replace the onboarding checklist (audit 6 stay)
delete from task_notes where task_id in (
  select t.id from tasks t
  join task_templates tt on tt.id = t.template_id
  where tt.phase = 'onboarding');
delete from tasks where template_id in
  (select id from task_templates where phase = 'onboarding');
delete from task_templates where phase = 'onboarding';

insert into task_templates (name, phase, sort_order, owner_team) values
  ('Company Setup','onboarding',1,'Implementor'),
  ('Census Transfer','onboarding',2,'Implementor'),
  ('Time Tracking Setup (Kiosk/Mobile/Web)','onboarding',3,'Implementor'),
  ('Payment Method Transfer','onboarding',4,'Implementor'),
  ('Federal/State Withholding','onboarding',5,'Data Team'),
  ('Prior Pay Info Transfer & Approval','onboarding',6,'Data Team'),
  ('Worker''s Compensation','onboarding',7,'Data Team'),
  ('Historical Data Download','onboarding',8,'Implementor'),
  ('Tax Review','onboarding',9,'Tax Team'),
  ('PTO Balance Move','onboarding',10,'Shruti'),
  ('Document Transfer','onboarding',11,'Data Team');

update task_templates set owner_team = 'Implementor'
  where name in ('Census Audit','Payment Audit','Emergency Contact Audit');
update task_templates set owner_team = 'Data Team'
  where name in ('Withholding Audit','Prior Payroll Audit','Deduction Audit');

-- vendor from previous_system where the sheet said "New"
update clients set vendor = 'New'
  where vendor is null and lower(coalesce(previous_system, '')) like '%new%';

-- backfill missing tasks for existing clients (respecting N/A rule for non-migrating)
insert into tasks (client_id, template_id, title, status)
select c.id, t.id, t.name,
       case when coalesce(c.vendor,'') not in ('ADP','Paycom')
                 and t.name not in ('Company Setup','Time Tracking Setup (Kiosk/Mobile/Web)')
            then 'N/A' else 'Open' end
from clients c cross join task_templates t
where not exists (select 1 from tasks x
                  where x.client_id = c.id and x.template_id = t.id);

-- N/A rule applied to pre-existing untouched tasks of non-migrating clients
update tasks set status = 'N/A', done_date = null
where status = 'Open' and app_touched = false
  and client_id in (select id from clients where coalesce(vendor,'') not in ('ADP','Paycom'))
  and template_id in (select id from task_templates
                      where name not in ('Company Setup','Time Tracking Setup (Kiosk/Mobile/Web)'));

-- team membership (comma-separated emails; edited via SQL or a future Team UI)
insert into app_config values
  ('team_data_team', 'shobhit.sharma@uzio.com'),
  ('team_tax_team', ''),
  ('team_pto', '')
on conflict (key) do nothing;

-- seed trigger: insert with the right status up front (no churn, no activity noise)
create or replace function public.seed_client_tasks()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into tasks (client_id, template_id, title, status)
  select new.id, t.id, t.name,
         case when coalesce(new.vendor,'') not in ('ADP','Paycom')
                   and t.name not in ('Company Setup','Time Tracking Setup (Kiosk/Mobile/Web)')
              then 'N/A' else 'Open' end
  from task_templates t;
  insert into client_modules (client_id, module) values
    (new.id, 'TimeTracking'), (new.id, 'Payroll'), (new.id, 'Benefits'), (new.id, 'HR');
  return new;
end $$;

-- vendor change flips untouched tasks between Open and N/A
create or replace function public.apply_vendor_checklist_rules()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.vendor is distinct from old.vendor then
    if coalesce(new.vendor,'') in ('ADP','Paycom')
       and coalesce(old.vendor,'') not in ('ADP','Paycom') then
      update tasks set status = 'Open'
      where client_id = new.id and status = 'N/A' and app_touched = false;
    elsif coalesce(new.vendor,'') not in ('ADP','Paycom') then
      update tasks set status = 'N/A', done_date = null
      where client_id = new.id and status = 'Open' and app_touched = false
        and template_id in (select id from task_templates
                            where name not in ('Company Setup','Time Tracking Setup (Kiosk/Mobile/Web)'));
    end if;
  end if;
  return new;
end $$;

drop trigger if exists client_vendor_rules on clients;
create trigger client_vendor_rules after update on clients
for each row execute function public.apply_vendor_checklist_rules();

-- fix: cascaded trigger updates (e.g. vendor-change auto-flips) must NOT stamp app_touched
create or replace function public.log_task_changes()
returns trigger language plpgsql security definer set search_path = public as $$
declare who text;
begin
  if new.status is distinct from old.status then
    insert into activity_log (client_id, task_id, actor_id, action, detail)
    values (new.client_id, new.id, auth.uid(), 'status',
            new.title || ': ' || old.status || ' → ' || new.status);
  end if;
  if new.assignee_id is distinct from old.assignee_id then
    select name into who from users where id = new.assignee_id;
    insert into activity_log (client_id, task_id, actor_id, action, detail)
    values (new.client_id, new.id, auth.uid(), 'assigned',
            new.title || ' → ' || coalesce(who, 'unassigned'));
  end if;
  if auth.uid() is not null and pg_trigger_depth() = 1 then
    new.app_touched := true;  -- direct human write only
  end if;
  return new;
end $$;

-- ownership model: who may update a task (status/done_date; column guard still applies)
create or replace function public.can_work_task(t_client bigint, t_template bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select is_admin()
    or exists (  -- client's implementor works implementor-owned and ad-hoc tasks
      select 1 from clients c
      left join task_templates tt on tt.id = t_template
      where c.id = t_client and c.implementor_id = auth.uid()
        and coalesce(tt.owner_team, 'Implementor') = 'Implementor')
    or exists (  -- team members work their team's tasks on any client
      select 1 from task_templates tt
      join users u on u.id = auth.uid() and u.active
      join app_config cfg on cfg.key = case tt.owner_team
            when 'Data Team' then 'team_data_team'
            when 'Tax Team'  then 'team_tax_team'
            when 'Shruti'    then 'team_pto' end
      where tt.id = t_template
        and lower(u.email) = any(string_to_array(lower(replace(cfg.value, ' ', '')), ',')))
$$;

drop policy if exists tsk_upd on tasks;
create policy tsk_upd on tasks for update to authenticated
  using (can_work_task(client_id, template_id));

commit;