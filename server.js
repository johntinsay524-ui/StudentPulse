// Student Pulse server: static files + JSON API + SQLite database. Needs Node 22.5+, no npm packages.
// Run: node server.js   (then open http://localhost:3000)
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { findBlockedWord, normalize: normalizeWord } = require('./word-filter.js');
const db = new DatabaseSync(process.env.DB || path.join(__dirname, 'studentpulse.db'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT UNIQUE COLLATE NOCASE NOT NULL, display TEXT, role TEXT NOT NULL DEFAULT 'student',
  bio TEXT DEFAULT '', avatar TEXT DEFAULT '', salt TEXT, hash TEXT, joined INTEGER, warns INTEGER DEFAULT 0, banned INTEGER DEFAULT 0,
  ban_reason TEXT, banned_by TEXT, banned_at INTEGER, welcomed INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS history(id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, t INTEGER, by TEXT, act TEXT, reason TEXT);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, created INTEGER);
CREATE TABLE IF NOT EXISTS posts(id INTEGER PRIMARY KEY, board TEXT, mood TEXT, title TEXT, body TEXT DEFAULT '', image TEXT DEFAULT '',
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL, anonymous INTEGER DEFAULT 0, created INTEGER, edited INTEGER DEFAULT 0, pinned INTEGER DEFAULT 0, locked INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS comments(id INTEGER PRIMARY KEY, post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE, author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  anonymous INTEGER DEFAULT 0, body TEXT DEFAULT '', image TEXT DEFAULT '', created INTEGER, edited INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS votes(post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, v INTEGER, PRIMARY KEY(post_id,user_id));
CREATE TABLE IF NOT EXISTS reports(id INTEGER PRIMARY KEY, post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE, comment_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  reasons TEXT, reporters TEXT, status TEXT DEFAULT 'open', outcome TEXT, revealed TEXT, created INTEGER);
CREATE TABLE IF NOT EXISTS logs(id INTEGER PRIMARY KEY, who TEXT, text TEXT, t INTEGER);
CREATE TABLE IF NOT EXISTS words(word TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);`);
const q = (s, ...a) => db.prepare(s).all(...a), one = (s, ...a) => db.prepare(s).get(...a), run = (s, ...a) => db.prepare(s).run(...a);
const NAME = /^[A-Za-z0-9_]{3,20}$/, ROLES = ['student', 'teacher', 'staff', 'moderator'], SERIOUS = ['Bullying', 'Harassment', 'Threat or safety concern'];
const BOARDS = ['Events', 'Campus life', 'Academics', 'Facilities', 'Suggestions'], MOODS = ['happy', 'meh', 'stressed', 'upset'];
const DEFAULT_WORDS = ['idiot', 'stupid', 'loser', 'dumb', 'shut up', 'kill yourself'];
const now = () => Date.now(), fail = (c, m) => { throw { c, m }; };
const hp = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
const tmp = () => { const c = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'; return [...crypto.randomBytes(10)].map(b => c[b % c.length]).join(''); };
const mkUser = (name, pw, role) => { const salt = crypto.randomBytes(8).toString('hex'); return Number(run('INSERT INTO users(name,role,salt,hash,joined) VALUES(?,?,?,?,?)', name, role, salt, hp(pw, salt), now()).lastInsertRowid); };
const log = (who, text) => run('INSERT INTO logs(who,text,t) VALUES(?,?,?)', who, text, now());
if (!one('SELECT id FROM users LIMIT 1')) { const pw = tmp(); mkUser('moderator', pw, 'moderator'); console.log('First run. Moderator login: moderator /', pw, '(change it on the profile page)'); }
if (!one('SELECT word FROM words LIMIT 1') && !one("SELECT 1 FROM settings WHERE key='seeded'")) { DEFAULT_WORDS.forEach(w => run('INSERT INTO words VALUES(?)', w)); run("INSERT INTO settings VALUES('seeded','1')"); }

const pub = u => ({ name: u.name, display: u.display || u.name, role: u.role, bio: u.bio || '', avatar: u.avatar || '', joined: u.joined });
function blocked(u, ...texts) {   // word filter (moderators exempt)
  if (u.role === 'moderator' || (one("SELECT value v FROM settings WHERE key='filter_off'") || {}).v === '1') return;
  const word = findBlockedWord(texts.join('\n'), q('SELECT word FROM words').map(row => row.word));
  if (word) fail(422, 'Your text includes “' + word + '”, which is not allowed on this board. Please rephrase it.');
}
const need = (me, role) => { if (!me) fail(401, 'Please log in.'); if (role && me.role !== role) fail(403, 'Moderators only.'); return me; };
const userByName = n => one('SELECT * FROM users WHERE name=?', String(n));
const shown = (row, anon) => anon ? 'Anonymous' : row.an || 'Anonymous';

const R = [], on = (m, p, f) => R.push([m, new RegExp('^' + p + '$'), f]);
// ---- accounts ----
on('POST', '/api/signup', ({ b, login }) => {
  const name = String(b.username || '').trim(), pw = String(b.password || '');
  if (!NAME.test(name)) fail(400, 'Username must be 3–20 letters, numbers or underscores.');
  if (name.toLowerCase() === 'anonymous' || userByName(name)) fail(409, 'That username is taken.');
  if (pw.length < 8) fail(400, 'Password must be at least 8 characters.');
  if (pw !== b.confirm) fail(400, 'Passwords do not match.');
  const id = mkUser(name, pw, 'student'); login(id); return { ok: true, role: 'student' };
});
on('POST', '/api/login', ({ b, login }) => {
  const u = userByName(String(b.username || '').trim());
  if (!u || hp(String(b.password || ''), u.salt) !== u.hash) fail(401, 'Wrong username or password.');
  if (u.banned) fail(403, 'This account has been banned by a moderator.');
  login(u.id); return { ok: true, role: u.role };
});
on('POST', '/api/logout', ({ tok }) => { run('DELETE FROM sessions WHERE token=?', tok || ''); return { ok: true }; });
on('GET', '/api/me', ({ me }) => { need(me); return { ...pub(me), welcomed: !!me.welcomed, warns: me.warns }; });
on('PATCH', '/api/me', ({ me, b }) => {
  need(me);
  const d = 'display' in b ? String(b.display).trim().slice(0, 30) : me.display, bio = 'bio' in b ? String(b.bio).slice(0, 160) : me.bio;
  if (d && d.toLowerCase() !== me.name.toLowerCase() && (d.toLowerCase() === 'anonymous' || userByName(d))) fail(409, 'That name is already used by someone else.');
  blocked(me, d || '', bio);
  run('UPDATE users SET display=?,bio=?,avatar=?,welcomed=? WHERE id=?', d && d !== me.name ? d : null, bio, 'avatar' in b ? String(b.avatar) : me.avatar, b.welcomed ? 1 : me.welcomed, me.id);
  return { ok: true };
});
on('POST', '/api/me/password', ({ me, b }) => {
  need(me); const n = String(b.newPassword || '');
  if (hp(String(b.oldPassword || ''), me.salt) !== me.hash) fail(403, 'Wrong current password.');
  if (n.length < 8) fail(400, 'New password must be at least 8 characters.');
  const salt = crypto.randomBytes(8).toString('hex'); run('UPDATE users SET salt=?,hash=? WHERE id=?', salt, hp(n, salt), me.id); return { ok: true };
});
on('POST', '/api/me/rename', ({ me, b }) => {
  need(me); const n = String(b.username || '').trim();
  if (hp(String(b.password || ''), me.salt) !== me.hash) fail(403, 'Wrong password.');
  if (!NAME.test(n)) fail(400, 'Username must be 3–20 letters, numbers or underscores.');
  const o = userByName(n); if (n.toLowerCase() === 'anonymous' || (o && o.id !== me.id)) fail(409, 'That username is taken.');
  run('UPDATE users SET name=? WHERE id=?', n, me.id); return { ok: true };   // posts reference the user id, so they follow the new name
});
on('DELETE', '/api/me', ({ me, b, res }) => {
  need(me); if (me.role === 'moderator') fail(403, 'Moderator accounts cannot be deleted here.');
  if (hp(String(b.password || ''), me.salt) !== me.hash) fail(403, 'Wrong password.');
  run('DELETE FROM users WHERE id=?', me.id); return { ok: true };   // posts and comments stay, shown as Anonymous
});
on('GET', '/api/users/([^/]+)', ({ me, m }) => {
  need(me); const u = userByName(decodeURIComponent(m[1])); if (!u) fail(404, 'Not found.');
  const mine = q('SELECT id,board,mood,title,body,image,created,(SELECT COUNT(*) FROM comments WHERE post_id=posts.id) cm FROM posts WHERE author_id=? AND anonymous=0 ORDER BY id DESC', u.id);
  return { ...pub(u), posts: mine, comments: one('SELECT COUNT(*) n FROM comments WHERE author_id=? AND anonymous=0', u.id).n };
});
// ---- posts, comments, votes ----
const cmOut = (c, me) => ({ id: c.id, author: shown(c, c.anonymous), role: c.anonymous ? 'student' : c.ar || 'student', mine: c.author_id === me.id, body: c.body, image: c.image, edited: !!c.edited, created: c.created });
on('GET', '/api/posts', ({ me }) => {
  need(me);
  const sc = Object.fromEntries(q('SELECT post_id i,SUM(v) s FROM votes GROUP BY post_id').map(r => [r.i, r.s]));
  const mv = Object.fromEntries(q('SELECT post_id i,v FROM votes WHERE user_id=?', me.id).map(r => [r.i, r.v]));
  const rep = new Set(q("SELECT post_id p,comment_id c,reporters r FROM reports WHERE status='open'").filter(r => JSON.parse(r.r).includes(me.name)).map(r => r.c ? 'c' + r.c : 'p' + r.p));
  const cms = q('SELECT c.*,u.name an,u.role ar FROM comments c LEFT JOIN users u ON u.id=c.author_id ORDER BY c.id');
  return q('SELECT p.*,u.name an,u.role ar FROM posts p LEFT JOIN users u ON u.id=p.author_id ORDER BY p.pinned DESC,p.id DESC').map(p => ({
    id: p.id, board: p.board, mood: p.mood, title: p.title, body: p.body, image: p.image, author: shown(p, p.anonymous), role: p.anonymous ? 'student' : p.ar || 'student',
    mine: p.author_id === me.id, edited: !!p.edited, pinned: !!p.pinned, locked: !!p.locked, created: p.created, score: sc[p.id] || 0, myVote: mv[p.id] || 0, reported: rep.has('p' + p.id),
    comments: cms.filter(c => c.post_id === p.id).map(c => ({ ...cmOut(c, me), reported: rep.has('c' + c.id) })) }));
});
on('POST', '/api/posts', ({ me, b }) => {
  need(me); const title = String(b.title || '').trim().slice(0, 120), body = String(b.body || '').trim();
  if (!title) fail(400, 'A title is required.'); if (!BOARDS.includes(b.board) || !MOODS.includes(b.mood)) fail(400, 'Choose a board and a mood.');
  blocked(me, title, body);
  const id = Number(run('INSERT INTO posts(board,mood,title,body,image,author_id,anonymous,created) VALUES(?,?,?,?,?,?,?,?)', b.board, b.mood, title, body, String(b.image || ''), me.id, b.anonymous ? 1 : 0, now()).lastInsertRowid);
  run('INSERT INTO votes VALUES(?,?,1)', id, me.id); return { id };   // your own post starts with your upvote
});
const ownPost = (me, id) => { need(me); const p = one('SELECT * FROM posts WHERE id=?', id); if (!p) fail(404, 'Post not found.'); return p; };
on('PATCH', '/api/posts/(\\d+)', ({ me, b, m }) => {
  const p = ownPost(me, m[1]); if (p.author_id !== me.id) fail(403, 'Only the author can edit this.');
  const title = String(b.title ?? p.title).trim().slice(0, 120), body = String(b.body ?? p.body).trim(), image = 'image' in b ? String(b.image) : p.image;
  if (!title) fail(400, 'A title is required.'); blocked(me, title, body);
  run('UPDATE posts SET title=?,body=?,image=?,edited=? WHERE id=?', title, body, image, (title !== p.title || body !== p.body || image !== p.image) ? 1 : p.edited, p.id); return { ok: true };
});
on('DELETE', '/api/posts/(\\d+)', ({ me, m }) => {
  const p = ownPost(me, m[1]); if (p.author_id !== me.id && me.role !== 'moderator') fail(403, 'Not allowed.');
  run('DELETE FROM posts WHERE id=?', p.id); if (p.author_id !== me.id) log(me.name, 'deleted "' + p.title + '"'); return { ok: true };
});
on('POST', '/api/posts/(\\d+)/vote', ({ me, b, m }) => {
  const p = ownPost(me, m[1]), v = Math.sign(+b.v || 0);
  v ? run('INSERT INTO votes VALUES(?,?,?) ON CONFLICT(post_id,user_id) DO UPDATE SET v=excluded.v', p.id, me.id, v) : run('DELETE FROM votes WHERE post_id=? AND user_id=?', p.id, me.id);
  return { ok: true };
});
on('POST', '/api/posts/(\\d+)/flag', ({ me, b, m }) => {   // pin / lock
  need(me, 'moderator'); const p = ownPost(me, m[1]), k = b.key === 'locked' ? 'locked' : 'pinned';
  run(`UPDATE posts SET ${k}=? WHERE id=?`, p[k] ? 0 : 1, p.id); log(me.name, (p[k] ? 'un' : '') + k + ' "' + p.title + '"'); return { ok: true };
});
on('POST', '/api/posts/(\\d+)/comments', ({ me, b, m }) => {
  const p = ownPost(me, m[1]); if (p.locked) fail(403, 'This post is locked.');
  const body = String(b.body || '').trim(), image = String(b.image || ''); if (!body && !image) fail(400, 'A comment cannot be empty.');
  blocked(me, body); return { id: Number(run('INSERT INTO comments(post_id,author_id,anonymous,body,image,created) VALUES(?,?,?,?,?,?)', p.id, me.id, b.anonymous ? 1 : 0, body.slice(0, 500), image, now()).lastInsertRowid) };
});
const ownCm = (me, id) => { need(me); const c = one('SELECT * FROM comments WHERE id=?', id); if (!c) fail(404, 'Comment not found.'); return c; };
on('PATCH', '/api/comments/(\\d+)', ({ me, b, m }) => {
  const c = ownCm(me, m[1]); if (c.author_id !== me.id) fail(403, 'Only the author can edit this.');
  const body = String(b.body ?? c.body).trim().slice(0, 500), image = 'image' in b ? String(b.image) : c.image;
  if (!body && !image) fail(400, 'A comment cannot be empty.'); blocked(me, body);
  run('UPDATE comments SET body=?,image=?,edited=? WHERE id=?', body, image, (body !== c.body || image !== c.image) ? 1 : c.edited, c.id); return { ok: true };
});
on('DELETE', '/api/comments/(\\d+)', ({ me, m }) => {
  const c = ownCm(me, m[1]); if (c.author_id !== me.id && me.role !== 'moderator') fail(403, 'Not allowed.');
  run('DELETE FROM comments WHERE id=?', c.id); return { ok: true };
});
// ---- reports and moderation ----
on('POST', '/api/reports', ({ me, b }) => {
  need(me); const p = ownPost(me, +b.postId), c = b.commentId ? ownCm(me, +b.commentId) : null;
  if ((c || p).author_id === me.id) fail(400, 'You cannot report your own post or comment.');
  let r = one("SELECT * FROM reports WHERE post_id=? AND COALESCE(comment_id,0)=? AND status='open'", p.id, c ? c.id : 0);
  const reasons = r ? JSON.parse(r.reasons) : [], reporters = r ? JSON.parse(r.reporters) : [];
  if (!reasons.includes(b.reason)) reasons.push(String(b.reason)); if (!reporters.includes(me.name)) reporters.push(me.name);
  if (r) run('UPDATE reports SET reasons=?,reporters=? WHERE id=?', JSON.stringify(reasons), JSON.stringify(reporters), r.id);
  else run('INSERT INTO reports(post_id,comment_id,reasons,reporters,created) VALUES(?,?,?,?,?)', p.id, c ? c.id : null, JSON.stringify(reasons), JSON.stringify(reporters), now());
  return { ok: true };
});
on('GET', '/api/reports', ({ me }) => {
  need(me, 'moderator');
  return q(`SELECT r.*,p.title,p.board,p.anonymous pa,pu.name pn,c.anonymous ca,c.body cbody,cu.name cn FROM reports r LEFT JOIN posts p ON p.id=r.post_id LEFT JOIN users pu ON pu.id=p.author_id
    LEFT JOIN comments c ON c.id=r.comment_id LEFT JOIN users cu ON cu.id=c.author_id ORDER BY r.id DESC`).map(r => {
    const anon = r.comment_id ? r.ca : r.pa, who = r.comment_id ? r.cn : r.pn;
    return { id: r.id, postId: r.post_id, commentId: r.comment_id, title: r.title, board: r.board, excerpt: (r.cbody || '').slice(0, 80), reasons: JSON.parse(r.reasons), reporters: JSON.parse(r.reporters),
      status: r.status, outcome: r.outcome, created: r.created, author: r.revealed || (anon ? 'Anonymous' : who || 'Deleted user'), revealed: !!r.revealed, canReveal: !!anon && !r.revealed && !!who && JSON.parse(r.reasons).some(x => SERIOUS.includes(x)) };
  });
});
on('POST', '/api/reports/(\\d+)/reveal', ({ me, m }) => {
  need(me, 'moderator'); const r = one('SELECT * FROM reports WHERE id=?', m[1]); if (!r) fail(404, 'Report not found.');
  if (!JSON.parse(r.reasons).some(x => SERIOUS.includes(x))) fail(403, 'Only reports for bullying, harassment or threats allow this.');
  const u = one(r.comment_id ? 'SELECT u.name FROM comments c JOIN users u ON u.id=c.author_id WHERE c.id=?' : 'SELECT u.name FROM posts c JOIN users u ON u.id=c.author_id WHERE c.id=?', r.comment_id || r.post_id);
  if (!u) fail(404, 'The author could not be found.');
  run('UPDATE reports SET revealed=? WHERE id=?', u.name, r.id); log(me.name, 'revealed the author of an anonymous ' + (r.comment_id ? 'comment' : 'post') + ' (report #' + r.id + ')'); return { author: u.name };
});
on('POST', '/api/reports/(\\d+)/resolve', ({ me, b, m }) => {
  need(me, 'moderator'); run("UPDATE reports SET status='done',outcome=? WHERE id=?", String(b.outcome || 'Dismissed'), m[1]); log(me.name, 'resolved report #' + m[1] + ': ' + (b.outcome || 'Dismissed')); return { ok: true };
});
on('GET', '/api/users', ({ me }) => { need(me, 'moderator'); return q('SELECT * FROM users ORDER BY id').map(u => ({ ...pub(u), warns: u.warns, banned: !!u.banned, banReason: u.ban_reason, bannedBy: u.banned_by, bannedAt: u.banned_at,
  posts: one('SELECT COUNT(*) n FROM posts WHERE author_id=?', u.id).n, history: q('SELECT t,by,act,reason FROM history WHERE user_id=? ORDER BY id', u.id) })); });
on('POST', '/api/users', ({ me, b }) => {   // moderators create accounts
  need(me, 'moderator'); const name = String(b.username || '').trim(), role = ROLES.includes(b.role) ? b.role : 'student';
  if (!NAME.test(name)) fail(400, 'Username must be 3–20 letters, numbers or underscores.'); if (name.toLowerCase() === 'anonymous' || userByName(name)) fail(409, 'That username is taken.');
  const gen = !b.password, pw = gen ? tmp() : String(b.password); if (!gen && pw.length < 8) fail(400, 'Password must be at least 8 characters (or leave it blank to generate one).');
  mkUser(name, pw, role); log(me.name, 'created a ' + role + ' account for ' + name); return { ok: true, role, password: pw, generated: gen };
});
on('POST', '/api/users/([^/]+)/action', ({ me, b, m }) => {   // warn, unwarn, ban, unban, reset, role
  need(me, 'moderator'); const u = userByName(decodeURIComponent(m[1])); if (!u || u.role === 'moderator') fail(404, 'Account not found.');
  const act = b.act, note = String(b.reason || '').trim().slice(0, 200), hist = () => run('INSERT INTO history(user_id,t,by,act,reason) VALUES(?,?,?,?,?)', u.id, now(), me.name, act, note);
  let out = { ok: true };
  if (act === 'warn') { run('UPDATE users SET warns=warns+1 WHERE id=?', u.id); hist(); }
  else if (act === 'unwarn' && u.warns) { run('UPDATE users SET warns=warns-1 WHERE id=?', u.id); hist(); }
  else if (act === 'ban') { if (!note) fail(400, 'Please write a reason.'); run('UPDATE users SET banned=1,ban_reason=?,banned_by=?,banned_at=? WHERE id=?', note, me.name, now(), u.id); run('DELETE FROM sessions WHERE user_id=?', u.id); hist(); }
  else if (act === 'unban') { run('UPDATE users SET banned=0,ban_reason=NULL,banned_by=NULL,banned_at=NULL WHERE id=?', u.id); hist(); }
  else if (act === 'reset') { const pw = tmp(), salt = crypto.randomBytes(8).toString('hex'); run('UPDATE users SET salt=?,hash=? WHERE id=?', salt, hp(pw, salt), u.id); run('DELETE FROM sessions WHERE user_id=?', u.id); out = { ok: true, password: pw }; }
  else if (act === 'role' && ['student', 'teacher', 'staff'].includes(b.role)) run('UPDATE users SET role=? WHERE id=?', b.role, u.id);
  else fail(400, 'Unknown action.');
  log(me.name, act + ' ' + u.name + (act === 'role' ? ' → ' + b.role : '') + (note ? ' — ' + note : '')); return out;
});
on('GET', '/api/logs', ({ me }) => { need(me, 'moderator'); return q('SELECT who,text,t FROM logs ORDER BY id DESC LIMIT 50'); });
on('GET', '/api/words', ({ me }) => { need(me, 'moderator'); return { on: !one("SELECT 1 FROM settings WHERE key='filter_off' AND value='1'"), list: q('SELECT word FROM words ORDER BY word').map(r => r.word) }; });
on('PUT', '/api/words', ({ me, b }) => {
  need(me, 'moderator');
  if (!Array.isArray(b.list) || b.list.length > 200) fail(400, 'The word list must contain no more than 200 entries.');
  const list = [], seen = new Set();
  for (const value of b.list) {
    if (typeof value !== 'string') fail(400, 'Every blocked word or phrase must be text.');
    const word = value.trim().toLowerCase().replace(/\s+/g, ' ');
    const normalized = normalizeWord(word);
    if (word.length < 2 || word.length > 40 || !normalized) fail(400, 'Each blocked word or phrase must be 2–40 characters and include a letter or number.');
    if (!seen.has(normalized)) { seen.add(normalized); list.push(word); }
  }
  db.exec('BEGIN');
  try {
    run('DELETE FROM words');
    list.forEach(w => run('INSERT INTO words VALUES(?)', w));
    run("INSERT INTO settings VALUES('filter_off',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", b.on === false ? '1' : '0');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  log(me.name, 'updated the word filter'); return { ok: true };
});
on('POST', '/api/reset', ({ me }) => { need(me, 'moderator'); ['reports', 'logs', 'posts'].forEach(t => run('DELETE FROM ' + t)); return { ok: true }; });

// ---- HTTP plumbing ----
const MIME = { html: 'text/html', css: 'text/css', js: 'text/javascript', png: 'image/png', ico: 'image/x-icon' };
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x'), send = (c, o, h = {}) => { res.writeHead(c, { 'Content-Type': 'application/json', ...h }); res.end(JSON.stringify(o)); };
  if (!url.pathname.startsWith('/api/')) {   // static files (never the database or server code)
    const f = path.basename(url.pathname === '/' ? 'login.html' : url.pathname), ext = f.split('.').pop();
    if (MIME[ext] && f !== 'server.js' && fs.existsSync(path.join(__dirname, f))) { res.writeHead(200, { 'Content-Type': MIME[ext] + '; charset=utf-8' }); return fs.createReadStream(path.join(__dirname, f)).pipe(res); }
    res.writeHead(404); return res.end('Not found');
  }
  let raw = ''; req.on('data', d => { raw += d; if (raw.length > 15e6) req.destroy(); });
  req.on('end', () => {
    try {
      const tok = (/(?:^|;\s*)sp=([a-f0-9]+)/.exec(req.headers.cookie || '') || [])[1];
      const me = tok ? one('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND u.banned=0', tok) : null;
      const route = R.find(([m, re]) => m === req.method && re.test(url.pathname)); if (!route) fail(404, 'Unknown endpoint.');
      if (req.method !== 'GET' && !/application\/json/.test(req.headers['content-type'] || '')) fail(415, 'JSON only.');   // blocks cross-site form posts
      let b = {}; try { b = raw ? JSON.parse(raw) : {}; } catch { fail(400, 'Bad JSON.'); }
      let cookie = '';
      const login = id => { const t = crypto.randomBytes(24).toString('hex'); run('INSERT INTO sessions VALUES(?,?,?)', t, id, now()); cookie = 'sp=' + t + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800'; };
      const out = route[2]({ me, b, m: route[1].exec(url.pathname), tok, login, res });
      send(200, out, cookie ? { 'Set-Cookie': cookie } : {});
    } catch (e) { if (e && e.c) send(e.c, { error: e.m }); else { console.error(e); send(500, { error: 'Server error.' }); } }
  });
}).listen(process.env.PORT || 3000, () => console.log('Student Pulse on http://localhost:' + (process.env.PORT || 3000)));
