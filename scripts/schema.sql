-- DSP CRM Tracker schema. Run once in the Supabase SQL editor.
-- Re-runnable: drops and recreates everything (destroys data — fine pre-launch).

drop table if exists client_notes, activity_log, task_notes, tasks, task_templates, client_modules, clients, users, app_config cascade;
drop function if exists public.handle_new_user() cascade;
drop function if exists public.seed_client_tasks() cascade;

create table app_config (
  key   text primary key,
  value text not null
);
insert into app_config values ('admin_emails', 'rohit.kaushik@uzio.com');
insert into app_config values
  ('team_data_team', 'shobhit.sharma@uzio.com,rohit.kaushik@uzio.com'),
  ('team_tax_team', ''),
  ('team_pto', '');

create table users (
  id     uuid primary key references auth.users(id) on delete cascade,
  name   text not null default '',
  email  text not null unique,
  role   text not null default 'implementor' check (role in ('admin','implementor')),
  active boolean not null default true
);

create table clients (
  id                  bigint generated always as identity primary key,
  dsp_name            text not null unique,
  short_code          text not null default '',
  vendor              text check (vendor in ('ADP','Paycom','New')),
  previous_system     text,
  implementor_id      uuid references users(id),
  status              text not null default 'Not Started'
                      check (status in ('Not Started','In Progress','Live','Completed','Cancelled','On Hold','Unresponsive')),
  tt_live_date        date,
  payroll_cutoff_date date,
  first_pay_date      date,
  rag                 text check (rag in ('R','A','G')),
  notes               text,
  created_at          timestamptz not null default now()
);

create table client_modules (
  id            bigint generated always as identity primary key,
  client_id     bigint not null references clients(id) on delete cascade,
  module        text not null check (module in ('TimeTracking','Payroll','Benefits','HR')),
  opted         boolean not null default false,
  training_done boolean not null default false,
  training_date date,
  unique (client_id, module)
);

create table task_templates (
  id         bigint generated always as identity primary key,
  name       text not null,
  phase      text not null check (phase in ('onboarding','audit')),
  sort_order int  not null,
  owner_team text not null default 'Implementor' check (owner_team in ('Implementor','Data Team','Tax Team','Shruti'))
);

create table tasks (
  id          bigint generated always as identity primary key,
  client_id   bigint not null references clients(id) on delete cascade,
  template_id bigint references task_templates(id),
  title       text not null,
  assignee_id uuid references users(id),
  status      text not null default 'Open' check (status in ('Open','In Progress','Done','N/A')),
  due_date    date,
  assigned_team text check (assigned_team in ('Data Team','Tax Team','Shruti')),
  done_date   date,
  created_by  uuid references users(id),
  created_at  timestamptz not null default now(),
  app_touched boolean not null default false,
  unique (client_id, template_id)
);

create table task_notes (
  id         bigint generated always as identity primary key,
  task_id    bigint not null references tasks(id) on delete cascade,
  author_id  uuid references users(id),
  note       text not null,
  created_at timestamptz not null default now()
);

-- Standard checklists (spec §3). Onboarding from the Onboarding Tracker columns,
-- audit from the Audit Tracker columns.
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
  ('Document Transfer','onboarding',11,'Data Team'),
  ('Census Audit','audit',1,'Implementor'),
  ('Withholding Audit','audit',2,'Data Team'),
  ('Payment Audit','audit',3,'Implementor'),
  ('Prior Payroll Audit','audit',4,'Data Team'),
  ('Deduction Audit','audit',5,'Data Team'),
  ('Emergency Contact Audit','audit',6,'Implementor');

-- Sign-up hook: reject non-uzio emails, mirror into public.users, role from admin list.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare admins text;
begin
  if new.email not ilike '%@uzio.com' then
    raise exception 'Sign-ups are restricted to @uzio.com emails';
  end if;
  select value into admins from app_config where key = 'admin_emails';
  insert into public.users (id, email, name, role) values (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    case when admins is not null
              and lower(new.email) = any(string_to_array(lower(replace(admins, ' ', '')), ','))
         then 'admin' else 'implementor' end
  );
  return new;
end $$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- New client hook: seed the standard checklists (right status up front) and the 4 module rows.
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

create trigger on_client_created
after insert on clients
for each row execute function public.seed_client_tasks();

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

create table if not exists activity_log (
  id         bigint generated always as identity primary key,
  client_id  bigint not null references clients(id) on delete cascade,
  task_id    bigint references tasks(id) on delete set null,
  actor_id   uuid references users(id) on delete set null,
  action     text not null,
  detail     text not null default '',
  created_at timestamptz not null default now()
);

-- BEFORE UPDATE on tasks: log status/assignee changes; human writers mark the task app-touched
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
            new.title || ' → ' || coalesce(who, 'auto'));
  end if;
  if new.assigned_team is distinct from old.assigned_team then
    insert into activity_log (client_id, task_id, actor_id, action, detail)
    values (new.client_id, new.id, auth.uid(), 'assigned',
            new.title || ' → ' || coalesce(new.assigned_team, 'auto'));
  end if;
  if auth.uid() is not null and pg_trigger_depth() = 1 then
    new.app_touched := true;  -- direct human write only
  end if;
  return new;
end $$;

drop trigger if exists task_activity on tasks;
create trigger task_activity before update on tasks
for each row execute function public.log_task_changes();

-- AFTER INSERT on task_notes: log the note; human authors mark the task app-touched
create or replace function public.log_note_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare t record;
begin
  select id, client_id, title into t from tasks where id = new.task_id;
  insert into activity_log (client_id, task_id, actor_id, action, detail)
  values (t.client_id, t.id, new.author_id, 'note', t.title || ': ' || new.note);
  if auth.uid() is not null then
    update tasks set app_touched = true where id = new.task_id and not app_touched;
  end if;
  return new;
end $$;

drop trigger if exists note_activity on task_notes;
create trigger note_activity after insert on task_notes
for each row execute function public.log_note_insert();

-- clients: log creation and status/RAG changes
create or replace function public.log_client_changes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into activity_log (client_id, actor_id, action, detail)
    values (new.id, auth.uid(), 'client_created', new.dsp_name);
    return new;
  end if;
  if new.status is distinct from old.status then
    insert into activity_log (client_id, actor_id, action, detail)
    values (new.id, auth.uid(), 'client', 'Status: ' || old.status || ' → ' || new.status);
  end if;
  if new.rag is distinct from old.rag then
    insert into activity_log (client_id, actor_id, action, detail)
    values (new.id, auth.uid(), 'client',
            'RAG: ' || coalesce(old.rag, '—') || ' → ' || coalesce(new.rag, '—'));
  end if;
  return new;
end $$;

drop trigger if exists client_activity_ins on clients;
create trigger client_activity_ins after insert on clients
for each row execute function public.log_client_changes();
drop trigger if exists client_activity_upd on clients;
create trigger client_activity_upd after update on clients
for each row execute function public.log_client_changes();

create or replace view client_last_activity with (security_invoker = true) as
select client_id, max(created_at) as last_activity
from activity_log
group by client_id;

-- company- and module-level note history (append-only, like task_notes)
create table if not exists client_notes (
  id         bigint generated always as identity primary key,
  client_id  bigint not null references clients(id) on delete cascade,
  scope      text not null default 'Company'
             check (scope in ('Company','TimeTracking','Payroll','Benefits','HR')),
  author_id  uuid references users(id) on delete set null,
  note       text not null,
  created_at timestamptz not null default now()
);

create or replace function public.log_client_note_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into activity_log (client_id, actor_id, action, detail)
  values (new.client_id, new.author_id, 'note',
          case when new.scope = 'Company' then new.note
               else new.scope || ': ' || new.note end);
  return new;
end $$;

drop trigger if exists client_note_activity on client_notes;
create trigger client_note_activity after insert on client_notes
for each row execute function public.log_client_note_insert();
