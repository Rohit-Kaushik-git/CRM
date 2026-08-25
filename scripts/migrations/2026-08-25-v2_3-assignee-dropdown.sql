-- v2.3: explicit per-task assignment (person or team) over the derived default.
begin;

alter table tasks add column if not exists assigned_team text
  check (assigned_team in ('Data Team','Tax Team','Shruti'));

-- Rohit joins Shobhit on the Data Team
update app_config set value = 'shobhit.sharma@uzio.com,rohit.kaushik@uzio.com'
  where key = 'team_data_team';

-- membership helper (shared by RLS below)
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

-- new signature: explicit assignment wins, derived default otherwise
drop policy if exists tsk_upd on tasks;
drop function if exists public.can_work_task(bigint, bigint);
create or replace function public.can_work_task(
  t_client bigint, t_template bigint, t_assignee uuid, t_team text)
returns boolean language sql stable security definer set search_path = public as $$
  select is_admin()
    or t_assignee = auth.uid()
    or (t_team is not null and in_team(t_team))
    or (t_assignee is null and t_team is null and (
      exists (
        select 1 from clients c
        left join task_templates tt on tt.id = t_template
        where c.id = t_client and c.implementor_id = auth.uid()
          and coalesce(tt.owner_team, 'Implementor') = 'Implementor')
      or exists (
        select 1 from task_templates tt
        where tt.id = t_template and tt.owner_team <> 'Implementor'
          and in_team(tt.owner_team))))
$$;
create policy tsk_upd on tasks for update to authenticated
  using (can_work_task(client_id, template_id, assignee_id, assigned_team));

-- column guard: non-admins may not change assignment
create or replace function public.enforce_task_update_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not is_admin() then
    if new.title       is distinct from old.title
       or new.client_id   is distinct from old.client_id
       or new.template_id is distinct from old.template_id
       or new.assignee_id is distinct from old.assignee_id
       or new.assigned_team is distinct from old.assigned_team
       or new.due_date    is distinct from old.due_date
       or new.created_by  is distinct from old.created_by
       or new.created_at  is distinct from old.created_at then
      raise exception 'Implementors may only change task status';
    end if;
  end if;
  return new;
end $$;

-- activity: log team assignment changes too
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

commit;

notify pgrst, 'reload schema';
