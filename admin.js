// Moderator page. Everything here is read from and written to the Supabase database.
const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

let me = null, warned = false;
let D = { users: [], reports: [], posts: [], postTotal: 0, logs: [], words: { on: true, list: [] } };
const DEFAULT_WORDS = ['idiot', 'stupid', 'loser', 'dumb', 'shut up', 'kill yourself'];

const TITLES = {
  overview: ['Overview', 'What students are saying and what needs a decision'],
  reports:  ['Reports', 'Posts flagged by students, waiting on a decision'],
  students: ['Students', 'Standing and account actions'],
  posts:    ['Posts', 'Pin, lock, or remove posts across every board'],
  filter:   ['Word filter', 'Words and phrases students are not allowed to post']
};
$$('.tab-btn').forEach(btn => btn.addEventListener('click', () => {
  $$('.tab-btn').forEach(b => { b.classList.toggle('on', b === btn); b.setAttribute('aria-selected', String(b === btn)); });
  $$('.panel').forEach(p => p.classList.toggle('on', p.id === btn.dataset.tab));
  $('#title').textContent = TITLES[btn.dataset.tab][0];
  $('#sub').textContent   = TITLES[btn.dataset.tab][1];
}));

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ago = t => {
  const m = Math.round((Date.now() - new Date(t)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.round(m / 60);
  return h < 24 ? h + 'h ago' : Math.round(h / 24) + 'd ago';
};
const MOODS = [['happy', '😊 Happy'], ['meh', '😐 Meh'], ['stressed', '😟 Stressed'], ['upset', '😠 Frustrated']];
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const avHtml = (name, url) => '<span class="av" aria-hidden="true">' + (url ? '<img src="' + esc(url) + '" alt="">' : esc(String(name)[0].toUpperCase())) + '</span>';
const roleLabel = r => ({ student: 'Student', teacher: 'Teacher', staff: 'Staff', moderator: 'Moderator' }[r] || 'Student');

// Run a database call; show a message and return null if it failed.
async function ok(promise, title = 'Something went wrong') {
  const { data, error } = await promise;
  if (error) { await UI.alert(error.message, { title }); return null; }
  return { data };
}

// ---- Load everything from the database ----
async function refresh() {
  const [u, r, p, pc, lg, w, s, pr] = await Promise.all([
    sb.rpc('mod_users'), sb.rpc('mod_reports'),
    sb.from('posts_public').select('id,title,board,mood,author,author_display,anonymous,created,pinned,locked,score,comment_count').order('id', { ascending: false }).limit(500),
    sb.from('posts_public').select('id', { count: 'exact', head: true }),
    sb.from('mod_log').select('who,text,t').order('id', { ascending: false }).limit(50),
    sb.from('words').select('word').order('word'),
    sb.from('settings').select('value').eq('key', 'filter_off').maybeSingle(),
    sb.from('profiles').select('username,display,avatar')
  ]);
  const bad = [u, r, p, lg, w, pr].find(x => x.error);
  if (bad) { if (!warned) { warned = true; UI.alert(bad.error.message, { title: 'Could not load the moderator data' }); } return; }
  warned = false;
  const prof = Object.fromEntries((pr.data || []).map(x => [String(x.username).toLowerCase(), x]));
  D.users = (u.data || []).map(x => { const q = prof[String(x.name).toLowerCase()] || {}; return { ...x, display: q.display || x.name, avatar: q.avatar || '' }; });
  D.reports = (r.data || []).map(x => ({ ...x, reporters: x.reporters || [] }));
  D.posts = (p.data || []).map(x => ({ ...x, t: new Date(x.created).getTime() }));
  D.postTotal = pc.count != null ? pc.count : D.posts.length;
  D.logs = lg.data || [];
  D.words = { on: !(s.data && s.data.value === '1'), list: (w.data || []).map(x => x.word) };
  render();
}

// ---- Mood over time (stacked bars, one per day) ----
let range = 14;
const MKEYS = ['happy', 'meh', 'stressed', 'upset'];
const MLABEL = { happy: 'Happy', meh: 'Meh', stressed: 'Stressed', upset: 'Frustrated' };
const dayKey = t => { const d = new Date(t); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); };
function renderChart(posts) {
  $$('.rangebar button').forEach(b => { const on = +b.dataset.range === range; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  const dated = posts.filter(p => p.t && MKEYS.includes(p.mood));
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
  const f = D.words;
  $('#filterOn').checked = f.on;
  $('#wordCount').textContent = f.list.length;
  $('#wordList').innerHTML = f.list.length ? f.list.map(w => `<li class="chip"><span>${esc(w)}</span><button type="button" data-rmword="${esc(w)}" aria-label="Remove ${esc(w)} from the list">×</button></li>`).join('') : '<li class="empty">The list is empty, so nothing is blocked.</li>';
}
async function saveWords(on, list) {
  const r = await ok(sb.rpc('set_words', { on_: on, list }), 'Could not save the word list');
  if (r) D.words = { on, list: [...list].sort() };
  return !!r;
}

// ---- Draw the page ----
function render() {
  const roster = D.users, posts = D.posts, reports = D.reports;
  const students = roster.filter(u => u.role !== 'moderator');
  const open = reports.filter(r => r.status === 'open');
  const done = reports.filter(r => r.status !== 'open').slice(0, 10);

  $('#openCount').textContent = $('#badge').textContent = open.length;
  $('#postCount').textContent = D.postTotal;
  $('#stuCount').textContent = students.length;
  $('#banCount').textContent = students.filter(u => u.banned).length;

  $('#moodBox').innerHTML = MOODS.map(([k, label]) => {
    const pct = posts.length ? Math.round(posts.filter(p => p.mood === k).length / posts.length * 100) : 0;
    return `<div class="bar"><span>${label}</span><i style="width:${pct}%"></i>${pct}%</div>`;
  }).join('');

  renderChart(posts);
  renderFilter();

  $('#log').innerHTML = D.logs.length
    ? D.logs.map(l => `<li><span><b>${esc(l.who || 'a moderator')}</b> ${esc(l.text)}</span><time>${ago(l.t)}</time></li>`).join('')
    : '<li><span>No moderation activity yet.</span></li>';

  // Reports
  const reportRow = (r, isDone) => {
    const who = r.author, what = r.commentId ? 'comment' : 'post';
    const stu = students.find(u => same(u.name, who));
    const n = r.reporters.length;
    let btns = '<button class="ok" data-act="dismiss">Dismiss</button><button class="dng" data-act="remove">Remove ' + what + '</button>';
    if (stu && !stu.banned) btns += '<button class="dng" data-act="warn">Warn student</button><button class="dng" data-act="ban">Ban student</button>';
    if (r.canReveal) btns += '<button class="dng" data-act="reveal">Reveal author</button>';
    const note = isDone ? `<div class="result">✓ ${esc(r.outcome || 'Resolved')}</div>`
      : r.revealed ? '<div class="result">Author revealed: <b>' + esc(r.author) + '</b> (logged)</div>'
      : who === 'Anonymous' ? '<div class="result">Anonymous ' + what + ': the author is hidden. It can be revealed only if reported for bullying, harassment or a threat.</div>' : '';
    return `<li class="rrow${isDone ? ' done' : ''}" data-id="${esc(r.id)}">
      <div class="rbody">${r.reasons.map(x => `<span class="reason">${esc(x)}</span>`).join(' ')}
        <div class="snip">${r.commentId ? 'Comment on “' + esc(r.title) + '”' : esc(r.title)} — in ${esc(r.board)}</div>${r.commentId ? '<div class="meta">“' + esc(r.excerpt || '(photo only)') + '”</div>' : ''}
        <div class="meta">posted by <b>${esc(who)}</b>${r.revealed ? ' (revealed)' : ''} · reported by <b>${n === 1 ? esc(r.reporters[0]) : n + ' students'}</b> · ${ago(r.created)}</div>${note}</div>
      <div class="ra">${btns}</div></li>`;
  };
  $('#reportList').innerHTML = open.length ? open.map(r => reportRow(r, false)).join('') : '<li class="empty">No open reports. Nothing needs a decision right now.</li>';
  $('#doneTitle').hidden = $('#doneList').hidden = !done.length;
  $('#doneList').innerHTML = done.map(r => reportRow(r, true)).join('');

  // Students: profile picture, display name and @username come from the database
  $('#studentBody').innerHTML = roster.map(u => {
    const isMod = u.role === 'moderator';
    const when = t => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
    const why = u.banned ? `<small class="why">${u.banReason ? '“' + esc(u.banReason) + '”' : 'No reason recorded'} · ${esc(u.bannedBy || 'a moderator')}${u.bannedAt ? ', ' + when(u.bannedAt) : ''}</small>` : '';
    const status = u.banned ? 'Banned' : u.warns ? u.warns + (u.warns === 1 ? ' warning' : ' warnings') : 'Good standing';
    const cls = u.banned ? 'banned' : u.warns ? 'warned' : '';
    const acts = isMod ? '' : '<button data-uact="hist">History</button>' + (u.warns ? '<button data-uact="unwarn">Remove warning</button>' : '') + (u.banned ? '<button data-uact="unban">Unban</button>'
      : '<button data-uact="warn">Warn</button><button class="dng" data-uact="ban">Ban</button>');
    const nm = esc(u.display) + (u.display !== u.name ? ' <small class="hint">@' + esc(u.name) + '</small>' : '');
    return `<tr data-user="${esc(u.name)}" class="${cls}"><td class="un">${avHtml(u.name, u.avatar)}<span class="nm">${nm}</span></td>
      <td>${isMod ? '<span class="pill r-moderator">Moderator</span>' : '<select class="rolesel" data-urole aria-label="Role for ' + esc(u.name) + '">' + ['student', 'teacher', 'staff'].map(r => '<option value="' + r + '"' + (u.role === r ? ' selected' : '') + '>' + roleLabel(r) + '</option>').join('') + '</select>'}</td>
      <td>${u.joined ? new Date(u.joined).toLocaleDateString([], { month: 'short', year: 'numeric' }) : '—'}</td>
      <td>${u.posts}</td><td class="st">${status}${why}</td><td class="tact">${acts}</td></tr>`;
  }).join('');

  // Posts
  $('#postList').innerHTML = posts.length ? posts.map(p => `<li class="rrow prow" data-id="${esc(p.id)}">
      <div class="rbody"><div class="snip">${esc(p.title || '')}</div>
        <div class="meta">${esc(p.board)} · <b>${p.anonymous ? 'Anonymous' : esc(p.author_display || p.author || 'Deleted user')}</b> · ${p.comment_count} comments · ${p.score} points</div>
        <div class="flags">${p.pinned ? '<span class="fl pinned">Pinned</span>' : ''}${p.locked ? '<span class="fl locked">Locked</span>' : ''}</div></div>
      <div class="ra"><button data-pact="pin">${p.pinned ? 'Unpin' : 'Pin'}</button><button data-pact="lock">${p.locked ? 'Unlock' : 'Lock'}</button><button class="dng" data-pact="del">Delete</button></div>
    </li>`).join('') : '<li class="empty">No posts on the board yet.</li>';
}

document.addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b) return;

  if (b.dataset.range) { range = +b.dataset.range; render(); return; }
  if (b.dataset.rmword) { if (await saveWords(D.words.on, D.words.list.filter(w => w !== b.dataset.rmword))) render(); return; }
  if (b.id === 'wordReset') {
    if (await UI.confirm('Replace the list with the default words? Any words you added will be removed.', { title: 'Restore the default list', ok: 'Restore', danger: true })) await saveWords(D.words.on, DEFAULT_WORDS);
    render(); return;
  }
  if (b.id === 'resetBtn') {
    if (await UI.confirm('Delete all posts, reports and the activity log? Accounts (and their warnings and bans) are kept.', { title: 'Reset demo data', ok: 'Delete everything', danger: true })) {
      if (await ok(sb.rpc('mod_reset'), 'Could not reset')) await refresh();
    }
    return;
  }

  // Reports
  if (b.dataset.act) {
    const r = D.reports.find(x => String(x.id) === b.closest('.rrow').dataset.id);
    if (!r) return;
    const act = b.dataset.act, what = r.commentId ? 'comment' : 'post', who = r.author;
    if (act === 'reveal') {
      if (!await UI.confirm('Reveal who wrote this anonymous ' + what + '? This is recorded in the activity log.', { title: 'Reveal author', ok: 'Reveal', danger: true })) return;
      await ok(sb.rpc('mod_reveal', { rid: r.id }), 'Cannot reveal');
      await refresh(); return;
    }
    if (act === 'warn' || act === 'ban') {
      const reason = await UI.prompt(act === 'ban' ? 'Moderators can see this reason later. The student is not shown it.' : 'The student sees this reason with their warning.',
        { title: (act === 'ban' ? 'Ban ' : 'Warn ') + who, label: act === 'ban' ? 'Reason for the ban' : 'Reason for the warning',
          value: `Reported for ${r.reasons.join(', ')}: ${r.commentId ? 'comment on ' : ''}"${r.title}"`, required: act === 'ban', ok: act === 'ban' ? 'Ban student' : 'Warn student', danger: act === 'ban' });
      if (reason === null) return;
      if (!await ok(sb.rpc('mod_action', { uname: who, act, note: reason }), act === 'ban' ? 'Could not ban' : 'Could not warn')) return;
    }
    const outcome = { dismiss: 'Dismissed', remove: r.commentId ? 'Comment removed' : 'Post removed', warn: 'Student warned', ban: 'Student banned' }[act];
    if (!await ok(sb.rpc('mod_resolve', { rid: r.id, outcome }), 'Could not close the report')) return;
    if (act === 'remove') await ok(r.commentId ? sb.rpc('mod_delete_comment', { cid: r.commentId }) : sb.rpc('mod_delete_post', { pid: r.postId }), 'Could not remove it');
    await refresh(); return;
  }

  // Students table
  if (b.dataset.uact) {
    const user = b.closest('tr').dataset.user, act = b.dataset.uact;
    const VERB = { warn: 'warned', unwarn: 'removed one warning from', ban: 'banned', unban: 'unbanned', role: 'changed the role of' };
    if (act === 'hist') {
      const rec = D.users.find(u => same(u.name, user));
      const h = ((rec && rec.history) || []).slice().reverse();
      await UI.alert(h.length ? '' : 'No warnings or bans yet.', { title: user + ': moderation history',
        list: h.length ? h.map(x => `${new Date(x.t).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })} · ${x.by} ${VERB[x.act] || x.act} ${user}${x.reason ? ' — ' + x.reason : ''}`) : undefined });
      return;
    }
    let reason = '';
    if (act === 'ban' || act === 'warn') {
      reason = await UI.prompt(act === 'ban' ? 'Moderators can see this reason later. The student is not shown it.' : 'The student sees this reason with their warning.',
        { title: (act === 'ban' ? 'Ban ' : 'Warn ') + user, label: act === 'ban' ? 'Reason for the ban' : 'Reason for the warning', placeholder: 'e.g. repeated bullying in Campus life', required: act === 'ban', ok: act === 'ban' ? 'Ban student' : 'Warn student', danger: act === 'ban' });
      if (reason === null) return;
    }
    await ok(sb.rpc('mod_action', { uname: user, act, note: reason }), 'Could not ' + act);
    await refresh(); return;
  }

  // Posts
  if (b.dataset.pact) {
    const id = Number(b.closest('.rrow').dataset.id), act = b.dataset.pact;
    const post = D.posts.find(p => p.id === id);
    if (post) {
      if (act === 'del') {
        if (!await UI.confirm(`Delete "${post.title || 'this post'}"? This also deletes its comments and photos.`, { title: 'Delete post', ok: 'Delete', danger: true })) return;
        await ok(sb.rpc('mod_delete_post', { pid: id }), 'Could not delete');
      } else await ok(sb.rpc('mod_flag', { pid: id, k: act === 'pin' ? 'pinned' : 'locked' }), 'Could not change the post');
    }
    await refresh();
  }
});

// Change a member's role
document.addEventListener('change', async e => {
  const s = e.target.closest && e.target.closest('[data-urole]'); if (!s) return;
  const user = s.closest('tr').dataset.user;
  await ok(sb.rpc('mod_action', { uname: user, act: 'role', note: 'to ' + roleLabel(s.value), new_role: s.value }), 'Could not change the role');
  await refresh();
});

// Word filter: add a word, switch on/off, test a sentence
$('#wordForm').addEventListener('submit', async e => {
  e.preventDefault();
  const word = e.target.elements.word.value.trim().toLowerCase().replace(/\s+/g, ' '), err = $('#wordErr');
  err.textContent = '';
  if (word.length < 2) { err.textContent = 'Type a word or phrase (at least 2 characters).'; return; }
  if (word.length > 40) { err.textContent = 'Keep it under 40 characters.'; return; }
  if (D.words.list.some(w => w.toLowerCase() === word)) { err.textContent = 'That word is already on the list.'; return; }
  if (D.words.list.length >= 200) { err.textContent = 'The list is full (200 words).'; return; }
  if (await saveWords(D.words.on, [...D.words.list, word])) { e.target.reset(); render(); }
});
$('#filterOn').addEventListener('change', async e => { if (!await saveWords(e.target.checked, D.words.list)) e.target.checked = D.words.on; render(); });
$('#wordTest').addEventListener('input', e => {
  const t = e.target.value.trim(), hit = t && StudentPulseWordFilter.findBlockedWord(t, D.words.list);
  $('#wordTestOut').textContent = !t ? '' : !D.words.on ? 'The filter is off, so this would be allowed.' : hit ? `Blocked: it contains “${hit}”.` : 'Allowed.';
  $('#wordTestOut').className = 'testout ' + (hit ? 'bad' : 'ok');
});

$('#logoutBtn').addEventListener('click', async () => { await sb.auth.signOut(); Auth.logout(); });

// ---- Start: only moderators may be here ----
(async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return Auth.logout();
  const { data: p } = await sb.from('profiles').select('*').eq('id', session.user.id).single();
  if (!p || p.role !== 'moderator') return location.replace('index.html');
  me = p;
  $('#meName').textContent = p.display || p.username;
  $('#meDot').innerHTML = avHtml(p.username, p.avatar);
  await refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, 30000);   // pick up new reports and posts
})();
