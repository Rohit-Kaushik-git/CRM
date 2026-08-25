-- v2.1: 11-item onboarding checklist, owner teams, vendor 'New', N/A rules.
-- Run in the Supabase SQL editor. Destroys onboarding-task history (accepted).
begin;

-- vendor gains 'New' ("previous system" semantics)
alter table clients drop constraint if exists clients_vendor_check;
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

commit;
