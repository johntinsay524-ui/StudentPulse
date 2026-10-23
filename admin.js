const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const me = Auth.session();
$('#meName').textContent = me.name;
$('#meDot').replaceChildren(Auth.avatar(me.name));
$('#logoutBtn').addEventListener('click', Auth.logout);

const TITLES = {
  overview: ['Overview', 'What students are saying and what needs a decision'],
  reports:  ['Reports', 'Posts flagged by students, waiting on a decision'],
  students: ['Students', 'Standing and account actions'],
  posts:    ['Posts', 'Pin, lock, or remove posts across every board'],
  filter:   ['Word filter', 'Words and phrases students are not allowed to post']
};

// Tabs
$$('.tab-btn').forEach(btn => btn.addEventListener('click', () => {
  $$('.tab-btn').forEach(b => { b.classList.toggle('on', b === btn); b.setAttribute('aria-selected', String(b === btn)); });
  $$('.panel').forEach(p => p.classList.toggle('on', p.id === btn.dataset.tab));
  $('#title').textContent = TITLES[btn.dataset.tab][0];
  $('#sub').textContent   = TITLES[btn.dataset.tab][1];
}));

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ago = t => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.round(m / 60);
  return h < 24 ? h + 'h ago' : Math.round(h / 24) + 'd ago';
};
const MOODS = [['happy', '😊 Happy'], ['meh', '😐 Meh'], ['stressed', '😟 Stressed'], ['upset', '😠 Frustrated']];
const SERIOUS = ['Bullying', 'Harassment', 'Threat or safety concern'];   // reasons that allow revealing an anonymous author
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

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

  // Is the mood getting worse? Share of stressed + frustrated posts: last 7 days vs the 7 before
  const share = (from, to) => { const a = dated.filter(p => p.t >= from && p.t < to); return { n: a.length, pct: a.length ? Math.round(a.filter(p => p.mood === 'stressed' || p.mood === 'upset').length / a.length * 100) : 0 }; };
  const end = today.getTime() + 864e5, w1 = share(end - 7 * 864e5, end), w0 = share(end - 14 * 864e5, end - 7 * 864e5);
  $('#trend').textContent = w1.n < 3 ? 'Not enough posts in the last 7 days to see a trend yet.'
    : w0.n < 3 ? `Stressed or frustrated posts make up ${w1.pct}% of the last 7 days (${w1.n} posts).`
    : `Stressed or frustrated posts: ${w1.pct}% in the last 7 days, ${w1.pct > w0.pct ? 'up' : w1.pct < w0.pct ? 'down' : 'unchanged'} from ${w0.pct}% the week before (${w1.n} and ${w0.n} posts).`;

  const undated = posts.length - posts.filter(p => p.t).length;
  if (!inRange) {
    $('#chart').innerHTML = `<p class="empty" style="padding:22px 10px">No dated posts in the last ${range} days yet. Post on the board, or press "Add sample data" below to see how the chart looks.${undated ? ' (' + undated + ' older post' + (undated === 1 ? ' has' : 's have') + ' no date.)' : ''}</p>`;
    $('#legend').innerHTML = ''; $('#chartTable').innerHTML = ''; return;
  }
  const W = 640, H = 230, L = 32, B = 28, T = 10, R = 6, pw = W - L - R, ph = H - B - T;
  let max = Math.max(...days.map(total)); max = Math.max(4, Math.ceil(max / 4) * 4);   // gridlines land on whole numbers
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
  const f = Filter.get();
  $('#filterOn').checked = f.on;
  $('#wordCount').textContent = f.list.length;
  $('#wordList').innerHTML = f.list.length ? f.list.map(w => `<li class="chip"><span>${esc(w)}</span><button type="button" data-rmword="${esc(w)}" aria-label="Remove ${esc(w)} from the list">×</button></li>`).join('') : '<li class="empty">The list is empty, so nothing is blocked.</li>';
}

// Everything on this page is drawn from the real saved data
function render() {
  const posts = Mod.posts(), roster = Auth.roster(), reports = Mod.reports();
  const students = roster.filter(u => u.role !== 'moderator');
  const live = new Set(posts.map(p => p.id)), liveC = Mod.liveComments();
  const open = reports.filter(r => r.status === 'open').reverse();
  const done = reports.filter(r => r.status !== 'open').reverse().slice(0, 10);

  // Overview numbers
  const banned = students.filter(u => u.banned).length;
  $('#openCount').textContent = $('#badge').textContent = open.length;
  $('#postCount').textContent = posts.length;
  $('#stuCount').textContent = students.length;
  $('#banCount').textContent = banned;

  $('#moodBox').innerHTML = MOODS.map(([k, label]) => {
    const pct = posts.length ? Math.round(posts.filter(p => p.mood === k).length / posts.length * 100) : 0;
    const [emoji, ...rest] = label.split(' ');
    return `<div class="bar"><span class="mlabel"><span aria-hidden="true">${emoji}</span><span>${rest.join(' ')}</span></span><i style="width:${pct}%"></i>${pct}%</div>`;
  }).join('');

  renderChart(posts);
  renderFilter();

  const logs = Mod.logs();
  $('#log').innerHTML = logs.length
    ? logs.map(l => `<li><span><b>${esc(l.who)}</b> ${esc(l.text)}</span><time>${ago(l.t)}</time></li>`).join('')
    : '<li><span>No moderation activity yet.</span></li>';

  // Reports
  const reportRow = (r, isDone) => {
    const who = r.revealed || r.author;
    const what = r.cid ? 'comment' : 'post';
    const alive = r.cid ? live.has(r.postId) && liveC.has(r.cid) : live.has(r.postId);
    const stu = students.find(u => same(u.name, who));
    const n = r.reporters.length;
    let btns = '<button class="ok" data-act="dismiss">Dismiss</button>';
    if (alive) btns += '<button class="dng" data-act="remove">Remove ' + what + '</button>';
    if (stu && !stu.banned) btns += '<button class="dng" data-act="warn">Warn student</button><button class="dng" data-act="ban">Ban student</button>';
    if (!r.revealed && r.author === 'Anonymous' && alive && r.reasons.some(x => SERIOUS.includes(x))) btns += '<button class="dng" data-act="reveal">Reveal author</button>';
    const note = isDone ? `<div class="result">✓ ${esc(r.outcome)}</div>`
      : !alive ? '<div class="result">This ' + what + ' was already removed.</div>'
      : r.revealed ? '<div class="result">Author revealed: <b>' + esc(r.revealed) + '</b> (logged)</div>'
      : r.author === 'Anonymous' ? '<div class="result">Anonymous post: the author is hidden. It can be revealed only if reported for bullying, harassment or a threat.</div>' : '';
    return `<li class="rrow${isDone ? ' done' : ''}" data-id="${esc(r.id)}">
      <div class="rbody">${r.reasons.map(x => `<span class="reason">${esc(x)}</span>`).join(' ')}
        <div class="snip">${r.cid ? 'Comment on “' + esc(r.title) + '”' : esc(r.title)} — in ${esc(r.board)}</div>${r.cid ? '<div class="meta">“' + esc(r.excerpt || '(photo only)') + '”</div>' : ''}
        <div class="meta">posted by <b>${esc(who)}</b>${r.revealed ? ' (revealed)' : ''} · reported by <b>${n === 1 ? esc(r.reporters[0]) : n + ' students'}</b> · ${ago(r.time)}</div>${note}</div>
      <div class="ra">${btns}</div></li>`;
  };
  $('#reportList').innerHTML = open.length ? open.map(r => reportRow(r, false)).join('') : '<li class="empty">No open reports. Nothing needs a decision right now.</li>';
  $('#doneTitle').hidden = $('#doneList').hidden = !done.length;
  $('#doneList').innerHTML = done.map(r => reportRow(r, true)).join('');

  // Students
  const postsBy = n => posts.filter(p => same(p.author, n)).length;
  $('#studentBody').innerHTML = roster.map(u => {
    const isMod = u.role === 'moderator';
    const when = t => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
    const why = u.banned ? `<small class="why">${u.banReason ? '“' + esc(u.banReason) + '”' : 'No reason recorded'} · ${esc(u.bannedBy || 'a moderator')}${u.bannedAt ? ', ' + when(u.bannedAt) : ''}</small>` : '';
    const status = u.banned ? 'Banned' : u.warns ? u.warns + (u.warns === 1 ? ' warning' : ' warnings') : 'Good standing';
    const cls = u.banned ? 'banned' : u.warns ? 'warned' : '';
    const acts = isMod ? '' : '<button data-uact="hist">History</button><button data-uact="reset">Reset password</button>' + (u.warns ? '<button data-uact="unwarn">Remove warning</button>' : '') + (u.banned ? '<button data-uact="unban">Unban</button>'
      : '<button data-uact="warn">Warn</button><button class="dng" data-uact="ban">Ban</button>');
    return `<tr data-user="${esc(u.name)}" class="${cls}"><td class="un"><span class="nm">${esc(u.name)}</span></td>
      <td>${isMod ? '<span class="pill r-moderator">Moderator</span>' : '<select class="rolesel" data-urole aria-label="Role for ' + esc(u.name) + '">' + ['student', 'teacher', 'staff'].map(r => '<option value="' + r + '"' + (u.role === r ? ' selected' : '') + '>' + Auth.roleLabel(r) + '</option>').join('') + '</select>'}</td>
      <td>${u.joined ? new Date(u.joined).toLocaleDateString([], { month: 'short', year: 'numeric' }) : '—'}</td>
      <td>${postsBy(u.name)}</td><td class="st">${status}${why}</td><td class="tact">${acts}</td></tr>`;
  }).join('');
  Auth.decorate('#studentBody .nm');

  // Posts
  $('#postList').innerHTML = posts.length ? posts.map(p => `<li class="rrow prow" data-id="${esc(p.id)}">
      <div class="rbody"><div class="snip">${esc(p.title)}</div>
        <div class="meta">${esc(p.board)} · <b>${esc(p.author)}</b> · ${p.comments} comments · ${p.score} points</div>
        <div class="flags">${p.pinned ? '<span class="fl pinned">Pinned</span>' : ''}${p.locked ? '<span class="fl locked">Locked</span>' : ''}</div></div>
      <div class="ra"><button data-pact="pin">${p.pinned ? 'Unpin' : 'Pin'}</button><button data-pact="lock">${p.locked ? 'Unlock' : 'Lock'}</button><button class="dng" data-pact="del">Delete</button></div>
    </li>`).join('') : '<li class="empty">No posts on the board yet.</li>';
}

document.addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b) return;

  if (b.dataset.range) { range = +b.dataset.range; render(); return; }
  if (b.id === 'sampleAdd') {
    if (Mod.addSamples()) Mod.log(me.name, 'added sample posts for the demo');
    else await UI.alert('Sample posts are already on the board. Remove them first to add a fresh set.', { title: 'Already added' });
    render(); return;
  }
  if (b.id === 'sampleRemove') {
    if (Mod.removeSamples()) Mod.log(me.name, 'removed the sample posts');
    else await UI.alert('There are no sample posts on the board.', { title: 'Nothing to remove' });
    render(); return;
  }
  if (b.dataset.rmword) { Filter.remove(b.dataset.rmword); Mod.log(me.name, `removed "${b.dataset.rmword}" from the word filter`); render(); return; }
  if (b.id === 'wordReset') {
    if (await UI.confirm('Replace the list with the default words? Any words you added will be removed.', { title: 'Restore the default list', ok: 'Restore', danger: true })) { Filter.reset(); Mod.log(me.name, 'restored the default word filter list'); }
    render(); return;
  }

  if (b.id === 'resetBtn') {
    if (await UI.confirm('Delete all posts, reports and the activity log? Accounts (and their warnings and bans) are kept.', { title: 'Reset demo data', ok: 'Delete everything', danger: true })) {
      Mod.reset(); render();
    }
    return;
  }

  // Reports
  if (b.dataset.act) {
    const r = Mod.reports().find(x => x.id === b.closest('.rrow').dataset.id);
    if (!r) return;
    const act = b.dataset.act;
    if (act === 'reveal') {
      if (!await UI.confirm('Reveal who wrote this anonymous ' + (r.cid ? 'comment' : 'post') + '? This is recorded in the activity log.', { title: 'Reveal author', ok: 'Reveal', danger: true })) return;
      if (Mod.reveal(r.id)) Mod.log(me.name, `revealed the author of the anonymous ${r.cid ? 'comment on' : 'post'} "${r.title}"`);
      else await UI.alert('The author of this older post could not be found.', { title: 'Cannot reveal' });
      render(); return;
    }
    if (act === 'remove') r.cid ? Mod.removeComment(r.postId, r.cid) : Mod.removePost(r.postId);
    let reason = '';
    if (act === 'warn' || act === 'ban') {
      reason = await UI.prompt(act === 'ban' ? 'Moderators can see this reason later. The student is not shown it.' : 'Optional. Moderators can see this in the history.',
        { title: (act === 'ban' ? 'Ban ' : 'Warn ') + (r.revealed || r.author), label: act === 'ban' ? 'Reason for the ban' : 'Reason for the warning',
          value: `Reported for ${r.reasons.join(', ')}: ${r.cid ? 'comment on ' : ''}"${r.title}"`, required: act === 'ban', ok: act === 'ban' ? 'Ban student' : 'Warn student', danger: act === 'ban' });
      if (reason === null) return;
      Auth.moderate(r.revealed || r.author, act, reason);
    }
    const t = `"${r.title}"`, who = r.revealed || r.author;
    const subj = r.cid ? `${who}'s comment on ${t}` : `${who}'s post ${t}`;
    const [outcome, text] = {
      dismiss: ['Dismissed', `dismissed the report on ${subj}`],
      remove:  [r.cid ? 'Comment removed' : 'Post removed', `removed ${subj}`],
      warn:    ['Student warned', `warned ${who} over ${r.cid ? 'a comment on ' : ''}${t}`],
      ban:     ['Student banned', `banned ${who} over ${r.cid ? 'a comment on ' : ''}${t}`]
    }[act];
    Mod.resolve(r.id, outcome);
    Mod.log(me.name, text + (reason ? ' — ' + reason : ''));
  }

  // Students table
  if (b.dataset.uact) {
    const user = b.closest('tr').dataset.user, act = b.dataset.uact;
    if (act === 'reset') {
      if (!await UI.confirm(`Give ${user} a new temporary password? Their old password will stop working.`, { title: 'Reset password', ok: 'Reset password', danger: true })) return;
      const pw = await Auth.resetPassword(user);
      if (pw) {
        Mod.log(me.name, `reset the password for ${user}`);
        render();
        await UI.alert('Give it to them privately and ask them to change it on their profile page.', { title: 'New password for ' + user, password: pw });
      } else await UI.alert('Make sure you are logged in as a moderator and the account still exists.', { title: 'Could not reset the password' });
      render();
      return;
    }
    const VERB = { warn: 'warned', unwarn: 'removed one warning from', ban: 'banned', unban: 'unbanned' };
    if (act === 'hist') {
      const rec = Auth.roster().find(u => same(u.name, user));
      const h = ((rec && rec.history) || []).slice().reverse();
      await UI.alert(h.length ? '' : 'No warnings or bans yet.', { title: user + ': moderation history',
        list: h.length ? h.map(x => `${new Date(x.t).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })} · ${x.by} ${VERB[x.act]} ${user}${x.reason ? ' — ' + x.reason : ''}`) : undefined });
      return;
    }
    let reason = '';
    if (act === 'ban' || act === 'warn') {
      reason = await UI.prompt(act === 'ban' ? 'Moderators can see this reason later. The student is not shown it.' : 'Optional. Moderators can see this in the history.',
        { title: (act === 'ban' ? 'Ban ' : 'Warn ') + user, label: act === 'ban' ? 'Reason for the ban' : 'Reason for the warning', placeholder: 'e.g. repeated bullying in Campus life', required: act === 'ban', ok: act === 'ban' ? 'Ban student' : 'Warn student', danger: act === 'ban' });
      if (reason === null) return;
    }
    if (Auth.moderate(user, act, reason)) Mod.log(me.name, `${VERB[act]} ${user}${reason ? ' — ' + reason : ''}`);
  }

  // Posts
  if (b.dataset.pact) {
    const id = b.closest('.rrow').dataset.id, act = b.dataset.pact;
    const post = Mod.posts().find(p => p.id === id);
    if (post) {
      if (act === 'del') {
        if (!await UI.confirm(`Delete "${post.title}"? This also deletes its comments and photos.`, { title: 'Delete post', ok: 'Delete', danger: true })) return;
        Mod.removePost(id);
        Mod.log(me.name, `deleted "${post.title}"`);
      } else {
        const key = act === 'pin' ? 'pinned' : 'locked';
        Mod.toggle(id, key);
        Mod.log(me.name, `${post[key] ? 'un' : ''}${key === 'pinned' ? 'pinned' : 'locked'} "${post.title}"`);
      }
    }
  }
  render();
});

// Create a real Supabase account (email + password) so the person can log in
$('#newAcctForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target.elements, err = $('#newAcctErr');
  err.textContent = '';
  const role = f.role.value, name = f.username.value.trim(), email = f.email.value.trim();
  if (role === 'moderator' && !await UI.confirm('Moderators can warn, ban and see every report.', { title: 'Create a moderator account for ' + name + '?', ok: 'Create moderator' })) return;
  const btn = e.target.querySelector('button[type="submit"]');
  if (btn) btn.disabled = true;
  try {
    const res = await SB.createAccount(name, email, f.password.value, role);
    if (res.error) { err.textContent = res.error; return; }
    Mod.log(me.name, 'created a ' + res.role + ' account for ' + name + ' (' + email + ')');
    e.target.reset();
    render();
    const lines = [];
    if (res.generated) lines.push('Temporary password (give it to them privately):');
    else lines.push('They log in with the password you chose. Ask them to change it on their profile page.');
    if (res.needsConfirm) lines.push('A confirmation link was sent to ' + email + '. They must open it before they can log in.');
    if (res.notice) lines.push(res.notice);
    if (res.needRelogin) lines.push('Your moderator session was interrupted (email confirmation is off in Supabase). Log in again.');
    await UI.alert(lines.join('\n\n'), {
      title: 'Account created for ' + name + ' (' + res.role + ')',
      password: res.generated ? res.password : undefined
    });
    if (res.needRelogin) location.replace('login.html');
  } finally {
    if (btn) btn.disabled = false;
  }
});

// Word filter: add a word, switch on/off, test a sentence
$('#wordForm').addEventListener('submit', e => {
  e.preventDefault();
  const res = Filter.add(e.target.elements.word.value);
  $('#wordErr').textContent = res.error || '';
  if (res.ok) { Mod.log(me.name, `added "${res.word}" to the word filter`); e.target.reset(); render(); }
});
$('#filterOn').addEventListener('change', e => { Filter.setOn(e.target.checked); Mod.log(me.name, `turned the word filter ${e.target.checked ? 'on' : 'off'}`); render(); });
$('#wordTest').addEventListener('input', e => {
  const t = e.target.value.trim(), hit = t && Filter.match(t);
  $('#wordTestOut').textContent = !t ? '' : !Filter.get().on ? 'The filter is off, so this would be allowed.' : hit ? `Blocked: it contains “${hit}”.` : 'Allowed.';
  $('#wordTestOut').className = 'testout ' + (hit ? 'bad' : 'ok');
});

// Reports made on the board in another tab show up here without a refresh
document.addEventListener('change', e => {
  const s = e.target.closest && e.target.closest('[data-urole]'); if (!s) return;
  const user = s.closest('tr').dataset.user;
  if (Auth.setRole(user, s.value)) Mod.log(me.name, 'changed the role of ' + user + ' to ' + Auth.roleLabel(s.value));
  render();
});
window.addEventListener('storage', render);
render();