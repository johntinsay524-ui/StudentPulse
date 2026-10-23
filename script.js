// The posts and comments live in index.html.
// This file handles clicking, posting (with photos), and saving.

const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

let board  = 'All';
let sortBy = 'new';
let mood   = 'meh';
let nextId = 100;
let postImg = '';                 // photo attached to the post being written
const pending = new WeakMap();    // photo attached to a comment being written (per comment form)

// Who is logged in? Moderator tools only appear for moderators.
const me = Auth.session();
$('#who').textContent = (Auth.profile(me.name) || {}).display || me.name;
$('#who').prepend(Auth.avatar(me.name));
if (me.role === 'moderator') { $('#adminLink').hidden = false; $('#modBtn').hidden = false; }
$('#logoutBtn').addEventListener('click', Auth.logout);

const feed = $('#feed');

// Posts, comments and photos are saved in this browser so they survive a refresh.
const FEED_KEY = 'studentpulse_feed_v2';
const saved = Store.get(FEED_KEY);
if (saved) feed.innerHTML = saved;
$$('.cmts').forEach(c => c.hidden = true);
nextId = Math.max(nextId, ...$$('.post').map(p => +p.dataset.id + 1));

const REASONS = ['Bullying', 'Harassment', 'Threat or safety concern', 'Spam', 'Off-topic', 'Names a teacher', 'Other'];

// A moderator may have warned you
const st = Auth.standing(me.name);
if (st.warns) {
  const d = document.createElement('div');
  d.className = 'storewarn';
  d.textContent = 'A moderator has warned you ' + st.warns + (st.warns === 1 ? ' time' : ' times') + '. Please follow the board rules.';
  document.body.prepend(d);
}

// Pinned / locked badges (set from the moderator page)
function renderFlags(p) {
  const old = p.querySelector('.pflags'); if (old) old.remove();
  const f = [];
  if (p.dataset.pinned === '1') f.push('📌 Pinned');
  if (p.dataset.locked === '1') f.push('🔒 Locked, no new comments');
  if (f.length) {
    const d = document.createElement('div');
    d.className = 'pflags';
    d.innerHTML = f.map(x => '<span>' + x + '</span>').join('');
    p.querySelector('.pb').prepend(d);
  }
  const form = p.querySelector('.cm-form');
  if (form) form.hidden = p.dataset.locked === '1';
}

const cmCount = p => p.querySelectorAll('.cm').length;

// Votes: each post remembers who upvoted / downvoted (data-up, data-down = usernames)
const voters = (p, k) => (p.dataset[k] || '').split(',').filter(Boolean);
const score  = p => voters(p, 'up').length - voters(p, 'down').length;
const meKey  = me.name.toLowerCase();

// Who wrote it? Anonymous posts/comments keep their real author hidden in data-owner
// (never shown to students; used for edit/delete and for moderator reveal on serious reports).
const nameOf    = n => (n.dataset.user || n.textContent).trim();
const postOwner = p => (p.dataset.owner || nameOf(p.querySelector('.meta .n'))).toLowerCase();
const cmOwner   = c => (c.dataset.owner || nameOf(c.querySelector('.n'))).toLowerCase();
let reportedSet = new Set();   // posts and comments I have already reported

// Banned-words filter: stops the text and tells the student which word to change
function blocked(...texts) {
  const w = Filter.check(texts.join(' \n '));
  if (w) UI.alert(Filter.message(w), { title: 'Please rephrase' });
  return !!w;
}

// Change or remove the photo while editing a post or comment. The choice is kept on the form
// (form._photo: undefined = keep, '' = remove, otherwise the new picture) and applied when you press Save.
function addPhotoEdit(form, current, before) {
  const row = document.createElement('div');
  row.className = 'ed-photo';
  row.innerHTML = '<img class="ed-prev" alt="Photo preview" hidden><label class="photo-btn">📷 <span class="pl"></span><input type="file" accept="image/*" class="vh"></label><button type="button" class="ed-rmphoto">Remove photo</button><span class="ed-note" role="status"></span>';
  const img = row.querySelector('img'), note = row.querySelector('.ed-note'), rm = row.querySelector('.ed-rmphoto'), pl = row.querySelector('.pl');
  form._photo = undefined;
  const paint = () => {
    const shown = form._photo === undefined ? current : form._photo;
    if (shown) { img.src = shown; img.hidden = false; } else { img.removeAttribute('src'); img.hidden = true; }
    pl.textContent = shown ? 'Change photo' : 'Add photo';
    rm.hidden = !shown;
    note.textContent = form._photo === undefined ? '' : form._photo === '' ? 'The photo will be removed when you save.' : 'New photo chosen. Press Save to apply it.';
  };
  row.querySelector('input').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    try { form._photo = await readImage(file); paint(); }
    catch (err) { UI.alert(err.message, { title: 'Photo problem' }); }
    e.target.value = '';
  });
  rm.addEventListener('click', () => { form._photo = ''; paint(); });
  paint();
  before ? form.insertBefore(row, before) : form.appendChild(row);
}
function applyPhoto(form, holder, cls, alt, putBefore) {      // returns true if the photo changed
  if (form._photo === undefined) return false;
  const old = holder.querySelector('.' + cls);
  if (form._photo === '') { if (old) old.remove(); }
  else if (old) old.src = form._photo;
  else { const im = document.createElement('img'); im.className = cls; im.src = form._photo; im.alt = alt; putBefore ? putBefore.before(im) : holder.appendChild(im); }
  return true;
}

// Edit / delete buttons (own posts and comments only) and the "edited" labels.
// These are drawn fresh each time and never saved with the posts.
function renderOwn(p) {
  const acts = p.querySelector('.acts');
  acts.querySelectorAll('.own').forEach(x => x.remove());
  if (postOwner(p) === meKey) {
    const rm = acts.querySelector('.remove');
    rm.insertAdjacentHTML('beforebegin', '<button class="own" data-a="ed">✏️ Edit</button><button class="own dng" data-a="del">Delete</button>');
  }
  const meta = p.querySelector('.meta');
  meta.querySelectorAll('.edtag').forEach(x => x.remove());
  if (p.dataset.edited === '1') {
    const s = document.createElement('span');
    s.className = 'edtag'; s.textContent = ' · edited';
    const tag = meta.querySelector('.tag');
    tag ? tag.before(s) : meta.appendChild(s);
  }
  p.querySelectorAll('.cm').forEach(renderCm);
  const cf = p.querySelector('.cm-form');            // posts saved before anonymous comments existed
  if (cf && !cf.querySelector('.cm-an')) {
    const reply = cf.querySelector('button:not([type])');
    if (reply) reply.insertAdjacentHTML('beforebegin', '<label class="anon cm-anon" title="Other students will not see your name"><input type="checkbox" class="cm-an"> Anonymous</label>');
  }
  const cc = p.querySelector('.cm-count'); if (cc) cc.textContent = cmCount(p);

  // accessibility: give repeated buttons and fields names that make sense on their own
  const title = p.querySelector('h2').textContent;
  const tg = p.querySelector('[data-a="cm"]');
  if (tg) tg.setAttribute('aria-expanded', String(!p.querySelector('.cmts').hidden));
  const rb = p.querySelector('[data-a="rp"]'); if (rb) rb.setAttribute('aria-label', (rb.disabled ? 'Already reported: ' : 'Report post: ') + title);
  const eb = p.querySelector('[data-a="ed"]'); if (eb) eb.setAttribute('aria-label', 'Edit post: ' + title);
  const db = p.querySelector('.own[data-a="del"]'); if (db) db.setAttribute('aria-label', 'Delete post: ' + title);
  const ci = p.querySelector('.cm-text'); if (ci) ci.setAttribute('aria-label', 'Add a comment to: ' + title);
  p.querySelectorAll('.cm-file').forEach(i => { i.hidden = false; i.classList.add('vh'); i.setAttribute('aria-label', 'Add a photo to your comment'); });
  p.querySelectorAll('.cm-rm').forEach(i => i.setAttribute('aria-label', 'Remove the photo from your comment'));
}
function renderCm(c) {
  if (!c.dataset.cid) c.dataset.cid = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);   // every comment gets an id so it can be reported
  c.querySelectorAll('.cm-acts').forEach(x => x.remove());
  const s = document.createElement('span');
  s.className = 'cm-acts';
  const by = nameOf(c.querySelector('.n'));
  if (c.dataset.edited === '1') s.innerHTML = '<span class="edtag">edited</span>';
  if (cmOwner(c) === meKey) s.insertAdjacentHTML('beforeend', '<button type="button" data-ca="ed" aria-label="Edit your comment">Edit</button><button type="button" data-ca="del" aria-label="Delete your comment">Delete</button>');
  else { const done = reportedSet.has(c.dataset.cid); s.insertAdjacentHTML('beforeend', '<button type="button" data-ca="rp" aria-label="' + (done ? 'Already reported: comment by ' : 'Report comment by ') + by + '"' + (done ? ' disabled' : '') + '>' + (done ? 'Reported ✓' : '🚩 Report') + '</button>'); }
  if (s.childNodes.length) { const n = c.querySelector('.n'), rb = n.nextElementSibling; (rb && rb.classList.contains('rb') ? rb : n).after(s); }
}

// Inline editing
function endPostEdit(p) {
  p.querySelectorAll('.pb > .edit-form').forEach(x => x.remove());
  p.querySelectorAll('.pb > [data-editing]').forEach(x => { x.hidden = false; x.removeAttribute('data-editing'); });
}
function editPost(p) {
  if (p.querySelector('.pb > .edit-form')) return;
  const h = p.querySelector('h2'), body = p.querySelector('.pb > p');
  const f = document.createElement('form');
  f.className = 'edit-form';
  f.innerHTML = '<input class="ed-t" maxlength="120" required><textarea class="ed-b" placeholder="Tell us more (optional)"></textarea><div class="btns"><button class="post-btn">Save</button><button type="button" class="ed-cancel">Cancel</button></div>';
  f.querySelector('.ed-t').value = h.textContent;
  f.querySelector('.ed-b').value = body ? body.textContent : '';
  f.querySelector('.ed-t').setAttribute('aria-label', 'Post title'); f.querySelector('.ed-b').setAttribute('aria-label', 'Post text');
  const pic = p.querySelector('.pimg');
  addPhotoEdit(f, pic ? pic.getAttribute('src') : '', f.querySelector('.btns'));
  [h, body].forEach(x => { if (x) { x.hidden = true; x.dataset.editing = '1'; } });
  h.after(f);
  f.querySelector('.ed-t').focus();
}
function endCmEdit(c) {
  c.querySelectorAll('.cm-editform').forEach(x => x.remove());
  c.querySelectorAll('[data-editing]').forEach(x => { x.hidden = false; x.removeAttribute('data-editing'); });
}
function editComment(c) {
  if (c.querySelector('.cm-editform')) return;
  const txt = c.querySelector('.txt');
  const f = document.createElement('form');
  f.className = 'cm-editform';
  f.innerHTML = '<input class="ed-c" maxlength="500"><button>Save</button><button type="button" class="ed-cancel">Cancel</button>';
  f.querySelector('.ed-c').value = txt ? txt.textContent : '';
  f.querySelector('.ed-c').setAttribute('aria-label', 'Edit your comment');
  const cim = c.querySelector('.cimg');
  addPhotoEdit(f, cim ? cim.getAttribute('src') : '', null);
  if (txt) { txt.hidden = true; txt.dataset.editing = '1'; }
  (txt || c.querySelector('.cm-acts') || c.querySelector('.n')).after(f);
  f.querySelector('.ed-c').focus();
}

function renderVote(p) {
  let v = p.querySelector('.vote');
  if (!v) {
    v = document.createElement('div');
    v.className = 'vote';
    v.innerHTML = '<button data-vote="up" title="Upvote" aria-label="Upvote">▲</button><span class="score">0</span><button data-vote="down" title="Downvote" aria-label="Downvote">▼</button>';
    p.prepend(v);
  }
  const mine = voters(p, 'up').includes(meKey) ? 'up' : voters(p, 'down').includes(meKey) ? 'down' : '';
  v.classList.toggle('up', mine === 'up');
  v.classList.toggle('down', mine === 'down');
  v.querySelector('.score').textContent = score(p);
  v.setAttribute('role', 'group'); v.setAttribute('aria-label', 'Votes');
  v.querySelector('[data-vote="up"]').setAttribute('aria-pressed', String(mine === 'up'));
  v.querySelector('[data-vote="down"]').setAttribute('aria-pressed', String(mine === 'down'));
}
let warnedFull = false;

function showPrev(box, url) { box.querySelector('img').src = url; box.hidden = false; }
function clearPrev(box)     { box.querySelector('img').removeAttribute('src'); box.hidden = true; }

// Tell screen readers which board / sort / mood button is selected
function syncPressed() {
  $$('#boards button, #sort button, .mood').forEach(b => b.setAttribute('aria-pressed', String(b.classList.contains('on'))));
}

// Show/hide by board, sort the feed, update the mood chart, save
function refresh() {
  const posts = $$('.post');
  posts.forEach(renderVote);
  posts.forEach(renderFlags);
  const reported = Mod.reportedBy(me.name);
  reportedSet = reported;
  posts.forEach(p => {
    const b = p.querySelector('[data-a="rp"]');
    if (b) { const r = reported.has(p.dataset.id); b.textContent = r ? 'Reported ✓' : 'Report'; b.disabled = r; }
  });
  posts.forEach(p => p.hidden = !(board === 'All' || p.dataset.board === board));

  const sorters = {
    new:  (a, b) => b.dataset.id - a.dataset.id,
    top:  (a, b) => score(b) - score(a) || b.dataset.id - a.dataset.id,
    talk: (a, b) => cmCount(b) - cmCount(a) || b.dataset.id - a.dataset.id
  };
  const pin = p => p.dataset.pinned === '1' ? 1 : 0;
  [...posts].sort((a, b) => pin(b) - pin(a) || sorters[sortBy](a, b)).forEach(p => feed.appendChild(p));
  feed.appendChild($('#empty'));
  $('#empty').hidden = posts.some(p => !p.hidden);

  $$('#moodStats .bar').forEach(bar => {
    const n = posts.filter(p => p.dataset.mood === bar.dataset.m).length;
    bar.querySelector('em').textContent = n;
    bar.querySelector('i').style.width = (posts.length ? n / posts.length * 100 : 0) + '%';
  });

  Auth.decorate('.meta .n, .cm .n', true);   // profile pictures beside names
  posts.forEach(renderOwn);                    // edit/delete buttons and "edited" labels
  syncPressed();
  $$('.meta .n, .cm .n').forEach(n => {         // names are keyboard-friendly links (except Anonymous)
    if (nameOf(n) === 'Anonymous') { n.removeAttribute('role'); n.removeAttribute('tabindex'); n.removeAttribute('title'); }
    else { n.setAttribute('role', 'link'); n.tabIndex = 0; n.title = 'View ' + n.textContent + '’s profile'; }
  });

  // Save (without any half-finished photo previews, which would waste space)
  const copy = feed.cloneNode(true);
  copy.querySelectorAll('.rpmenu, .pflags, .own, .edtag, .cm-acts, .edit-form, .cm-editform').forEach(x => x.remove());
  copy.querySelectorAll('[data-editing]').forEach(x => { x.hidden = false; x.removeAttribute('data-editing'); });   // never save a half-finished edit
  copy.querySelectorAll('.n[data-user]').forEach(x => { x.textContent = x.dataset.user; x.removeAttribute('data-user'); });   // save real usernames, not display names
  copy.querySelectorAll('.av, .rb').forEach(x => x.remove());   // pictures are looked up fresh, never saved in posts
  copy.querySelectorAll('.cm-prev').forEach(x => { x.hidden = true; x.querySelector('img').removeAttribute('src'); });
  if (!Store.set(FEED_KEY, copy.innerHTML) && Store.ok && !warnedFull) {
    warnedFull = true;
    UI.alert('The browser has no space left to save this. Try a smaller picture, or ask a moderator to remove some posts with photos.', { title: 'Out of space' });
  }
}

// Clicks
document.addEventListener('click', async e => {
  // Clicking a name opens that student's profile
  const author = e.target.closest('.meta .n, .cm .n, .av');
  if (author) {
    const name = (author.dataset.user || author.dataset.name || author.textContent).trim();
    if (name !== 'Anonymous') location.href = 'profile.html?user=' + encodeURIComponent(name);
    return;
  }

  const t = e.target.closest('button');
  if (!t) return;

  if (t.dataset.b) {
    board = t.dataset.b;
    $$('#boards button').forEach(b => b.classList.toggle('on', b === t));
    refresh();
  } else if (t.dataset.s) {
    sortBy = t.dataset.s;
    $$('#sort button').forEach(b => b.classList.toggle('on', b === t));
    refresh();
  } else if (t.dataset.reason) {
    const p = t.closest('.post');
    Mod.report({ id: p.dataset.id, author: (p.querySelector('.meta .n').dataset.user || p.querySelector('.meta .n').textContent).trim(),
                 title: p.querySelector('h2').textContent, board: p.dataset.board }, me.name, t.dataset.reason);
    p.querySelector('.pb > .rpmenu').remove();
    refresh();
  } else if (t.dataset.creason) {
    const c = t.closest('.cm'), p = c.closest('.post'), txt = c.querySelector('.txt');
    Mod.report({ id: p.dataset.id, author: nameOf(c.querySelector('.n')), title: p.querySelector('h2').textContent, board: p.dataset.board,
                 cid: c.dataset.cid, excerpt: txt ? txt.textContent.slice(0, 80) : '' }, me.name, t.dataset.creason);
    c.querySelector('.rpmenu').remove();
    refresh();
  } else if (t.dataset.vote) {
    const p = t.closest('.post'), v = t.dataset.vote;
    const had = voters(p, 'up').includes(meKey) ? 'up' : voters(p, 'down').includes(meKey) ? 'down' : '';
    const up = voters(p, 'up').filter(x => x !== meKey), down = voters(p, 'down').filter(x => x !== meKey);
    if (had !== v) (v === 'up' ? up : down).push(meKey);   // clicking the same arrow again undoes the vote
    p.dataset.up = up.join(',');
    p.dataset.down = down.join(',');
    refresh();
  } else if (t.dataset.m) {
    mood = t.dataset.m;
    $$('.mood').forEach(b => b.classList.toggle('on', b === t));
    syncPressed();
  } else if (t.id === 'modBtn') {
    document.body.classList.toggle('mod');
    t.classList.toggle('on');
  } else if (t.id === 'rmPostImg') {
    postImg = '';
    clearPrev($('#postPrev'));
    $('#postFile').value = '';
  } else if (t.classList.contains('cm-rm')) {
    const form = t.closest('form');
    pending.delete(form);
    clearPrev(form.querySelector('.cm-prev'));
    form.querySelector('.cm-file').value = '';
  } else if (t.dataset.ca) {
    const c = t.closest('.cm'), post = c.closest('.post');
    if (t.dataset.ca === 'rp') {                       // report a comment
      if (t.disabled || cmOwner(c) === meKey) return;
      const old = c.querySelector('.rpmenu');
      if (old) { old.remove(); return; }
      const menu = document.createElement('div');
      menu.className = 'rpmenu';
      menu.innerHTML = '<span>Why are you reporting this comment?</span>' +
        REASONS.map(r => '<button type="button" data-creason="' + r + '">' + r + '</button>').join('');
      c.appendChild(menu);
      return;
    }
    if (cmOwner(c) !== meKey) return;
    if (t.dataset.ca === 'ed') editComment(c);
    else if (await UI.confirm('Delete this comment? Its photo, if any, is deleted too.', { title: 'Delete comment', ok: 'Delete', danger: true })) { c.remove(); post.querySelector('.cm-count').textContent = cmCount(post); refresh(); }
  } else if (t.classList.contains('ed-cancel')) {
    const c = t.closest('.cm');
    c ? endCmEdit(c) : endPostEdit(t.closest('.post'));
  } else if (t.dataset.a) {
    const p = t.closest('.post');
    const a = t.dataset.a;

    if (a === 'cm') {
      const box = p.querySelector('.cmts');
      box.hidden = !box.hidden;
      t.setAttribute('aria-expanded', String(!box.hidden));
    } else if (a === 'rp') {
      if (t.disabled) return;
      let menu = p.querySelector('.pb > .rpmenu');
      if (menu) { menu.remove(); return; }
      menu = document.createElement('div');
      menu.className = 'rpmenu';
      menu.innerHTML = '<span>Why are you reporting this?</span>' +
        REASONS.map(r => '<button type="button" data-reason="' + r + '">' + r + '</button>').join('');
      p.querySelector('.acts').after(menu);
    } else if (a === 'rm') {
      p.remove();
      refresh();
    } else if (a === 'ed' && postOwner(p) === meKey) {
      editPost(p);
    } else if (a === 'del' && postOwner(p) === meKey) {
      if (await UI.confirm('This cannot be undone. Its comments and photos are deleted too.', { title: 'Delete this post?', ok: 'Delete', danger: true })) { p.remove(); refresh(); }
    }
  }
});

// Names are links: Enter opens the profile (keyboard users)
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches && e.target.matches('.n[role="link"]')) e.target.click();
});

// Choosing a photo (for a post or a comment)
document.addEventListener('change', async e => {
  const f = e.target;
  if (f.id !== 'postFile' && !f.classList.contains('cm-file')) return;
  const file = f.files[0];
  if (!file) return;
  try {
    const url = await readImage(file);
    if (f.id === 'postFile') { postImg = url; showPrev($('#postPrev'), url); }
    else { const form = f.closest('form'); pending.set(form, url); showPrev(form.querySelector('.cm-prev'), url); }
  } catch (err) {
    UI.alert(err.message, { title: 'Photo problem' });
    f.value = '';
  }
});

// Submits: new post and new comments
document.addEventListener('submit', e => {
  e.preventDefault();

  if (e.target.id === 'form') {
    if (blocked($('#t').value, $('#b').value)) return;
    const p = $('#post-tpl').content.firstElementChild.cloneNode(true);
    const boardName = $('#bd').value;
    p.dataset.id = nextId++;
    p.dataset.board = boardName;
    p.dataset.mood = mood;
    p.dataset.up = meKey;     // like Reddit, your own post starts with your upvote
    p.dataset.down = '';
    p.dataset.t = Date.now();   // when it was posted (used by the mood-over-time chart)
    p.querySelector('.meta .b').textContent = boardName;
    p.querySelector('.meta .n').textContent = $('#an').checked ? 'Anonymous' : me.name;
    if ($('#an').checked) p.dataset.owner = me.name;   // hidden from students; lets you edit/delete it and lets a moderator reveal it if reported for serious reasons
    p.querySelector('.tag').textContent = $(`.mood[data-m="${mood}"]`).textContent;
    p.querySelector('h2').textContent = $('#t').value.trim();
    const body = $('#b').value.trim();
    body ? p.querySelector('p').textContent = body : p.querySelector('p').remove();
    if (postImg) {
      const img = document.createElement('img');
      img.className = 'pimg';
      img.src = postImg;
      img.alt = 'Photo attached to the post';
      p.querySelector('.acts').before(img);
    }
    feed.prepend(p);
    e.target.reset();
    postImg = '';
    clearPrev($('#postPrev'));
    refresh();
  } else if (e.target.classList.contains('edit-form')) {
    const p = e.target.closest('.post');
    if (postOwner(p) !== meKey) return;
    const title = e.target.querySelector('.ed-t').value.trim(), text = e.target.querySelector('.ed-b').value.trim();
    if (!title) return;
    if (blocked(title, text)) return;
    const h = p.querySelector('h2'), body = p.querySelector('.pb > p');
    if (title !== h.textContent || text !== (body ? body.textContent : '')) p.dataset.edited = '1';
    if (applyPhoto(e.target, p, 'pimg', 'Photo attached to the post', p.querySelector('.acts'))) p.dataset.edited = '1';
    h.textContent = title;
    if (text) { if (body) body.textContent = text; else { const bp = document.createElement('p'); bp.textContent = text; h.after(bp); } }
    else if (body) body.remove();
    endPostEdit(p);
    refresh();
  } else if (e.target.classList.contains('cm-editform')) {
    const c = e.target.closest('.cm');
    if (cmOwner(c) !== meKey) return;
    const text = e.target.querySelector('.ed-c').value.trim();
    const f = e.target, hasImg = f._photo === undefined ? !!c.querySelector('.cimg') : f._photo !== '';
    if (blocked(text)) return;
    if (!text && !hasImg) { UI.alert('Use Delete if you want to remove it.', { title: 'A comment cannot be empty' }); return; }
    let txt = c.querySelector('.txt');
    const old = txt ? txt.textContent : '';
    if (text) {
      if (!txt) { txt = document.createElement('span'); txt.className = 'txt'; (c.querySelector('.cm-acts') || c.querySelector('.n')).after(document.createElement('br'), txt); }
      txt.textContent = text;
    } else if (txt) { txt.remove(); const br = c.querySelector('br'); if (br) br.remove(); }
    if (text !== old) c.dataset.edited = '1';
    if (applyPhoto(f, c, 'cimg', 'Photo attached to the comment', null)) c.dataset.edited = '1';
    endCmEdit(c);
    refresh();
  } else if (e.target.classList.contains('cm-form')) {
    const form = e.target;
    const post = form.closest('.post');
    const input = form.querySelector('.cm-text');
    const text = input.value.trim();
    const img = pending.get(form);
    if (!text && !img) return;                     // nothing to send
    if (blocked(text)) return;

    const c = $('#cm-tpl').content.firstElementChild.cloneNode(true);
    const anon = form.querySelector('.cm-an');
    c.querySelector('.n').textContent = anon && anon.checked ? 'Anonymous' : me.name;
    if (anon && anon.checked) c.dataset.owner = me.name;   // hidden from students
    if (text) c.querySelector('.txt').textContent = text;
    else { c.querySelector('.txt').remove(); c.querySelector('br').remove(); }
    if (img) {
      const im = document.createElement('img');
      im.className = 'cimg';
      im.src = img;
      im.alt = 'Photo attached to the comment';
      c.appendChild(im);
    }
    post.querySelector('.cm-list').appendChild(c);
    post.querySelector('.cm-count').textContent = cmCount(post);
    input.value = '';
    if (anon) anon.checked = false;
    pending.delete(form);
    clearPrev(form.querySelector('.cm-prev'));
    form.querySelector('.cm-file').value = '';
    refresh();
  }
});

refresh();
