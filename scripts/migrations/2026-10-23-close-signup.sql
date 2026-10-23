-- SECURITY CONTAINMENT (CISO flag via Mak, 22-23 Oct 2026). Applied live 23 Oct. Safe to re-run.
--
-- 1) The anon role holds no privileges on any table or sequence, now or later.
-- 2) Self sign-up is closed in the database: a new auth user is only created if
--    its email is listed in app_config 'allowed_signup_emails' (blank by default).
--    The dashboard "Allow new users to sign up" toggle could not be saved on
--    23 Oct, so this trigger is the control that actually holds.
--
-- To add a user: append their real @uzio.com email to allowed_signup_emails,
-- then Supabase -> Authentication -> Users -> Add user.

revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;

insert into app_config (key, value) values ('allowed_signup_emails', '')
on conflict (key) do nothing;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare admins text; allowed text;
begin
  if new.email not ilike '%@uzio.com' then
    raise exception 'Sign-ups are restricted to @uzio.com emails';
  end if;
  select value into allowed from app_config where key = 'allowed_signup_emails';
  if allowed is null or not (lower(new.email) = any(
       string_to_array(lower(replace(allowed, ' ', '')), ','))) then
    raise exception 'Sign-up is closed. Ask an admin to add you.';
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
