-- Student Pulse database for Supabase. Paste the whole file into Dashboard > SQL Editor > Run.
create extension if not exists citext;

create table profiles(id uuid primary key references auth.users on delete cascade, username citext unique not null, display text,
  role text not null default 'student' check(role in('student','teacher','staff','moderator')), bio text default '', avatar text default '', joined timestamptz default now(), welcomed boolean default false);
create unique index on profiles(lower(display)) where display is not null;
create table standing(user_id uuid primary key references profiles on delete cascade, warns int default 0, banned boolean default false, ban_reason text, banned_by text, banned_at timestamptz);
create table history(id bigserial primary key, user_id uuid references profiles on delete cascade, t timestamptz default now(), by text, act text, reason text);
create table posts(id bigserial primary key, board text not null check(board in('Events','Campus life','Academics','Facilities','Suggestions')), mood text not null check(mood in('happy','meh','stressed','upset')),
  title text not null check(char_length(title) between 1 and 120), body text default '', image text default '', author_id uuid references profiles on delete set null,
  anonymous boolean default false, created timestamptz default now(), edited boolean default false, pinned boolean default false, locked boolean default false);
create table comments(id bigserial primary key, post_id bigint not null references posts on delete cascade, author_id uuid references profiles on delete set null,
  anonymous boolean default false, body text default '' check(char_length(body)<=500), image text default '', created timestamptz default now(), edited boolean default false);
create table votes(post_id bigint references posts on delete cascade, user_id uuid references profiles on delete cascade, v smallint check(v in(1,-1)), primary key(post_id,user_id));
create table reports(id bigserial primary key, post_id bigint references posts on delete cascade, comment_id bigint references comments on delete cascade,
  reasons text[] default '{}', reporters uuid[] default '{}', status text default 'open', outcome text, revealed text, created timestamptz default now());
create table mod_log(id bigserial primary key, who text, text text, t timestamptz default now());
create table words(word text primary key);
create table settings(key text primary key, value text);
insert into words values('idiot'),('stupid'),('loser'),('dumb'),('shut up'),('kill yourself');

-- helpers
create function is_mod() returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from profiles where id=auth.uid() and role='moderator') $$;
create function is_ok() returns boolean language sql stable security definer set search_path=public as $$ select auth.uid() is not null and not coalesce((select banned from standing where user_id=auth.uid()),false) $$;
create function must_mod() returns void language plpgsql stable as $$ begin if not is_mod() then raise exception 'Moderators only.'; end if; end $$;
create function my_name() returns text language sql stable security definer set search_path=public as $$ select username::text from profiles where id=auth.uid() $$;
create function log_mod(t text) returns void language sql security definer set search_path=public as $$ insert into mod_log(who,text) values(my_name(),t) $$;

-- sign-up: every new account is a student; the username comes from the sign-up form
create function handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
declare n text := new.raw_user_meta_data->>'username';
begin
  if n is null or n !~ '^[A-Za-z0-9_]{3,20}$' or lower(n)='anonymous' then raise exception 'Username must be 3–20 letters, numbers or underscores.'; end if;
  insert into profiles(id,username) values(new.id,n); insert into standing(user_id) values(new.id); return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();
create function username_free(n text) returns boolean language sql security definer set search_path=public as $$ select not exists(select 1 from profiles where username=n) and lower(n)<>'anonymous' $$;

-- banned-words filter (moderators exempt) and "edited" labels, enforced in the database
create function check_words(t text) returns void language plpgsql security definer set search_path=public as $$
declare w text;
begin
  if is_mod() or exists(select 1 from settings where key='filter_off' and value='1') then return; end if;
  for w in select word from words loop
    if (' '||lower(regexp_replace(coalesce(t,''),'\s+',' ','g'))||' ') ~ ('[^[:alnum:]]'||regexp_replace(lower(w),'([.*+?^${}()|\[\]\\])','\\\1','g')||'(?=[^[:alnum:]])')
    then raise exception 'Your text includes “%”, which is not allowed on this board. Please rephrase it.', w; end if;
  end loop;
end $$;
create function guard_post() returns trigger language plpgsql as $$ begin
  if not is_ok() then raise exception 'Your account cannot post.'; end if;
  perform check_words(new.title||' '||new.body);
  if tg_op='UPDATE' and (new.title,new.body,new.image) is distinct from (old.title,old.body,old.image) then new.edited:=true; end if;
  return new; end $$;
create trigger t_post before insert or update on posts for each row execute function guard_post();
create function post_vote() returns trigger language plpgsql security definer set search_path=public as $$ begin
  insert into votes values(new.id,new.author_id,1); return new; end $$;   -- your own post starts with your upvote
create trigger t_post_vote after insert on posts for each row execute function post_vote();
create function guard_comment() returns trigger language plpgsql as $$ begin
  if not is_ok() then raise exception 'Your account cannot comment.'; end if;
  if tg_op='INSERT' and exists(select 1 from posts where id=new.post_id and locked) then raise exception 'This post is locked.'; end if;
  if new.body='' and new.image='' then raise exception 'A comment cannot be empty.'; end if;
  perform check_words(new.body);
  if tg_op='UPDATE' and (new.body,new.image) is distinct from (old.body,old.image) then new.edited:=true; end if;
  return new; end $$;
create trigger t_comment before insert or update on comments for each row execute function guard_comment();
create function guard_profile() returns trigger language plpgsql as $$ begin
  perform check_words(coalesce(new.display,'')||' '||coalesce(new.bio,''));
  if new.display is not null and exists(select 1 from profiles where id<>new.id and username=new.display) then raise exception 'That name is already used by someone else.'; end if;
  return new; end $$;
create trigger t_profile before update on profiles for each row execute function guard_profile();

-- row level security: who can touch which rows
alter table profiles enable row level security; alter table standing enable row level security; alter table history enable row level security;
alter table posts enable row level security; alter table comments enable row level security; alter table votes enable row level security;
alter table reports enable row level security; alter table mod_log enable row level security; alter table words enable row level security; alter table settings enable row level security;
create policy "see profiles" on profiles for select to authenticated using(true);
create policy "edit own profile" on profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
create policy "own standing or mod" on standing for select to authenticated using(user_id=auth.uid() or is_mod());
create policy "mods read history" on history for select to authenticated using(is_mod());
create policy "mods read log" on mod_log for select to authenticated using(is_mod());
create policy "mods read words" on words for select to authenticated using(is_mod());
create policy "mods read settings" on settings for select to authenticated using(is_mod());
-- posts and comments: base tables show only your own rows; everyone else reads through the views below, which hide anonymous authors
create policy "own posts" on posts for select to authenticated using(author_id=auth.uid());
create policy "write posts" on posts for insert to authenticated with check(author_id=auth.uid() and is_ok());
create policy "edit posts" on posts for update to authenticated using(author_id=auth.uid());
create policy "delete posts" on posts for delete to authenticated using(author_id=auth.uid());
create policy "own comments" on comments for select to authenticated using(author_id=auth.uid());
create policy "write comments" on comments for insert to authenticated with check(author_id=auth.uid() and is_ok());
create policy "edit comments" on comments for update to authenticated using(author_id=auth.uid());
create policy "delete comments" on comments for delete to authenticated using(author_id=auth.uid());
create policy "own votes" on votes for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid() and is_ok());
revoke update on profiles, posts, comments from authenticated;
grant update(display,bio,avatar,welcomed) on profiles to authenticated;
grant update(title,body,image) on posts to authenticated;
grant update(body,image) on comments to authenticated;

-- what the board reads: anonymous authors are hidden from everyone except themselves
create view posts_public as select p.id,p.board,p.mood,p.title,p.body,p.image,
  case when p.anonymous then null else u.username::text end as author, case when p.anonymous then null else coalesce(u.display,u.username::text) end as author_display,
  case when p.anonymous then null else u.role end as author_role, p.anonymous, coalesce(p.author_id=auth.uid(),false) as mine, p.created,p.edited,p.pinned,p.locked,
  coalesce((select sum(v) from votes x where x.post_id=p.id),0)::int as score, coalesce((select v from votes x where x.post_id=p.id and x.user_id=auth.uid()),0)::int as my_vote
  from posts p left join profiles u on u.id=p.author_id where auth.uid() is not null;
create view comments_public as select c.id,c.post_id,c.body,c.image,
  case when c.anonymous then null else u.username::text end as author, case when c.anonymous then null else coalesce(u.display,u.username::text) end as author_display,
  case when c.anonymous then null else u.role end as author_role, c.anonymous, coalesce(c.author_id=auth.uid(),false) as mine, c.created,c.edited
  from comments c left join profiles u on u.id=c.author_id where auth.uid() is not null;
create view my_reported as select post_id,comment_id from reports where status='open' and auth.uid()=any(reporters);

-- actions that need more rights than a normal row policy allows
create function report_item(p bigint, c bigint, reason text) returns void language plpgsql security definer set search_path=public as $$
declare r reports; aid uuid;
begin
  if not is_ok() then raise exception 'Please log in.'; end if;
  select case when c is null then (select author_id from posts where id=p) else (select author_id from comments where id=c and post_id=p) end into aid;
  if aid=auth.uid() then raise exception 'You cannot report your own post or comment.'; end if;
  select * into r from reports where post_id=p and comment_id is not distinct from c and status='open';
  if r.id is null then insert into reports(post_id,comment_id,reasons,reporters) values(p,c,array[reason],array[auth.uid()]);
  else update reports set reasons=(select array_agg(distinct x) from unnest(r.reasons||reason) x), reporters=(select array_agg(distinct x) from unnest(r.reporters||auth.uid()) x) where id=r.id; end if;
end $$;
create function rename_me(n text) returns void language plpgsql security definer set search_path=public as $$ begin
  if n !~ '^[A-Za-z0-9_]{3,20}$' or lower(n)='anonymous' then raise exception 'Username must be 3–20 letters, numbers or underscores.'; end if;
  if exists(select 1 from profiles where username=n and id<>auth.uid()) then raise exception 'That username is taken.'; end if;
  update profiles set username=n where id=auth.uid(); end $$;
create function delete_me() returns void language plpgsql security definer set search_path=public as $$ begin
  if is_mod() then raise exception 'Moderator accounts cannot be deleted here.'; end if;
  delete from auth.users where id=auth.uid(); end $$;   -- posts and comments stay, shown as Anonymous
create function mod_users() returns jsonb language plpgsql security definer set search_path=public as $$ begin perform must_mod();
  return coalesce((select jsonb_agg(jsonb_build_object('name',p.username,'role',p.role,'joined',p.joined,'warns',s.warns,'banned',s.banned,'banReason',s.ban_reason,'bannedBy',s.banned_by,'bannedAt',s.banned_at,
    'posts',(select count(*) from posts x where x.author_id=p.id),
    'history',(select coalesce(jsonb_agg(jsonb_build_object('t',h.t,'by',h.by,'act',h.act,'reason',h.reason) order by h.id),'[]') from history h where h.user_id=p.id)) order by p.joined)
    from profiles p join standing s on s.user_id=p.id),'[]'::jsonb); end $$;
create function mod_action(uname text, act text, note text default '', new_role text default null) returns void language plpgsql security definer set search_path=public as $$
declare u profiles; me text := my_name();
begin perform must_mod();
  select * into u from profiles where username=uname; if u.id is null or u.role='moderator' then raise exception 'Account not found.'; end if;
  if act='warn' then update standing set warns=warns+1 where user_id=u.id;
  elsif act='unwarn' then update standing set warns=greatest(warns-1,0) where user_id=u.id;
  elsif act='ban' then if coalesce(trim(note),'')='' then raise exception 'Please write a reason.'; end if; update standing set banned=true,ban_reason=note,banned_by=me,banned_at=now() where user_id=u.id;
  elsif act='unban' then update standing set banned=false,ban_reason=null,banned_by=null,banned_at=null where user_id=u.id;
  elsif act='role' and new_role in('student','teacher','staff') then update profiles set role=new_role where id=u.id;
  else raise exception 'Unknown action.'; end if;
  insert into history(user_id,by,act,reason) values(u.id,me,act,note); perform log_mod(act||' '||uname||coalesce(' — '||nullif(note,''),''));
end $$;
create function mod_reports() returns jsonb language plpgsql security definer set search_path=public as $$ begin perform must_mod();
  return coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'postId',r.post_id,'commentId',r.comment_id,'title',p.title,'board',p.board,'excerpt',left(coalesce(c.body,''),80),'reasons',r.reasons,
    'reporters',(select jsonb_agg(u.username) from profiles u where u.id=any(r.reporters)),'status',r.status,'outcome',r.outcome,'created',r.created,
    'author',coalesce(r.revealed,case when x.an then 'Anonymous' else coalesce(au.username::text,'Deleted user') end),'revealed',r.revealed is not null,
    'canReveal',x.an and r.revealed is null and x.aid is not null and r.reasons && array['Bullying','Harassment','Threat or safety concern']) order by r.id desc)
    from reports r join posts p on p.id=r.post_id left join comments c on c.id=r.comment_id
    cross join lateral (select case when r.comment_id is null then p.anonymous else c.anonymous end as an, case when r.comment_id is null then p.author_id else c.author_id end as aid) x
    left join profiles au on au.id=x.aid),'[]'::jsonb); end $$;
create function mod_reveal(rid bigint) returns text language plpgsql security definer set search_path=public as $$
declare r reports; nm text;
begin perform must_mod(); select * into r from reports where id=rid;
  if r.id is null or not (r.reasons && array['Bullying','Harassment','Threat or safety concern']) then raise exception 'Only reports for bullying, harassment or threats allow this.'; end if;
  select u.username::text into nm from profiles u where u.id=(case when r.comment_id is null then (select author_id from posts where id=r.post_id) else (select author_id from comments where id=r.comment_id) end);
  if nm is null then raise exception 'The author could not be found.'; end if;
  update reports set revealed=nm where id=rid; perform log_mod('revealed the author of an anonymous '||case when r.comment_id is null then 'post' else 'comment' end||' (report #'||rid||')'); return nm;
end $$;
create function mod_resolve(rid bigint, outcome text) returns void language plpgsql security definer set search_path=public as $$ begin perform must_mod();
  update reports set status='done',outcome=outcome where id=rid; perform log_mod('resolved report #'||rid||': '||outcome); end $$;
create function mod_flag(pid bigint, k text) returns void language plpgsql security definer set search_path=public as $$ begin perform must_mod();
  if k='locked' then update posts set locked=not locked where id=pid; else update posts set pinned=not pinned where id=pid; end if; perform log_mod('toggled '||k||' on post #'||pid); end $$;
create function mod_delete_post(pid bigint) returns void language plpgsql security definer set search_path=public as $$ begin perform must_mod();
  delete from posts where id=pid; perform log_mod('deleted post #'||pid); end $$;
create function mod_delete_comment(cid bigint) returns void language plpgsql security definer set search_path=public as $$ begin perform must_mod();
  delete from comments where id=cid; perform log_mod('deleted comment #'||cid); end $$;
create function set_words(on_ boolean, list text[]) returns void language plpgsql security definer set search_path=public as $$ begin perform must_mod();
  delete from words where true; insert into words select distinct lower(trim(w)) from unnest(list) w where char_length(trim(w)) between 2 and 40;
  insert into settings values('filter_off',case when on_ then '0' else '1' end) on conflict(key) do update set value=excluded.value; perform log_mod('updated the word filter'); end $$;
create function mod_reset() returns void language plpgsql security definer set search_path=public as $$ begin perform must_mod();
  delete from reports where true; delete from posts where true; delete from mod_log where true; end $$;

-- lock everything down for logged-out visitors; open only what logged-in users need
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from public, anon;
grant execute on function username_free(text) to anon;
grant execute on all functions in schema public to authenticated;
grant select on posts_public, comments_public, my_reported to authenticated;

-- After you sign up the first account on the site, make it a moderator (change the name):
-- update profiles set role='moderator' where username='YOUR_USERNAME';
