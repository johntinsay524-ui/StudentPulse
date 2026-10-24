// The student board, reading and writing the Supabase database.
// Posts are loaded 15 at a time, comments only when a post is opened, and votes/comments/reports update just the card you touched.
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const h = (t, a = {}, ...k) => { const e = document.createElement(t); for (const [x, v] of Object.entries(a)) { if (x === 'class') e.className = v; else if (x.startsWith('on')) e.addEventListener(x.slice(2), v); else if (v !== false && v != null) e.setAttribute(x, v === true ? '' : v); } k.flat().forEach(c => c != null && c !== false && e.append(c)); return e; };
const MOODS = { happy: '😊 Happy', meh: '😐 Meh', stressed: '😟 Stressed', upset: '😠 Frustrated' };
const REASONS = ['Bullying', 'Harassment', 'Threat or safety concern', 'Spam', 'Off-topic', 'Names a teacher', 'Other'];
const PAGE = 15;
const ago = t => { const m = Math.round((Date.now() - new Date(t)) / 6e4); return m < 1 ? 'just now' : m < 60 ? m + 'm ago' : m < 1440 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago'; };
const av = (name, url) => { const s = h('span', { class: 'av', 'data-name': name, 'aria-hidden': 'true' }); if (url) s.append(h('img', { src: url, alt: '' })); else s.textContent = name[0].toUpperCase(); return s; };
const pic = (url, cls, alt) => { const i = h('img', { class: cls, src: thumbOf(url), alt, loading: 'lazy' }); return picPath(url) ? h('a', { href: url, target: '_blank', rel: 'noopener', title: 'Open full size' }, i) : i; };
const fail = (e, title = 'Please rephrase it') => e && UI.alert(e.message, { title }) && true;

let me, posts = [], hasMore = false, seq = 0, rep = new Set(), board = 'All', sortBy = 'new', mood = 'meh', postImg = null;   // postImg / cImg hold { file, url } until sent
const open = new Set(), cImg = new Map(), cmCache = new Map();   // cmCache: post id -> its comments (loaded when the post is opened)

// ---------- loading ----------
function postQuery(from, to) {   // filtering, sorting and paging happen in the database
  let q = sb.from('posts_public').select('*');
  if (board !== 'All') q = q.eq('board', board);
  q = q.order('pinned', { ascending: false });
  if (sortBy === 'top') q = q.order('score', { ascending: false });
  else if (sortBy === 'talk') q = q.order('comment_count', { ascending: false });
  return q.order('created', { ascending: false }).order('id', { ascending: false }).range(from, to);
}
async function loadReported() {
  const { data } = await sb.from('my_reported').select('*');
  rep = new Set((data || []).map(r => r.comment_id ? 'c' + r.comment_id : 'p' + r.post_id));
}
async function loadMoods() {
  const { data } = await sb.rpc('mood_counts');
  const c = Object.fromEntries((data || []).map(r => [r.m, r.n])), total = Object.values(c).reduce((a, b) => a + b, 0);
  $$('#moodStats .bar').forEach(bar => { const n = c[bar.dataset.m] || 0; bar.querySelector('em').textContent = n; bar.querySelector('i').style.width = (total ? n / total * 100 : 0) + '%'; });
}
async function load(more = false, size = PAGE) {   // more=true adds the next page; otherwise starts again from the newest
  const mine = ++seq, from = more ? posts.length : 0;
  const [res] = await Promise.all([postQuery(from, from + size - 1), more ? null : loadReported()]);
  if (mine !== seq) return;   // a newer request replaced this one
  if (res.error) return UI.alert(res.error.message, { title: 'Could not load the board' });
  hasMore = res.data.length === size;
  const seen = new Set(more ? posts.map(x => x.id) : []);
  posts = (more ? posts : []).concat(res.data.filter(x => !seen.has(x.id)));
  render();
}
async function loadComments(ids) {   // one query for any number of posts
  const { data, error } = await sb.from('comments_public').select('*').in('post_id', ids).order('id');
  if (error) { UI.alert(error.message, { title: 'Could not load the comments' }); return; }
  const by = Object.fromEntries(ids.map(i => [i, []]));
  data.forEach(c => by[c.post_id] && by[c.post_id].push(c));
  ids.forEach(i => { cmCache.set(i, by[i]); const p = posts.find(x => x.id === i); if (p) p.comment_count = by[i].length; });
}
async function reloadPost(id) {
  const { data } = await sb.from('posts_public').select('*').eq('id', id).maybeSingle();
  const i = posts.findIndex(x => x.id === id);
  if (i >= 0) { if (data) posts[i] = data; else posts.splice(i, 1); }
  refreshCard(id);
}

// ---------- drawing ----------
function refreshCard(id) {   // redraw one post only
  const p = posts.find(x => x.id === id), el = $('#feed .post[data-id="' + id + '"]');
  if (!el) return;
  if (p) el.replaceWith(card(p)); else el.remove();
  $('#empty').hidden = posts.length > 0;
}
function paintVote(p) {      // update one post's vote buttons without redrawing it
  const el = $('#feed .post[data-id="' + p.id + '"] .vote'); if (!el) return;
  el.className = 'vote ' + (p.my_vote > 0 ? 'up' : p.my_vote < 0 ? 'down' : '');
  el.querySelector('.score').textContent = p.score;
  const [u, d] = el.querySelectorAll('button');
  u.setAttribute('aria-pressed', String(p.my_vote > 0)); d.setAttribute('aria-pressed', String(p.my_vote < 0));
}
function render() {
  $('#feed').replaceChildren(...posts.map(card), hasMore ? h('button', { class: 'morebtn', onclick: e => { e.target.disabled = true; load(true); } }, 'Load more posts') : null, $('#empty'));
  $('#empty').hidden = posts.length > 0;
  $$('#boards button, #sort button, .mood').forEach(b => b.setAttribute('aria-pressed', String(b.classList.contains('on'))));
}

// who wrote it: avatar + name (a link to the profile) + role badge. Anonymous has none of these.
function who(x) {
  if (x.anonymous || !x.author) return h('span', { class: 'n' }, 'Anonymous');
  const n = h('span', { class: 'n', role: 'link', tabindex: 0, 'data-user': x.author, title: 'View ' + x.author_display + '’s profile' }, x.author_display);
  return [av(x.author, x.author_avatar), n, x.author_role && x.author_role !== 'student' ? h('span', { class: 'rb r-' + x.author_role }, Auth.roleLabel(x.author_role)) : null];
}
function reportMenu(anchor, p, c) {
  const isCm = anchor.classList.contains('cm');
  const old = isCm ? anchor.querySelector(':scope > .rpmenu') : (anchor.nextElementSibling && anchor.nextElementSibling.classList.contains('rpmenu') ? anchor.nextElementSibling : null);
  if (old) return old.remove();
  const err = h('div', { class: 'uierr', role: 'alert' });
  const opts = REASONS.map(r => h('label', { class: 'rpopt' }, h('input', { type: 'checkbox', value: r }), r));
  const send = h('button', { type: 'button', class: 'post-btn rpsend', onclick: async () => {
    const picked = opts.map(l => l.querySelector('input')).filter(i => i.checked).map(i => i.value);
    if (!picked.length) { err.textContent = 'Choose at least one reason.'; return; }
    send.disabled = true;
    for (const reason of picked) {
      const { error } = await sb.rpc('report_item', { p: p.id, c: c ? c.id : null, reason });
      if (error) { send.disabled = false; fail(error, 'Could not send the report'); return; }
    }
    rep.add(c ? 'c' + c.id : 'p' + p.id); refreshCard(p.id);
  } }, 'Send report');
  const menu = h('div', { class: 'rpmenu', role: 'group', 'aria-label': 'Reasons for reporting' },
    h('span', { class: 'rptitle' }, 'Why are you reporting this? Choose all that apply.'),
    h('div', { class: 'rpopts' }, opts), err,
    h('div', { class: 'rpbtns' }, send, h('button', { type: 'button', class: 'rpcancel', onclick: () => menu.remove() }, 'Cancel')));
  isCm ? anchor.appendChild(menu) : anchor.after(menu);
  opts[0].querySelector('input').focus();
}
async function sendComment(p, form) {
  const input = form.querySelector('.cm-text'), text = input.value.trim(), picked = cImg.get(p.id);
  if (!text && !picked) return;
  const btn = form.querySelector('button:not([type])'); if (btn) btn.disabled = true;
  let image = '';
  try { if (picked) image = await uploadImage(picked.file); } catch (x) { if (btn) btn.disabled = false; return UI.alert(x.message, { title: 'Photo problem' }); }
  const { error } = await sb.from('comments').insert({ post_id: p.id, author_id: me.id, body: text, image, anonymous: form.querySelector('.cm-an').checked });
  if (error) { if (image) dropImage(image); if (btn) btn.disabled = false; fail(error); return; }
  cImg.delete(p.id);
  await loadComments([p.id]); refreshCard(p.id);
}
function comment(p, c) {
  return h('div', { class: 'cm' }, who(c),
    h('span', { class: 'cm-acts' }, c.edited && h('span', { class: 'edtag' }, 'edited'),
      c.mine ? [h('button', { type: 'button', onclick: async () => { const v = await UI.prompt('', { title: 'Edit comment', label: 'Your comment', value: c.body, ok: 'Save' }); if (v !== null && !fail((await sb.from('comments').update({ body: v }).eq('id', c.id)).error)) { await loadComments([p.id]); refreshCard(p.id); } } }, 'Edit'),
        h('button', { type: 'button', onclick: async () => { if (await UI.confirm('Delete this comment?', { title: 'Delete comment', ok: 'Delete', danger: true })) { const { error } = await sb.from('comments').delete().eq('id', c.id); if (!error) dropImage(c.image); await loadComments([p.id]); refreshCard(p.id); } } }, 'Delete')]
      : h('button', { type: 'button', disabled: rep.has('c' + c.id), onclick: e => reportMenu(e.target.closest('.cm'), p, c) }, rep.has('c' + c.id) ? 'Reported ✓' : '🚩 Report'),
      h('button', { type: 'button', class: 'dng remove', onclick: async () => { await sb.rpc('mod_delete_comment', { cid: c.id }); await loadComments([p.id]); refreshCard(p.id); } }, 'Remove')),
    h('br'), c.body && h('span', { class: 'txt' }, c.body), c.image && pic(c.image, 'cimg', 'Photo attached to the comment'));
}
async function toggleComments(p) {
  if (open.has(p.id)) { open.delete(p.id); return refreshCard(p.id); }
  open.add(p.id); refreshCard(p.id);   // shows "Loading comments…" until they arrive
  if (!cmCache.has(p.id)) { await loadComments([p.id]); refreshCard(p.id); }
}
function card(p) {
  const isOpen = open.has(p.id), list = cmCache.get(p.id), count = list ? list.length : (p.comment_count || 0);
  const prev = h('div', { class: 'cm-prev', hidden: !cImg.has(p.id) }, h('img', { alt: 'Preview of the photo you are adding', src: cImg.has(p.id) ? cImg.get(p.id).url : null }),
    h('button', { type: 'button', class: 'cm-rm', onclick: () => { cImg.delete(p.id); refreshCard(p.id); } }, 'Remove photo'));
  const form = h('form', { class: 'cm-form', onsubmit: e => { e.preventDefault(); sendComment(p, e.target); } },
    h('input', { class: 'cm-text', 'aria-label': 'Add a comment to: ' + p.title, placeholder: 'Add a comment', maxlength: 500 }),
    h('label', { class: 'photo-btn', title: 'Add a photo' }, '📷', h('input', { type: 'file', class: 'vh', accept: 'image/*', 'aria-label': 'Add a photo to your comment', onchange: e => {
      const f = e.target.files[0]; if (!f) return;
      if (!f.type.startsWith('image/')) return UI.alert('Please choose an image file.', { title: 'Photo problem' });
      cImg.set(p.id, { file: f, url: URL.createObjectURL(f) }); refreshCard(p.id); } })),
    h('label', { class: 'anon cm-anon' }, h('input', { type: 'checkbox', class: 'cm-an' }), ' Anonymous'), h('button', {}, 'Reply'), prev);
  const flags = [p.pinned && '📌 Pinned', p.locked && '🔒 Locked, no new comments'].filter(Boolean);
  const c = h('article', { class: 'card post', 'data-id': p.id },
    h('div', { class: 'vote ' + (p.my_vote > 0 ? 'up' : p.my_vote < 0 ? 'down' : ''), role: 'group', 'aria-label': 'Votes' },
      h('button', { 'aria-label': 'Upvote', 'aria-pressed': String(p.my_vote > 0), onclick: () => vote(p, 1) }, '▲'), h('span', { class: 'score' }, p.score),
      h('button', { 'aria-label': 'Downvote', 'aria-pressed': String(p.my_vote < 0), onclick: () => vote(p, -1) }, '▼')),
    h('div', { class: 'pb' }, flags.length && h('div', { class: 'pflags' }, flags.map(f => h('span', {}, f))),
      h('div', { class: 'meta' }, h('span', { class: 'b' }, p.board), ' · ', who(p), ' · ', ago(p.created), p.edited && h('span', { class: 'edtag' }, ' · edited'), h('span', { class: 'tag' }, MOODS[p.mood])),
      h('h2', {}, p.title), p.body && h('p', {}, p.body), p.image && pic(p.image, 'pimg', 'Photo attached to the post'),
      h('div', { class: 'acts' },
        h('button', { 'aria-expanded': String(isOpen), onclick: () => toggleComments(p) }, '💬 ' + count + ' comments'),
        p.mine ? [h('button', { onclick: () => editPost(c, p) }, '✏️ Edit'), h('button', { class: 'dng', onclick: async () => { if (await UI.confirm('This cannot be undone. Its comments and photos are deleted too.', { title: 'Delete this post?', ok: 'Delete', danger: true })) { const { error } = await sb.from('posts').delete().eq('id', p.id); if (!error) dropImage(p.image); removeLocal(p.id); } } }, 'Delete')]
          : h('button', { disabled: rep.has('p' + p.id), 'aria-label': 'Report post: ' + p.title, onclick: e => reportMenu(e.target.closest('.acts'), p) }, rep.has('p' + p.id) ? 'Reported ✓' : 'Report'),
        h('button', { class: 'dng remove', onclick: async () => { await sb.rpc('mod_delete_post', { pid: p.id }); removeLocal(p.id); } }, 'Remove')),
      h('div', { class: 'cmts', hidden: !isOpen }, h('div', { class: 'cm-list' }, isOpen ? (list ? list.map(x => comment(p, x)) : h('p', { class: 'hint' }, 'Loading comments…')) : null), !p.locked && form)));
  return c;
}
function removeLocal(id) {   // a post was deleted: drop just that card
  posts = posts.filter(x => x.id !== id); open.delete(id); cmCache.delete(id);
  const el = $('#feed .post[data-id="' + id + '"]'); if (el) el.remove();
  $('#empty').hidden = posts.length > 0; loadMoods();
}
function editPost(c, p) {
  const t = h('input', { value: p.title, maxlength: 120, 'aria-label': 'Post title' }), b = h('textarea', { 'aria-label': 'Post text' }); b.value = p.body;
  c.querySelector('h2').replaceWith(h('form', { class: 'edit-form', onsubmit: async e => { e.preventDefault(); if (!fail((await sb.from('posts').update({ title: t.value.trim(), body: b.value.trim() }).eq('id', p.id)).error)) reloadPost(p.id); } },
    t, b, h('div', { class: 'btns' }, h('button', { class: 'post-btn' }, 'Save'), h('button', { type: 'button', class: 'ed-cancel', onclick: () => refreshCard(p.id) }, 'Cancel'))));
  const old = c.querySelector('.pb > p'); if (old) old.remove(); t.focus();
}
async function vote(p, v) {   // the buttons change instantly; the database catches up in the background
  if (p.voting) return; p.voting = true;
  const prev = { my_vote: p.my_vote, score: p.score }, next = p.my_vote === v ? 0 : v;
  p.score += next - p.my_vote; p.my_vote = next; paintVote(p);
  const { error } = await (next === 0 ? sb.from('votes').delete().match({ post_id: p.id, user_id: me.id }) : sb.from('votes').upsert({ post_id: p.id, user_id: me.id, v: next }));
  p.voting = false;
  if (error) { Object.assign(p, prev); paintVote(p); fail(error, 'Could not save your vote'); }
}
const showPrev = (box, url) => { box.querySelector('img').src = url; box.hidden = false; };

document.addEventListener('click', e => {
  const n = e.target.closest('.meta .n[data-user], .cm .n[data-user], .av'); if (n) { const u = n.dataset.user || n.dataset.name; if (u && u !== 'Anonymous') location.href = 'profile.html?user=' + encodeURIComponent(u); return; }
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.b) { board = t.dataset.b; $$('#boards button').forEach(b => b.classList.toggle('on', b === t)); load(); }
  else if (t.dataset.s) { sortBy = t.dataset.s; $$('#sort button').forEach(b => b.classList.toggle('on', b === t)); load(); }
  else if (t.dataset.m) { mood = t.dataset.m; $$('.mood').forEach(b => b.classList.toggle('on', b === t)); $$('.mood').forEach(b => b.setAttribute('aria-pressed', String(b === t))); }
  else if (t.id === 'modBtn') { document.body.classList.toggle('mod'); t.classList.toggle('on'); }
  else if (t.id === 'rmPostImg') { postImg = null; $('#postPrev').hidden = true; $('#postFile').value = ''; }
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('.n[role="link"]')) e.target.click(); });
$('#postFile').addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  if (!f.type.startsWith('image/')) { UI.alert('Please choose an image file.', { title: 'Photo problem' }); e.target.value = ''; return; }
  postImg = { file: f, url: URL.createObjectURL(f) }; showPrev($('#postPrev'), postImg.url);
});
$('#form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = e.target.querySelector('.post-btn'); btn.disabled = true;
  let image = '';
  try { if (postImg) image = await uploadImage(postImg.file); } catch (x) { btn.disabled = false; return UI.alert(x.message, { title: 'Photo problem' }); }
  const { error } = await sb.from('posts').insert({ board: $('#bd').value, mood, title: $('#t').value.trim(), body: $('#b').value.trim(), image, anonymous: $('#an').checked, author_id: me.id });
  btn.disabled = false;
  if (error) { if (image) dropImage(image); fail(error); return; }
  e.target.reset(); postImg = null; $('#postPrev').hidden = true;
  load(); loadMoods();
});
const logout = async () => { await sb.auth.signOut(); Auth.logout(); };
$('#logoutBtn').addEventListener('click', logout);

// Warnings and bans: shown to the student as soon as they open the board, and re-checked every 30 seconds
async function checkStanding() {
  const { data } = await sb.rpc('my_standing'); if (!data) return;
  if (data.banned) { await UI.alert('A moderator has banned this account, so you can no longer use the board.', { title: 'Account banned' }); return logout(); }
  let bar = $('#warnbar');
  if (data.warns) {
    if (!bar) { bar = h('div', { class: 'storewarn', id: 'warnbar' }); document.body.prepend(bar); }
    bar.textContent = 'A moderator has warned you ' + data.warns + (data.warns === 1 ? ' time' : ' times') + '. Please follow the board rules.';
  } else if (bar) bar.remove();
  const key = 'sp_warns_seen_' + me.id, seen = +(Store.get(key) || 0);
  Store.set(key, String(data.warns));
  if (data.warns > seen) UI.alert('A moderator has warned you' + (data.reason ? ': ' + data.reason : '.') + ' Please follow the board rules. If you think this is a mistake, speak to a moderator.', { title: 'You have received a warning' });
}

(async () => {   // start: who is logged in, and are they allowed in?
  const { data: { session } } = await sb.auth.getSession(); if (!session) return Auth.logout();
  const [{ data: p }, { data: st }] = await Promise.all([sb.from('profiles').select('*').eq('id', session.user.id).single(), sb.from('standing').select('*').eq('user_id', session.user.id).single()]);
  if (!p || (st && st.banned)) return logout();
  me = p; $('#who').textContent = p.display || p.username; $('#who').prepend(av(p.username, p.avatar));
  if (p.role === 'moderator') { $('#adminLink').hidden = false; $('#modBtn').hidden = false; }
  await Promise.all([load(), loadMoods()]);
  checkStanding();
  // Every 30 seconds, quietly pick up other students' activity (only the posts already on screen, plus any open comments)
  setInterval(async () => {
    if (!document.hidden) checkStanding();
    if (document.hidden || $$('#feed input[type=text],#feed .cm-text,#feed textarea,#feed .rpmenu').some(i => i.value || i === document.activeElement || i.classList.contains('rpmenu'))) return;
    if (open.size) await loadComments([...open]);
    await load(false, Math.max(posts.length, PAGE)); loadMoods();
  }, 30000);
})();
