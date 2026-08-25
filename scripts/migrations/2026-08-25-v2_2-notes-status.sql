-- v2.2: richer client lifecycle + client/module note history. Run in the SQL editor.
begin;

-- clients.status gains lifecycle states (sheet's RAG column carries these)
do $drop$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'clients'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) like '%status%';
  if c is not null then execute format('alter table clients drop constraint %I', c); end if;
end $drop$;
alter table clients add constraint clients_status_check
  check (status in ('Not Started','In Progress','Live','Completed','Cancelled','On Hold','Unresponsive'));

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
alter table client_notes enable row level security;
drop policy if exists cnotes_read on client_notes;
create policy cnotes_read on client_notes for select to authenticated using (true);
drop policy if exists cnotes_ins on client_notes;
create policy cnotes_ins on client_notes for insert to authenticated
  with check (author_id = auth.uid());

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

commit;
