// Moderator page, reading and writing the Supabase database.
// Every action below is checked again by the database (must_mod), so hiding this page is only for convenience.
const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

let me, users = [], reports = [], posts = [], logs = [], words = [], filterOn = true, range = 14, search = '';
const DEFAULT_WORDS = ['idiot', 'stupid', 'loser', 'dumb', 'shut up', 'kill yourself'];
const ROLE_LIST = ['student', 'teacher', 'staff', 'moderator'];

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ago = t => {
  const m = Math.round((Date.now() - new Date(t)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.round(m / 60);
  return h < 24 ? h + 'h ago' : Math.round(h / 24) + 'd ago';
};
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const MOODS = [['happy', '😊 Happy'], ['meh', '😐 Meh'], ['stressed', '😟 Stressed'], ['upset', '😠 Frustrated']];

// Call a database function. Shows the database's message if it refuses. Returns { data } or null.
async function call(fn, args) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) { await UI.alert(error.message, { title: 'Could not do that' }); return null; }
  return { data };
}

const TITLES = {
  overview: ['Overview', 'What students are saying and what needs a decision'],
  reports:  ['Reports', 'Posts flagged by students, waiting on a decision'],
  students: ['Members', 'Roles, warnings and bans'],
  posts:    ['Posts', 'Pin, lock, or remove posts across every board'],
  filter:   ['Word filter', 'Words and phrases students are not allowed to post']
};
$$('.tab-btn').forEach(btn => btn.addEventListener('click', () => {
  $$('.tab-btn').forEach(b => { b.classList.toggle('on', b === btn); b.setAttribute('aria-selected', String(b === btn)); });
  $$('.panel').forEach(p => p.classList.toggle('on', p.id === btn.dataset.tab));
  $('#title').textContent = TITLES[btn.dataset.tab][0];
  $('#sub').textContent = TITLES[btn.dataset.tab][1];
}));

// ---- Mood over time ----
const MKEYS = ['happy', 'meh', 'stressed', 'upset'];
const MLABEL = { happy: 'Happy', meh: 'Meh', stressed: 'Stressed', upset: 'Frustrated' };
const dayKey = t => { const d = new Date(t); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); };
function renderChart(list) {
  $$('.rangebar button').forEach(b => { const on = +b.dataset.range === range; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  const dated = list.filter(p => p.t && MKEYS.includes(p.mood));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = range - 1; i >= 0; i--) { const d = new Date(today); d.setDate(d.getDate() - i); days.push({ d, c: { happy: 0, meh: 0, stressed: 0, upset: 0 } }); }
  const by = Object.fromEntries(days.map(x => [dayKey(x.d), x]));
  dated.forEach(p => { const x = by[dayKey(p.t)]; if (x) x.c[p.mood]++; });
  const total = x => MKEYS.reduce((s, k) => s + x.c[k], 0);
  const inRange = days.reduce((s, x) => s + total(x), 0);

  const share = (from, to) => { const a = dated.filter(p => p.t >= from && p.t < to); return { n: a.length, pct: a.length ? Math.round(a.filter(p => p.mood === 'stressed' || p.mood === 'upset').length / a.length * 100) : 0 }; };
  const end = today.getTime() + 864e5, w1 = share(end - 7 * 864e5, end), w0 = share(end - 14 * 864e5, end - 7 * 864e5);
  $('#trend').textContent = w1.n < 3 ? 'Not enough posts in the last 7 days to see a trend yet.'
    : w0.n < 3 ? `Stressed or frustrated posts make up ${w1.pct}% of the last 7 days (${w1.n} posts).`
    : `Stressed or frustrated posts: ${w1.pct}% in the last 7 days, ${w1.pct > w0.pct ? 'up' : w1.pct < w0.pct ? 'down' : 'unchanged'} from ${w0.pct}% the week before (${w1.n} and ${w0.n} posts).`;

  if (!inRange) {
    $('#chart').innerHTML = `<p class="empty" style="padding:22px 10px">No posts in the last ${range} days yet.</p>`;
    $('#legend').innerHTML = ''; $('#chartTable').innerHTML = ''; return;
  }
  const W = 640, H = 230, L = 32, B = 28, T = 10, R = 6, pw = W - L - R, ph = H - B - T;
  let max = Math.max(...days.map(total)); max = Math.max(4, Math.ceil(max / 4) * 4);
  const bw = pw / days.length, barw = Math.min(34, bw * 0.72);
  const step = days.length <= 7 ? 1 : days.length <= 14 ? 2 : 5;
  let g = '';
  for (let k = 0; k <= 4; k++) { const v = Math.round(max * k / 4), y = T + ph - ph * k / 4; g += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" class="grid"/><text x="${L - 6}" y="${y + 4}" text-anchor="end" class="ax">${v}</text>`; }
  days.forEach((x, i) => {
    const cx = L + bw * i + bw / 2; let y = T + ph;
    MKEYS.forEach(k => { const h = ph * x.c[k] / max; if (h) { y -= h; g += `<rect x="${cx - barw / 2}" y="${y}" width="${barw}" height="${h}" class="m-${k}"/>`; } });
    if (i % step === (days.length - 1) % step) g += `<text x="${cx}" y="${H - 8}" text-anchor="middle" class="ax">${x.d.toLocaleDateString([], { month: 'short', day: 'numeric' })}</text>`;
  });
  $('#chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Stacked bar chart of posts per day by mood over the last ${range} days. The same numbers are in the table below.">${g}</svg>`;
  $('#legend').innerHTML = MKEYS.map(k => `<li><i class="sw m-${k}"></i>${MLABEL[k]} <b>${days.reduce((s, x) => s + x.c[k], 0)}</b></li>`).join('');
  $('#chartTable').innerHTML = `<div class="tblwrap"><table class="tbl small"><caption class="vh">Posts per day by mood</caption><thead><tr><th scope="col">Day</th>${MKEYS.map(k => `<th scope="col">${MLABEL[k]}</th>`).join('')}<th scope="col">Total</th></tr></thead><tbody>${
    days.slice().reverse().map(x => `<tr><th scope="row">${x.d.toLocaleDateString([], { month: 'short', day: 'numeric' })}</th>${MKEYS.map(k => `<td>${x.c[k]}</td>`).join('')}<td>${total(x)}</td></tr>`).join('')}</tbody></table></div>`;
}

// ---- Word filter panel ----
function renderFilter() {
  $('#filterOn').checked = filterOn;
  $('#wordCount').textContent = words.length;
  $('#wordList').innerHTML = words.length
    ? words.map(w => `<li class="chip"><span>${esc(w)}</span><button type="button" data-rmword="${esc(w)}" aria-label="Remove ${esc(w)} from the list">×</button></li>`).join('')
    : '<li class="empty">The list is empty, so nothing is blocked.</li>';
}
const saveWords = async () => { const r = await call('set_words', { on_: filterOn, list: words }); await load(); return !!r; };

// ---- Draw everything from the loaded data ----
function render() {
  const students = users.filter(u => u.role !== 'moderator');
  const open = reports.filter(r => r.status === 'open');
  const done = reports.filter(r => r.status !== 'open').slice(0, 10);

  $('#openCount').textContent = $('#badge').textContent = open.length;
  $('#postCount').textContent = posts.length;
  $('#stuCount').textContent = students.length;
  $('#banCount').textContent = students.filter(u => u.banned).length;

  $('#moodBox').innerHTML = MOODS.map(([k, label]) => {
    const pct = posts.length ? Math.round(posts.filter(p => p.mood === k).length / posts.length * 100) : 0;
    return `<div class="bar"><span>${label}</span><i style="width:${pct}%"></i>${pct}%</div>`;
  }).join('');

  renderChart(posts);
  renderFilter();

  $('#log').innerHTML = logs.length
    ? logs.map(l => `<li><span><b>${esc(l.who || '')}</b> ${esc(l.text)}</span><time>${ago(l.t)}</time></li>`).join('')
    : '<li><span>No moderation activity yet.</span></li>';

  // Reports
  const reportRow = (r, isDone) => {
    const who = r.author, what = r.commentId ? 'comment' : 'post';
    const stu = students.find(u => same(u.name, who));
    const reporters = r.reporters || [], n = reporters.length;
    let btns = '<button class="ok" data-act="dismiss">Dismiss</button><button class="dng" data-act="remove">Remove ' + what + '</button>';
    if (stu && !stu.banned) btns += '<button class="dng" data-act="warn">Warn student</button><button class="dng" data-act="ban">Ban student</button>';
    if (r.canReveal) btns += '<button class="dng" data-act="reveal">Reveal author</button>';
    const note = isDone ? `<div class="result">✓ ${esc(r.outcome || '')}</div>`
      : r.revealed ? '<div class="result">Author revealed: <b>' + esc(r.author) + '</b> (logged)</div>'
      : who === 'Anonymous' ? '<div class="result">Anonymous ' + what + ': the author is hidden. It can be revealed only if reported for bullying, harassment or a threat.</div>' : '';
    return `<li class="rrow${isDone ? ' done' : ''}" data-id="${r.id}">
      <div class="rbody">${r.reasons.map(x => `<span class="reason">${esc(x)}</span>`).join(' ')}
        <div class="snip">${r.commentId ? 'Comment on “' + esc(r.title) + '”' : esc(r.title)} — in ${esc(r.board)}</div>${r.commentId ? '<div class="meta">“' + esc(r.excerpt || '(photo only)') + '”</div>' : ''}
        <div class="meta">posted by <b>${esc(who)}</b>${r.revealed ? ' (revealed)' : ''} · reported by <b>${n === 1 ? esc(reporters[0]) : n + ' students'}</b> · ${ago(r.created)}</div>${note}</div>
      <div class="ra">${btns}</div></li>`;
  };
  $('#reportList').innerHTML = open.length ? open.map(r => reportRow(r, false)).join('') : '<li class="empty">No open reports. Nothing needs a decision right now.</li>';
  $('#doneTitle').hidden = $('#doneList').hidden = !done.length;
  $('#doneList').innerHTML = done.map(r => reportRow(r, true)).join('');

  // Members
  const shownUsers = users.filter(u => !search || u.name.toLowerCase().includes(search.toLowerCase()));
  $('#studentBody').innerHTML = shownUsers.length ? shownUsers.map(u => {
    const isMe = same(u.name, me.username), isMod = u.role === 'moderator';
    const when = t => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
    const why = u.banned ? `<small class="why">${u.banReason ? '“' + esc(u.banReason) + '”' : 'No reason recorded'} · ${esc(u.bannedBy || 'a moderator')}${u.bannedAt ? ', ' + when(u.bannedAt) : ''}</small>` : '';
    const status = u.banned ? 'Banned' : u.warns ? u.warns + (u.warns === 1 ? ' warning' : ' warnings') : 'Good standing';
    const cls = u.banned ? 'banned' : u.warns ? 'warned' : '';
    const roleCell = isMe ? '<span class="pill r-moderator">Moderator (you)</span>'
      : '<select class="rolesel" data-urole aria-label="Role for ' + esc(u.name) + '">' + ROLE_LIST.map(r => '<option value="' + r + '"' + (u.role === r ? ' selected' : '') + '>' + Auth.roleLabel(r) + '</option>').join('') + '</select>';
    const acts = isMe ? '' : '<button data-uact="hist">History</button>' + (isMod ? ''
      : (u.warns ? '<button data-uact="unwarn">Remove warning</button>' : '') + (u.banned ? '<button data-uact="unban">Unban</button>' : '<button data-uact="warn">Warn</button><button class="dng" data-uact="ban">Ban</button>'));
    return `<tr data-user="${esc(u.name)}" class="${cls}"><td class="un"><span class="nm">${esc(u.name)}</span></td><td>${roleCell}</td>
      <td>${u.joined ? new Date(u.joined).toLocaleDateString([], { month: 'short', year: 'numeric' }) : '—'}</td>
      <td>${u.posts}</td><td class="st">${status}${why}</td><td class="tact">${acts}</td></tr>`;
  }).join('') : '<tr><td colspan="6" class="empty">No one matches that search.</td></tr>';

  // Posts
  $('#postList').innerHTML = posts.length ? posts.map(p => `<li class="rrow prow" data-id="${p.id}">
      <div class="rbody"><div class="snip">${esc(p.title)}</div>
        <div class="meta">${esc(p.board)} · <b>${esc(p.author || 'Anonymous')}</b> · ${p.comments} comments · ${p.score} points</div>
        <div class="flags">${p.pinned ? '<span class="fl pinned">Pinned</span>' : ''}${p.locked ? '<span class="fl locked">Locked</span>' : ''}</div></div>
      <div class="ra"><button data-pact="pinned">${p.pinned ? 'Unpin' : 'Pin'}</button><button data-pact="locked">${p.locked ? 'Unlock' : 'Lock'}</button><button class="dng" data-pact="del">Delete</button></div>
    </li>`).join('') : '<li class="empty">No posts on the board yet.</li>';
}

async function load() {
  const res = await Promise.all([
    sb.rpc('mod_users'), sb.rpc('mod_reports'),
    sb.from('posts_public').select('*').order('id', { ascending: false }),
    sb.from('comments_public').select('id,post_id'),
    sb.from('mod_log').select('who,text,t').order('id', { ascending: false }).limit(50),
    sb.from('words').select('word').order('word'),
    sb.from('settings').select('value').eq('key', 'filter_off')
  ]);
  const bad = res.find(r => r.error);
  if (bad) return UI.alert(bad.error.message, { title: 'Could not load the moderator page' });
  const [u, r, p, c, l, w, s] = res;
  const cc = {}; (c.data || []).forEach(x => cc[x.post_id] = (cc[x.post_id] || 0) + 1);
  users = u.data || []; reports = r.data || [];
  posts = (p.data || []).map(x => ({ ...x, t: Date.parse(x.created), comments: cc[x.id] || 0 }));
  logs = l.data || []; words = (w.data || []).map(x => x.word); filterOn = !(s.data || []).some(x => x.value === '1');
  render();
}

// ---- Clicks ----
document.addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b) return;

  if (b.dataset.range) { range = +b.dataset.range; render(); return; }
  if (b.dataset.rmword) { words = words.filter(w => w !== b.dataset.rmword); await saveWords(); return; }
  if (b.id === 'wordReset') {
    if (await UI.confirm('Replace the list with the default words? Any words you added will be removed.', { title: 'Restore the default list', ok: 'Restore', danger: true })) { words = DEFAULT_WORDS.slice(); filterOn = true; await saveWords(); }
    return;
  }
  if (b.id === 'resetBtn') {
    if (await UI.confirm('Delete all posts, reports and the activity log? Accounts (and their warnings and bans) are kept.', { title: 'Reset demo data', ok: 'Delete everything', danger: true })) { await call('mod_reset'); await load(); }
    return;
  }

  // Reports
  if (b.dataset.act) {
    const r = reports.find(x => String(x.id) === b.closest('.rrow').dataset.id);
    if (!r) return;
    const act = b.dataset.act, who = r.author;
    if (act === 'reveal') {
      if (!await UI.confirm('Reveal who wrote this anonymous ' + (r.commentId ? 'comment' : 'post') + '? This is recorded in the activity log.', { title: 'Reveal author', ok: 'Reveal', danger: true })) return;
      await call('mod_reveal', { rid: r.id }); await load(); return;
    }
    if (act === 'dismiss') await call('mod_resolve', { rid: r.id, outcome: 'Dismissed' });
    else if (act === 'remove') await call(r.commentId ? 'mod_delete_comment' : 'mod_delete_post', r.commentId ? { cid: r.commentId } : { pid: r.postId });
    else {
      const reason = await UI.prompt(act === 'ban' ? 'Moderators can see this reason later. The student is not shown it.' : 'Optional. Moderators can see this in the history.',
        { title: (act === 'ban' ? 'Ban ' : 'Warn ') + who, label: act === 'ban' ? 'Reason for the ban' : 'Reason for the warning',
          value: `Reported for ${r.reasons.join(', ')}: ${r.commentId ? 'comment on ' : ''}"${r.title}"`, required: act === 'ban', ok: act === 'ban' ? 'Ban student' : 'Warn student', danger: act === 'ban' });
      if (reason === null) return;
      if (await call('mod_action', { uname: who, act, note: reason })) await call('mod_resolve', { rid: r.id, outcome: act === 'ban' ? 'Student banned' : 'Student warned' });
    }
    await load(); return;
  }

  // Members table
  if (b.dataset.uact) {
    const user = b.closest('tr').dataset.user, act = b.dataset.uact;
    if (act === 'hist') {
      const rec = users.find(u => same(u.name, user));
      const h = ((rec && rec.history) || []).slice().reverse();
      const VERB = { warn: 'warned', unwarn: 'removed one warning from', ban: 'banned', unban: 'unbanned' };
      const line = x => `${new Date(x.t).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })} · ` +
        (x.act === 'role' ? `${x.by} set the role of ${user} to ${Auth.roleLabel(x.reason)}` : `${x.by} ${VERB[x.act] || x.act} ${user}${x.reason ? ' — ' + x.reason : ''}`);
      await UI.alert(h.length ? '' : 'No warnings, bans or role changes yet.', { title: user + ': history', list: h.length ? h.map(line) : undefined });
      return;
    }
    let reason = '';
    if (act === 'ban' || act === 'warn') {
      reason = await UI.prompt(act === 'ban' ? 'Moderators can see this reason later. The student is not shown it.' : 'Optional. Moderators can see this in the history.',
        { title: (act === 'ban' ? 'Ban ' : 'Warn ') + user, label: act === 'ban' ? 'Reason for the ban' : 'Reason for the warning', placeholder: 'e.g. repeated bullying in Campus life', required: act === 'ban', ok: act === 'ban' ? 'Ban student' : 'Warn student', danger: act === 'ban' });
      if (reason === null) return;
    }
    await call('mod_action', { uname: user, act, note: reason });
    await load(); return;
  }

  // Posts
  if (b.dataset.pact) {
    const id = +b.closest('.rrow').dataset.id, act = b.dataset.pact, post = posts.find(p => p.id === id);
    if (post) {
      if (act === 'del') {
        if (!await UI.confirm(`Delete "${post.title}"? This also deletes its comments and photos.`, { title: 'Delete post', ok: 'Delete', danger: true })) return;
        await call('mod_delete_post', { pid: id });
      } else await call('mod_flag', { pid: id, k: act });
    }
    await load();
  }
});

// Change a member's role. Making someone a moderator (or removing it) always asks first.
document.addEventListener('change', async e => {
  const s = e.target.closest && e.target.closest('[data-urole]'); if (!s) return;
  const user = s.closest('tr').dataset.user, rec = users.find(u => same(u.name, user)), to = s.value;
  if (!rec || rec.role === to) return;
  let ok = true;
  if (to === 'moderator') ok = await UI.confirm('Moderators can warn and ban members, see every report, delete posts, edit the word filter, and reveal anonymous authors in serious reports. They can also change other members’ roles.',
    { title: 'Make ' + user + ' a moderator?', ok: 'Make moderator', danger: true });
  else if (rec.role === 'moderator') ok = await UI.confirm(user + ' will lose all moderator tools and become ' + Auth.roleLabel(to).toLowerCase() + '.', { title: 'Remove moderator rights?', ok: 'Remove', danger: true });
  if (ok) await call('set_role', { uname: user, new_role: to });
  await load();   // also puts the dropdown back if it was cancelled or refused
});

$('#stuSearch').addEventListener('input', e => { search = e.target.value.trim(); render(); });

// Word filter: add a word, switch on/off, test a sentence (the test uses the real database filter)
$('#wordForm').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#wordErr'); err.textContent = '';
  const w = e.target.elements.word.value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (w.length < 2 || w.length > 40) { err.textContent = 'Type a word or phrase (2–40 characters).'; return; }
  if (words.includes(w)) { err.textContent = 'That word is already on the list.'; return; }
  if (words.length >= 200) { err.textContent = 'The list is full (200 words).'; return; }
  words = [...words, w];
  if (await saveWords()) e.target.reset();
});
$('#filterOn').addEventListener('change', async e => {
  filterOn = e.target.checked;
  if (!filterOn && !await UI.confirm('Students will be able to post any words until you turn it back on.', { title: 'Turn the word filter off?', ok: 'Turn off', danger: true })) { filterOn = true; render(); return; }
  await saveWords();
});
let testTimer;
$('#wordTest').addEventListener('input', e => {
  clearTimeout(testTimer);
  const t = e.target.value.trim(), out = $('#wordTestOut');
  if (!t) { out.textContent = ''; return; }
  testTimer = setTimeout(async () => {
    const { data, error } = await sb.rpc('test_words', { t });
    if (error) { out.textContent = error.message; out.className = 'testout bad'; return; }
    const hit = filterOn && data;
    out.textContent = !filterOn ? 'The filter is off, so this would be allowed.' : data ? `Blocked: it matches “${data}”.` : 'Allowed.';
    out.className = 'testout ' + (hit ? 'bad' : 'ok');
  }, 300);
});

$('#logoutBtn').addEventListener('click', async () => { await sb.auth.signOut(); Auth.logout(); });

// Start: only a real moderator (checked in the database) may stay on this page
(async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return location.replace('login.html');
  const { data: p } = await sb.from('profiles').select('username,role').eq('id', session.user.id).single();
  if (!p || p.role !== 'moderator') return location.replace('index.html');
  me = p;
  $('#meName').textContent = p.username;
  $('#meDot').replaceChildren(Auth.avatar(p.username));
  document.documentElement.style.visibility = '';
  await load();
  setInterval(() => { if (!document.hidden && !document.querySelector('.uimodal') && !(document.activeElement && /INPUT|SELECT/.test(document.activeElement.tagName))) load(); }, 30000);
})();
