-- DSP CRM Tracker schema. Run once in the Supabase SQL editor.
-- Re-runnable: drops and recreates everything (destroys data — fine pre-launch).

drop table if exists task_notes, tasks, task_templates, client_modules, clients, users, app_config cascade;
drop function if exists public.handle_new_user() cascade;
drop function if exists public.seed_client_tasks() cascade;

create table app_config (
  key   text primary key,
  value text not null
);
insert into app_config values ('admin_emails', 'rohit.kaushik@uzio.com');

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
  vendor              text check (vendor in ('ADP','Paycom')),
  previous_system     text,
  implementor_id      uuid references users(id),
  status              text not null default 'Not Started'
                      check (status in ('Not Started','In Progress','Live','Completed')),
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
  sort_order int  not null
);

create table tasks (
  id          bigint generated always as identity primary key,
  client_id   bigint not null references clients(id) on delete cascade,
  template_id bigint references task_templates(id),
  title       text not null,
  assignee_id uuid references users(id),
  status      text not null default 'Open' check (status in ('Open','In Progress','Done','N/A')),
  due_date    date,
  done_date   date,
  created_by  uuid references users(id),
  created_at  timestamptz not null default now(),
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
insert into task_templates (name, phase, sort_order) values
  ('Company Setup','onboarding',1),
  ('Federal/State Withholding & Payment','onboarding',2),
  ('Data Transfer','onboarding',3),
  ('Delta Data Upload','onboarding',4),
  ('Time Tracking Setup (Kiosk/Mobile/Web)','onboarding',5),
  ('Document Transfer','onboarding',6),
  ('Historical Data Download','onboarding',7),
  ('Audit Client Data & Minor Corrections','onboarding',8),
  ('Final Payroll Review & Testing','onboarding',9),
  ('Prior Pay Info Transfer & Approval','onboarding',10),
  ('PTO Balance Move','onboarding',11),
  ('Tax Review (Post Prior Upload)','onboarding',12),
  ('Credentials','audit',1),
  ('Qualified Overtime Report','audit',2),
  ('Census','audit',3),
  ('Census Delta','audit',4),
  ('Emergency Contact','audit',5),
  ('License Details','audit',6),
  ('Payment Method','audit',7),
  ('PTO Policy Creation','audit',8),
  ('PTO Balance','audit',9),
  ('SIT/FIT Withholding','audit',10),
  ('Earnings','audit',11),
  ('Deductions','audit',12),
  ('Contributions Transfer (Except Roth/401k)','audit',13),
  ('Workers Comp','audit',14),
  ('Doc Transfer','audit',15),
  ('Prior Comp Transfer & Approval','audit',16),
  ('Client Data Audit','audit',17),
  ('Historical Data Downloaded','audit',18);

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
              and lower(new.email) = any(string_to_array(replace(admins, ' ', ''), ','))
         then 'admin' else 'implementor' end
  );
  return new;
end $$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- New client hook: seed the standard checklists and the 4 module rows.
create or replace function public.seed_client_tasks()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into tasks (client_id, template_id, title)
  select new.id, t.id, t.name from task_templates t;
  insert into client_modules (client_id, module) values
    (new.id, 'TimeTracking'), (new.id, 'Payroll'), (new.id, 'Benefits'), (new.id, 'HR');
  return new;
end $$;

create trigger on_client_created
after insert on clients
for each row execute function public.seed_client_tasks();
