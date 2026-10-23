// The student board, reading and writing the Supabase database (replaces script.js).
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const h = (t, a = {}, ...k) => { const e = document.createElement(t); for (const [x, v] of Object.entries(a)) { if (x === 'class') e.className = v; else if (x.startsWith('on')) e.addEventListener(x.slice(2), v); else if (v !== false && v != null) e.setAttribute(x, v === true ? '' : v); } k.flat().forEach(c => c != null && c !== false && e.append(c)); return e; };
const MOODS = { happy: '😊 Happy', meh: '😐 Meh', stressed: '😟 Stressed', upset: '😠 Frustrated' };
const REASONS = ['Bullying', 'Harassment', 'Threat or safety concern', 'Spam', 'Off-topic', 'Names a teacher', 'Other'];
const ago = t => { const m = Math.round((Date.now() - new Date(t)) / 6e4); return m < 1 ? 'just now' : m < 60 ? m + 'm ago' : m < 1440 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago'; };
const fail = e => e && UI.alert(e.message, { title: 'Please rephrase it' }) && true;
let me, posts = [], rep = new Set(), board = 'All', sortBy = 'new', mood = 'meh', postImg = '';
const open = new Set(), cImg = new Map();

// who wrote it: avatar + name (a link to the profile) + role badge. Anonymous has none of these.
function who(x) {
  if (x.anonymous || !x.author) return h('span', { class: 'n' }, 'Anonymous');
  const n = h('span', { class: 'n', role: 'link', tabindex: 0, 'data-user': x.author, title: 'View ' + x.author_display + '’s profile' }, x.author_display);
  return [Auth.avatar(x.author), n, x.author_role && x.author_role !== 'student' ? h('span', { class: 'rb r-' + x.author_role }, Auth.roleLabel(x.author_role)) : null];
}
function reportMenu(anchor, p, c) {
  if (anchor.nextElementSibling && anchor.nextElementSibling.classList.contains('rpmenu')) return anchor.nextElementSibling.remove();
  anchor.after(h('div', { class: 'rpmenu' }, h('span', {}, 'Why are you reporting this?'), REASONS.map(r => h('button', { type: 'button', onclick: async () => {
    const { error } = await sb.rpc('report_item', { p: p.id, c: c ? c.id : null, reason: r }); if (!fail(error)) load(); } }, r))));
}
async function sendComment(p, form) {
  const input = form.querySelector('.cm-text'), text = input.value.trim(), img = cImg.get(p.id) || '';
  if (!text && !img) return;
  const { error } = await sb.from('comments').insert({ post_id: p.id, author_id: me.id, body: text, image: img, anonymous: form.querySelector('.cm-an').checked });
  if (fail(error)) return; cImg.delete(p.id); load();
}
function comment(p, c) {
  return h('div', { class: 'cm' }, who(c),
    h('span', { class: 'cm-acts' }, c.edited && h('span', { class: 'edtag' }, 'edited'),
      c.mine ? [h('button', { type: 'button', onclick: async () => { const v = await UI.prompt('', { title: 'Edit comment', label: 'Your comment', value: c.body, ok: 'Save' }); if (v !== null && !fail((await sb.from('comments').update({ body: v }).eq('id', c.id)).error)) load(); } }, 'Edit'),
        h('button', { type: 'button', onclick: async () => { if (await UI.confirm('Delete this comment?', { title: 'Delete comment', ok: 'Delete', danger: true })) { await sb.from('comments').delete().eq('id', c.id); load(); } } }, 'Delete')]
      : h('button', { type: 'button', disabled: rep.has('c' + c.id), onclick: e => reportMenu(e.target.closest('.cm'), p, c) }, rep.has('c' + c.id) ? 'Reported ✓' : '🚩 Report'),
      h('button', { type: 'button', class: 'dng remove', onclick: async () => { await sb.rpc('mod_delete_comment', { cid: c.id }); load(); } }, 'Remove')),
    h('br'), c.body && h('span', { class: 'txt' }, c.body), c.image && h('img', { class: 'cimg', src: c.image, alt: 'Photo attached to the comment' }));
}
function card(p) {
  const prev = h('div', { class: 'cm-prev', hidden: !cImg.has(p.id) }, h('img', { alt: 'Preview of the photo you are adding', src: cImg.get(p.id) || null }),
    h('button', { type: 'button', class: 'cm-rm', onclick: () => { cImg.delete(p.id); load(); } }, 'Remove photo'));
  const form = h('form', { class: 'cm-form', onsubmit: e => { e.preventDefault(); sendComment(p, e.target); } },
    h('input', { class: 'cm-text', 'aria-label': 'Add a comment to: ' + p.title, placeholder: 'Add a comment', maxlength: 500 }),
    h('label', { class: 'photo-btn', title: 'Add a photo' }, '📷', h('input', { type: 'file', class: 'vh', accept: 'image/*', 'aria-label': 'Add a photo to your comment', onchange: async e => {
      try { cImg.set(p.id, await readImage(e.target.files[0])); load(); } catch (x) { UI.alert(x.message, { title: 'Photo problem' }); } } })),
    h('label', { class: 'anon cm-anon' }, h('input', { type: 'checkbox', class: 'cm-an' }), ' Anonymous'), h('button', {}, 'Reply'), prev);
  const flags = [p.pinned && '📌 Pinned', p.locked && '🔒 Locked, no new comments'].filter(Boolean);
  const c = h('article', { class: 'card post' },
    h('div', { class: 'vote ' + (p.my_vote > 0 ? 'up' : p.my_vote < 0 ? 'down' : ''), role: 'group', 'aria-label': 'Votes' },
      h('button', { 'aria-label': 'Upvote', 'aria-pressed': p.my_vote > 0, onclick: () => vote(p, 1) }, '▲'), h('span', { class: 'score' }, p.score),
      h('button', { 'aria-label': 'Downvote', 'aria-pressed': p.my_vote < 0, onclick: () => vote(p, -1) }, '▼')),
    h('div', { class: 'pb' }, flags.length && h('div', { class: 'pflags' }, flags.map(f => h('span', {}, f))),
      h('div', { class: 'meta' }, h('span', { class: 'b' }, p.board), ' · ', who(p), ' · ', ago(p.created), p.edited && h('span', { class: 'edtag' }, ' · edited'), h('span', { class: 'tag' }, MOODS[p.mood])),
      h('h2', {}, p.title), p.body && h('p', {}, p.body), p.image && h('img', { class: 'pimg', src: p.image, alt: 'Photo attached to the post' }),
      h('div', { class: 'acts' },
        h('button', { 'aria-expanded': open.has(p.id), onclick: () => { open.has(p.id) ? open.delete(p.id) : open.add(p.id); render(); } }, '💬 ' + p.cms.length + ' comments'),
        p.mine ? [h('button', { onclick: () => editPost(c, p) }, '✏️ Edit'), h('button', { class: 'dng', onclick: async () => { if (await UI.confirm('This cannot be undone. Its comments and photos are deleted too.', { title: 'Delete this post?', ok: 'Delete', danger: true })) { await sb.from('posts').delete().eq('id', p.id); load(); } } }, 'Delete')]
          : h('button', { disabled: rep.has('p' + p.id), 'aria-label': 'Report post: ' + p.title, onclick: e => reportMenu(e.target.closest('.acts'), p) }, rep.has('p' + p.id) ? 'Reported ✓' : 'Report'),
        h('button', { class: 'dng remove', onclick: async () => { await sb.rpc('mod_delete_post', { pid: p.id }); load(); } }, 'Remove')),
      h('div', { class: 'cmts', hidden: !open.has(p.id) }, h('div', { class: 'cm-list' }, p.cms.map(x => comment(p, x))), !p.locked && form)));
  return c;
}
function editPost(c, p) {
  const t = h('input', { value: p.title, maxlength: 120, 'aria-label': 'Post title' }), b = h('textarea', { 'aria-label': 'Post text' }); b.value = p.body;
  c.querySelector('h2').replaceWith(h('form', { class: 'edit-form', onsubmit: async e => { e.preventDefault(); if (!fail((await sb.from('posts').update({ title: t.value.trim(), body: b.value.trim() }).eq('id', p.id)).error)) load(); } },
    t, b, h('div', { class: 'btns' }, h('button', { class: 'post-btn' }, 'Save'), h('button', { type: 'button', class: 'ed-cancel', onclick: load }, 'Cancel'))));
  const old = c.querySelector('.pb > p'); if (old) old.remove(); t.focus();
}
async function vote(p, v) {
  await (p.my_vote === v ? sb.from('votes').delete().match({ post_id: p.id, user_id: me.id }) : sb.from('votes').upsert({ post_id: p.id, user_id: me.id, v })); load();
}
function render() {
  const sorters = { new: (a, b) => new Date(b.created) - new Date(a.created), top: (a, b) => b.score - a.score || sorters.new(a, b), talk: (a, b) => b.cms.length - a.cms.length || sorters.new(a, b) };
  const shown = posts.filter(p => board === 'All' || p.board === board).sort((a, b) => (b.pinned - a.pinned) || sorters[sortBy](a, b));
  $('#feed').replaceChildren(...shown.map(card), $('#empty')); $('#empty').hidden = shown.length > 0;
  $$('#moodStats .bar').forEach(bar => { const n = posts.filter(p => p.mood === bar.dataset.m).length; bar.querySelector('em').textContent = n; bar.querySelector('i').style.width = (posts.length ? n / posts.length * 100 : 0) + '%'; });
  $$('#boards button, #sort button, .mood').forEach(b => b.setAttribute('aria-pressed', String(b.classList.contains('on'))));
}
async function load() {
  const [a, b, c] = await Promise.all([sb.from('posts_public').select('*'), sb.from('comments_public').select('*').order('id'), sb.from('my_reported').select('*')]);
  if (a.error) return UI.alert(a.error.message, { title: 'Could not load the board' });
  const cm = {}; (b.data || []).forEach(x => (cm[x.post_id] ??= []).push(x));
  posts = a.data.map(p => ({ ...p, cms: cm[p.id] || [] })); rep = new Set((c.data || []).map(r => r.comment_id ? 'c' + r.comment_id : 'p' + r.post_id)); render();
}
const showPrev = (box, url) => { box.querySelector('img').src = url; box.hidden = false; };

document.addEventListener('click', e => {
  const n = e.target.closest('.meta .n[data-user], .cm .n[data-user], .av'); if (n) { const u = n.dataset.user || n.dataset.name; if (u && u !== 'Anonymous') location.href = 'profile.html?user=' + encodeURIComponent(u); return; }
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.b) { board = t.dataset.b; $$('#boards button').forEach(b => b.classList.toggle('on', b === t)); render(); }
  else if (t.dataset.s) { sortBy = t.dataset.s; $$('#sort button').forEach(b => b.classList.toggle('on', b === t)); render(); }
  else if (t.dataset.m) { mood = t.dataset.m; $$('.mood').forEach(b => b.classList.toggle('on', b === t)); render(); }
  else if (t.id === 'modBtn') { document.body.classList.toggle('mod'); t.classList.toggle('on'); }
  else if (t.id === 'rmPostImg') { postImg = ''; $('#postPrev').hidden = true; $('#postFile').value = ''; }
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('.n[role="link"]')) e.target.click(); });
$('#postFile').addEventListener('change', async e => { try { postImg = await readImage(e.target.files[0]); showPrev($('#postPrev'), postImg); } catch (x) { UI.alert(x.message, { title: 'Photo problem' }); e.target.value = ''; } });
$('#form').addEventListener('submit', async e => {
  e.preventDefault();
  const { error } = await sb.from('posts').insert({ board: $('#bd').value, mood, title: $('#t').value.trim(), body: $('#b').value.trim(), image: postImg, anonymous: $('#an').checked, author_id: me.id });
  if (fail(error)) return; e.target.reset(); postImg = ''; $('#postPrev').hidden = true; load();
});
const logout = async () => { await sb.auth.signOut(); Auth.logout(); };
$('#logoutBtn').addEventListener('click', logout);

(async () => {   // start: who is logged in, and are they allowed in?
  const { data: { session } } = await sb.auth.getSession(); if (!session) return Auth.logout();
  const [{ data: p }, { data: st }] = await Promise.all([sb.from('profiles').select('*').eq('id', session.user.id).single(), sb.from('standing').select('*').eq('user_id', session.user.id).single()]);
  if (!p || (st && st.banned)) return logout();
  me = p; $('#who').textContent = p.display || p.username; $('#who').prepend(Auth.avatar(p.username));
  if (p.role === 'moderator') { $('#adminLink').hidden = false; $('#modBtn').hidden = false; }
  if (st && st.warns) document.body.prepend(h('div', { class: 'storewarn' }, 'A moderator has warned you ' + st.warns + (st.warns === 1 ? ' time' : ' times') + '. Please follow the board rules.'));
  await load();
  setInterval(() => { if (!document.hidden && !$$('#feed input[type=text],#feed .cm-text,#feed textarea').some(i => i.value || i === document.activeElement)) load(); }, 20000);   // pick up other students' posts
})();
