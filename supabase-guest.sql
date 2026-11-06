-- Student Pulse: guest login (read-only). Run in Supabase > SQL Editor AFTER supabase-update.sql.
-- Also switch on: Authentication > Sign In / Providers > "Allow anonymous sign-ins".

-- A guest is a Supabase "anonymous" user: it has a login but NO profile row.
-- Everything that writes already goes through is_ok(), so requiring a profile there locks guests out of
-- posting, commenting, voting and reporting, whatever the browser tries to send.
create or replace function is_member() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from profiles where id=auth.uid()) $$;
create or replace function is_ok() returns boolean language sql stable security definer set search_path=public as $$
  select auth.uid() is not null and is_member() and not coalesce((select banned from standing where user_id=auth.uid()),false) $$;

-- Guests do not get a profile when they appear.
create or replace function handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
declare n text := new.raw_user_meta_data->>'username'; r text := new.raw_user_meta_data->>'role'; err text;
begin
  if coalesce(new.is_anonymous, false) then return new; end if;
  err := username_error(n); if err is not null then raise exception '%', err; end if;
  insert into profiles(id,username,role) values(new.id, n, case when r in('student','teacher','staff') then r else 'student' end);
  insert into standing(user_id) values(new.id); return new;
end $$;

-- Only members can read the profiles table directly (guests still see names on posts through the board views).
drop policy if exists "see profiles" on profiles;
create policy "see profiles" on profiles for select to authenticated using(is_member());

-- "guest" is reserved so nobody can pretend to be one.
create or replace function username_error(n text) returns text language plpgsql stable security definer set search_path=public as $$
begin
  if n is null or n !~ '^[A-Za-z0-9_]{3,20}$' then return 'Username must be 3–20 letters, numbers or underscores.'; end if;
  if lower(n) in ('anonymous','guest') then return 'That username is taken.'; end if;
  if not exists(select 1 from settings where key='filter_off' and value='1')
     and (find_blocked(replace(n,'_',' ')) is not null or find_blocked(regexp_replace(replace(n,'_',' '),'[0-9]','','g')) is not null)
  then return 'That username is not allowed. Please choose another.'; end if;
  return null;
end $$;

revoke execute on function is_member() from public, anon;
grant execute on function is_member() to authenticated;
