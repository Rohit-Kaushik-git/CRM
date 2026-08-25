-- v2: sync conflict-rule support + activity timeline. Run in the Supabase SQL editor.
-- Safe to re-run.
begin;

alter table tasks add column if not exists app_touched boolean not null default false;

create table if not exists activity_log (
  id         bigint generated always as identity primary key,
  client_id  bigint not null references clients(id) on delete cascade,
  task_id    bigint references tasks(id) on delete set null,
  actor_id   uuid references users(id) on delete set null,
  action     text not null,
  detail     text not null default '',
  created_at timestamptz not null default now()
);

alter table activity_log enable row level security;
drop policy if exists act_read on activity_log;
create policy act_read on activity_log for select to authenticated using (true);
-- no insert/update/delete policies: rows come only from security-definer triggers

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
            new.title || ' → ' || coalesce(who, 'unassigned'));
  end if;
  if auth.uid() is not null then
    new.app_touched := true;
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
  if new.author_id is not null then
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

commit;
