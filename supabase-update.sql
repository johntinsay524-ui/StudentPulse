-- Student Pulse update: unbypassable word filter + make moderators from the website.
-- Paste the whole file into Supabase > SQL Editor > Run. Safe to run more than once.
-- Run it AFTER supabase-schema.sql.

-- 1. Text columns can never be NULL (a NULL body used to skip the filter on the title).
update posts set body='' where body is null;       update posts set image='' where image is null;
update comments set body='' where body is null;    update comments set image='' where image is null;
alter table posts    alter column body set default '', alter column body set not null, alter column image set default '', alter column image set not null;
alter table comments alter column body set default '', alter column body set not null, alter column image set default '', alter column image set not null;
alter table posts drop constraint if exists posts_body_len;
alter table posts add constraint posts_body_len check(char_length(body)<=5000) not valid;

-- 2. Text normaliser. Returns 3 versions of the text that the filter checks:
--    [1] punctuation -> spaces      "id-iot", "idiot!!"
--    [2] punctuation removed        "i.d.i.o.t", "id_iot"
--    [3] single letters joined      "i d i o t", "s h u t  u p"
--    Before that it removes invisible characters and accents, folds fullwidth letters,
--    maps look-alike Cyrillic/Greek letters, undoes leetspeak (1d10t, $tupid, !diot)
--    and collapses repeated letters (iddiiot).
create or replace function sp_variants(t text) returns text[] language plpgsql stable set search_path=public as $$
declare s text; v1 text; v2 text; v3 text; r text := ''; run text := ''; x text;
begin
  if char_length(coalesce(t,'')) > 20000 then raise exception 'That text is too long.'; end if;
  s := lower(regexp_replace(normalize(coalesce(t,''), NFKD),
       '[\u0300-\u036f\u00ad\u034f\u115f\u1160\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2800\u3164\ufe00-\ufe0f\ufeff]', '', 'g'));
  s := translate(s, 'аеорсухіјѕкнтмαεορικνυτı', 'aeopcyxijskhtmaeopikvuti');   -- look-alike letters
  s := regexp_replace(s, '([a-z])[!|]([a-z])', '\1i\2', 'g');                    -- b!tch, id|ot (only inside a word)
  s := translate(s, '013457@$', 'oieastas');                                       -- leetspeak
  s := translate(s, 'l', 'i');                                                     -- l, 1, i, ! all count as the same letter
  v1 := trim(regexp_replace(s, '[^[:alnum:]]+', ' ', 'g'));
  v2 := trim(regexp_replace(regexp_replace(s, '[^[:alnum:][:space:]]', '', 'g'), '\s+', ' ', 'g'));
  foreach x in array string_to_array(v1, ' ') loop
    if char_length(x) = 1 then run := run || x;
    else
      if run <> '' then r := r || ' ' || run; run := ''; end if;
      r := r || ' ' || x;
    end if;
  end loop;
  if run <> '' then r := r || ' ' || run; end if;
  v3 := trim(r);
  return array[regexp_replace(v1,'(.)\1+','\1','g'), regexp_replace(v2,'(.)\1+','\1','g'), regexp_replace(v3,'(.)\1+','\1','g')];
end $$;

-- 3. The matcher: whole words (so "closer" is fine, "loser" is not), with simple endings (-s, -ed, -ing, -er).
create or replace function find_blocked(t text) returns text language plpgsql stable security definer set search_path=public as $$
declare w text; vs text[]; term text; terms text[]; t1 text; v text;
begin
  vs := sp_variants(t);
  if vs[1] = '' and vs[2] = '' then return null; end if;
  for w in select word from words loop
    term := (sp_variants(w))[1];
    continue when term is null or term = '';
    terms := array[term];
    if position(' ' in term) > 0 then terms := terms || replace(term, ' ', ''); end if;   -- "shut up" also blocks "shutup"
    foreach t1 in array terms loop
      foreach v in array vs loop
        if v ~ ('(^| )' || t1 || '(s|es|ed|er|ers|ing)?( |$)') then return w; end if;
      end loop;
    end loop;
  end loop;
  return null;
end $$;

create or replace function check_words(t text) returns void language plpgsql security definer set search_path=public as $$
declare w text;
begin
  if is_mod() or exists(select 1 from settings where key='filter_off' and value='1') then return; end if;
  w := find_blocked(t);
  if w is not null then raise exception 'Your text includes “%”, which is not allowed on this board. Please rephrase it.', w; end if;
end $$;

-- 4. Usernames go through the filter too (also catches idiot123).
create or replace function username_error(n text) returns text language plpgsql stable security definer set search_path=public as $$
begin
  if n is null or n !~ '^[A-Za-z0-9_]{3,20}$' then return 'Username must be 3–20 letters, numbers or underscores.'; end if;
  if lower(n) = 'anonymous' then return 'That username is taken.'; end if;
  if not exists(select 1 from settings where key='filter_off' and value='1')
     and (find_blocked(replace(n,'_',' ')) is not null or find_blocked(regexp_replace(replace(n,'_',' '),'[0-9]','','g')) is not null)
  then return 'That username is not allowed. Please choose another.'; end if;
  return null;
end $$;

create or replace function handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
declare n text := new.raw_user_meta_data->>'username'; r text := new.raw_user_meta_data->>'role'; err text;
begin
  err := username_error(n); if err is not null then raise exception '%', err; end if;
  insert into profiles(id,username,role) values(new.id, n, case when r in('student','teacher','staff') then r else 'student' end);
  insert into standing(user_id) values(new.id); return new;
end $$;

create or replace function rename_me(n text) returns void language plpgsql security definer set search_path=public as $$
declare err text;
begin
  err := username_error(n); if err is not null then raise exception '%', err; end if;
  if exists(select 1 from profiles where username=n and id<>auth.uid()) then raise exception 'That username is taken.'; end if;
  update profiles set username=n where id=auth.uid();
end $$;

-- 5. Triggers: check title and body separately, never skip on NULL. They run with owner rights,
--    so students no longer need (and no longer have) permission to call the filter directly.
create or replace function guard_post() returns trigger language plpgsql security definer set search_path=public as $$ begin
  if not is_ok() then raise exception 'Your account cannot post.'; end if;
  perform check_words(new.title); perform check_words(new.body);
  if tg_op='UPDATE' and (new.title,new.body,new.image) is distinct from (old.title,old.body,old.image) then new.edited:=true; end if;
  return new; end $$;
create or replace function guard_comment() returns trigger language plpgsql security definer set search_path=public as $$ begin
  if not is_ok() then raise exception 'Your account cannot comment.'; end if;
  if tg_op='INSERT' and exists(select 1 from posts where id=new.post_id and locked) then raise exception 'This post is locked.'; end if;
  if new.body='' and new.image='' then raise exception 'A comment cannot be empty.'; end if;
  perform check_words(new.body);
  if tg_op='UPDATE' and (new.body,new.image) is distinct from (old.body,old.image) then new.edited:=true; end if;
  return new; end $$;
create or replace function guard_profile() returns trigger language plpgsql security definer set search_path=public as $$ begin
  perform check_words(coalesce(new.display,'')); perform check_words(coalesce(new.bio,''));
  if new.display is not null and exists(select 1 from profiles where id<>new.id and username=new.display) then raise exception 'That name is already used by someone else.'; end if;
  return new; end $$;

-- 6. Moderators: manage the word list and test it (the list itself is still hidden from students).
create or replace function set_words(on_ boolean, list text[]) returns void language plpgsql security definer set search_path=public as $$
declare w text; clean text[] := '{}';
begin perform must_mod();
  if coalesce(array_length(list,1),0) > 200 then raise exception 'The list can hold at most 200 entries.'; end if;
  for w in select distinct lower(regexp_replace(trim(x),'\s+',' ','g')) from unnest(list) x loop
    if char_length(w) not between 2 and 40 or (sp_variants(w))[1] = '' then raise exception '“%” must be 2–40 characters and contain a letter or number.', w; end if;
    clean := clean || w;
  end loop;
  delete from words where true; insert into words select unnest(clean) on conflict do nothing;
  insert into settings values('filter_off', case when on_ then '0' else '1' end) on conflict(key) do update set value=excluded.value;
  perform log_mod('updated the word filter');
end $$;
create or replace function test_words(t text) returns text language plpgsql stable security definer set search_path=public as $$
begin perform must_mod(); return find_blocked(t); end $$;

-- 7. Make someone a moderator (or change any role) from the website. Only moderators can call it.
create or replace function set_role(uname text, new_role text) returns void language plpgsql security definer set search_path=public as $$
declare u profiles; me text := my_name();
begin perform must_mod();
  if new_role not in('student','teacher','staff','moderator') then raise exception 'Unknown role.'; end if;
  select * into u from profiles where username=uname;
  if u.id is null then raise exception 'Account not found.'; end if;
  if u.id = auth.uid() then raise exception 'You cannot change your own role.'; end if;
  if u.role = new_role then return; end if;
  if new_role='moderator' and exists(select 1 from standing where user_id=u.id and banned) then raise exception 'Unban this account before making it a moderator.'; end if;
  update profiles set role=new_role where id=u.id;
  insert into history(user_id,by,act,reason) values(u.id, me, 'role', new_role);
  perform log_mod(case when new_role='moderator' then 'made '||uname||' a moderator'
                       when u.role='moderator' then 'removed moderator rights from '||uname||' (now '||new_role||')'
                       else 'changed the role of '||uname||' to '||new_role end);
end $$;

-- 8. Bug fix: "outcome" was both a column and a parameter, so resolving a report failed.
create or replace function mod_resolve(rid bigint, outcome text) returns void language plpgsql security definer set search_path=public as $$ begin perform must_mod();
  update reports set status='done', outcome=$2 where id=$1; perform log_mod('resolved report #'||$1||': '||$2); end $$;

-- 9. Permissions
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
grant execute on function username_free(text), username_error(text) to anon;
revoke execute on function check_words(text), find_blocked(text), sp_variants(text) from authenticated;   -- students cannot probe the filter directly
