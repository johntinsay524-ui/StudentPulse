// Shared login logic. DEMO ONLY: accounts live in this browser's localStorage,
// so this is NOT real security. See the note in the chat about adding a server.
const Auth = (() => {
  const USERS = 'studentpulse_users', SESSION = 'studentpulse_session';
  const read = k => { try { return JSON.parse(Store.get(k)); } catch { return null; } };
  const ROLES = { student: 'Student', teacher: 'Teacher', staff: 'Staff', moderator: 'Moderator' };
  const roleLabel = r => ROLES[r] || 'Student';
  const users = () => read(USERS) || {};
  const save = u => Store.set(USERS, JSON.stringify(u));

  async function hash(pw, salt) {
    const data = new TextEncoder().encode(salt + ':' + pw);
    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', data);
      return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
    }
    return btoa(salt + ':' + pw); // fallback if the browser has no crypto.subtle
  }
  const newSalt = () => [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('');

  // First run: create one default moderator account
  async function seed() {
    if (Object.keys(users()).length) return;
    const salt = newSalt();
    save({ moderator: { name: 'moderator', role: 'moderator', joined: Date.now(), bio: '', avatar: '', salt, hash: await hash('studentpulse123', salt) } });
  }

  async function signup(name, pw, pw2) {
    await seed();
    name = name.trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(name)) return { error: 'Username must be 3–20 letters, numbers or underscores.' };
    if (name.toLowerCase() === 'anonymous') return { error: 'That username is taken.' };
    if (pw.length < 8) return { error: 'Password must be at least 8 characters.' };
    if (pw !== pw2) return { error: 'Passwords do not match.' };
    const all = users(), key = name.toLowerCase();
    if (all[key]) return { error: 'That username is taken.' };
    const salt = newSalt();
    all[key] = { name, role: 'student', joined: Date.now(), bio: '', avatar: '', salt, hash: await hash(pw, salt) };   // sign-ups are always students
    save(all);
    start(all[key]);
    return { ok: true, role: 'student' };
  }

  async function login(name, pw) {
    await seed();
    const u = users()[name.trim().toLowerCase()];
    if (!u || u.hash !== await hash(pw, u.salt)) return { error: 'Wrong username or password.' };
    if (u.banned) return { error: 'This account has been banned by a moderator.' };
    start(u);
    return { ok: true, role: u.role };
  }

  // Public profile info (never includes the password hash)
  const profile = name => {
    const u = users()[String(name).toLowerCase()];
    return u ? { name: u.name, role: u.role, bio: u.bio || '', avatar: u.avatar || '', joined: u.joined || null, display: u.display || u.name } : null;
  };
  // Lets the logged-in user change their own bio / avatar
  const updateProfile = patch => {
    const s = session(); if (!s) return false;
    const all = users(), u = all[s.name.toLowerCase()]; if (!u) return false;
    if ('bio' in patch) u.bio = String(patch.bio).slice(0, 160);
    if ('avatar' in patch) u.avatar = patch.avatar;
    if ('display' in patch) { const d = String(patch.display).trim().slice(0, 30); if (d && d !== u.name) u.display = d; else delete u.display; }
    return save(all) || !Store.ok;
  };

  // Small round profile picture (or the first letter) to show beside a name
  const avatar = name => {
    name = String(name).trim();
    const s = document.createElement('span');
    s.className = 'av'; s.dataset.name = name; s.setAttribute('aria-hidden', 'true');
    const p = name === 'Anonymous' ? null : profile(name);
    if (p && p.avatar) {
      const img = document.createElement('img');
      img.src = p.avatar; img.alt = '';
      s.appendChild(img);
    } else s.textContent = name === 'Anonymous' ? '?' : name[0].toUpperCase();
    return s;
  };
  // Put an avatar in front of every matching name element (replaces old ones)
  // showDisplay=true also swaps the text for the person's display name.
  // The real username is kept in data-user, so links, reports and moderation still use it.
  const decorate = (sel, showDisplay) => document.querySelectorAll(sel).forEach(n => {
    const user = n.dataset.user || n.textContent.trim();
    n.dataset.user = user;
    if (showDisplay) { const p = user === 'Anonymous' ? null : profile(user); n.textContent = p ? p.display : user; }
    const prev = n.previousElementSibling;
    if (prev && prev.classList.contains('av')) prev.remove();
    n.parentNode.querySelectorAll(':scope > .rb').forEach(x => x.remove());
    n.before(avatar(user));
    const pr = showDisplay && user !== 'Anonymous' ? profile(user) : null;
    if (pr && pr.role !== 'student') { const b = document.createElement('span'); b.className = 'rb r-' + pr.role; b.textContent = roleLabel(pr.role); n.after(b); }
  });

  // Moderation info about accounts
  const roster = () => Object.values(users()).map(u => ({ name: u.name, role: u.role, joined: u.joined || null, warns: u.warns || 0, banned: !!u.banned, banReason: u.banReason || '', bannedAt: u.bannedAt || null, bannedBy: u.bannedBy || '', history: u.history || [] }));
  const standing = name => { const u = users()[String(name).toLowerCase()]; return { warns: u ? u.warns || 0 : 0, banned: !!(u && u.banned) }; };
  const moderate = (name, act, reason = '') => {
    const s = session(); if (!s || s.role !== 'moderator') return false;
    const all = users(), u = all[String(name).toLowerCase()];
    if (!u || u.role === 'moderator') return false;
    const note = String(reason).trim().slice(0, 200), now = Date.now();
    if (act === 'warn') u.warns = (u.warns || 0) + 1;
    else if (act === 'unwarn') { if (!u.warns) return false; u.warns -= 1; }
    else if (act === 'ban') { u.banned = true; u.banReason = note; u.bannedAt = now; u.bannedBy = s.name; }
    else if (act === 'unban') { u.banned = false; delete u.banReason; delete u.bannedAt; delete u.bannedBy; }
    else return false;
    u.history = [...(u.history || []), { t: now, by: s.name, act, reason: note }].slice(-50);   // who did what, when and why
    save(all); return true;
  };

  // Change your own username. Needs your password. Posts, comments, votes and reports follow the new name.
  async function rename(newName, pw) {
    const s = session(); if (!s) return { error: 'Please log in again.' };
    newName = String(newName).trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(newName)) return { error: 'Username must be 3–20 letters, numbers or underscores.' };
    const all = users(), oldKey = s.name.toLowerCase(), newKey = newName.toLowerCase(), u = all[oldKey];
    if (!u) return { error: 'Account not found.' };
    if (u.hash !== await hash(pw, u.salt)) return { error: 'Wrong password.' };
    if (newName === u.name) return { error: 'That is already your username.' };
    if (newKey === 'anonymous' || (newKey !== oldKey && all[newKey])) return { error: 'That username is taken.' };
    const old = u.name;
    delete all[oldKey]; u.name = newName; all[newKey] = u;
    save(all); start(u);
    Mod.renameUser(old, newName);
    return { ok: true };
  }

  // Delete your own student account. Needs your password.
  // Their posts and comments stay on the board but show as "Anonymous".
  async function deleteAccount(pw) {
    const s = session(); if (!s) return { error: 'Please log in again.' };
    const all = users(), key = s.name.toLowerCase(), u = all[key];
    if (!u) return { error: 'Account not found.' };
    if (u.role === 'moderator') return { error: 'Moderator accounts cannot be deleted here.' };
    if (u.hash !== await hash(pw, u.salt)) return { error: 'Wrong password.' };
    delete all[key]; save(all);
    Mod.forgetUser(u.name);
    Store.remove(SESSION);
    return { ok: true };
  }

  // ---- Moderator tools and password change ----
  const TEMP = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const tempPassword = () => [...crypto.getRandomValues(new Uint8Array(10))].map(b => TEMP[b % TEMP.length]).join('');

  // Moderators only: give a student a new temporary password (the old one stops working). Returns the password, or null.
  async function resetPassword(name) {
    const s = session(); if (!s || s.role !== 'moderator') return null;
    const all = users(), u = all[String(name).toLowerCase()];
    if (!u || u.role === 'moderator') return null;
    const pw = tempPassword();
    u.salt = newSalt(); u.hash = await hash(pw, u.salt);
    return save(all) || !Store.ok ? pw : null;
  }

  // Moderators only: create a student (or moderator) account without logging in as it.
  async function createAccount(name, pw, role) {
    const s = session(); if (!s || s.role !== 'moderator') return { error: 'Only moderators can create accounts.' };
    name = String(name).trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(name)) return { error: 'Username must be 3–20 letters, numbers or underscores.' };
    const all = users(), key = name.toLowerCase();
    if (key === 'anonymous' || all[key]) return { error: 'That username is taken.' };
    const generated = !pw;
    if (generated) pw = tempPassword();
    else if (pw.length < 8) return { error: 'Password must be at least 8 characters (or leave it blank to generate one).' };
    const salt = newSalt();
    all[key] = { name, role: ROLES[role] ? role : 'student', joined: Date.now(), bio: '', avatar: '', salt, hash: await hash(pw, salt) };
    save(all);
    return { ok: true, password: pw, generated, role: all[key].role };
  }

  // Moderators only: change a member's role (student, teacher or staff).
  const setRole = (name, role) => {
    const s = session(); if (!s || s.role !== 'moderator' || !ROLES[role] || role === 'moderator') return false;
    const all = users(), u = all[String(name).toLowerCase()];
    if (!u || u.role === 'moderator') return false;
    u.role = role; return save(all) || !Store.ok;
  };

  // Change your own password. Needs your current password.
  async function changePassword(oldPw, newPw, newPw2) {
    const s = session(); if (!s) return { error: 'Please log in again.' };
    const all = users(), u = all[s.name.toLowerCase()];
    if (!u) return { error: 'Account not found.' };
    if (u.hash !== await hash(oldPw, u.salt)) return { error: 'Wrong current password.' };
    if (newPw.length < 8) return { error: 'New password must be at least 8 characters.' };
    if (newPw !== newPw2) return { error: 'New passwords do not match.' };
    if (newPw === oldPw) return { error: 'Choose a password different from your current one.' };
    u.salt = newSalt(); u.hash = await hash(newPw, u.salt);
    save(all);
    return { ok: true };
  }

  // First-visit welcome screen (students only)
  const needsWelcome = () => { const s = session(); const u = s && users()[s.name.toLowerCase()]; return !!(u && u.role !== 'moderator' && !u.welcomed); };
  const markWelcomed = () => { const s = session(); if (!s) return; const all = users(), u = all[s.name.toLowerCase()]; if (u) { u.welcomed = true; save(all); } };

  const start = u => Store.set(SESSION, JSON.stringify({ name: u.name, role: u.role }));
  const session = () => read(SESSION);
  const logout = () => { Store.remove(SESSION); location.replace('login.html'); };

  // Page guards: put these in <head> so the page never shows to the wrong person
  // Checks who is logged in. Runs on load AND every time the page is shown again
  // (the browser's Back button can bring back an old copy without reloading it),
  // and also when you log out in another tab.
  const check = role => {
    let s = session();
    const rec = s && users()[s.name.toLowerCase()];
    if (s && (!rec || rec.banned)) { Store.remove(SESSION); s = null; }   // banned while logged in: kick out
    const target = !s ? 'login.html' : (role === 'moderator' && s.role !== 'moderator') ? 'index.html' : null;
    if (target) {
      document.documentElement.style.visibility = 'hidden';   // don't flash the page
      location.replace(target);
    }
  };
  const guard = role => {
    check(role);
    window.addEventListener('pageshow', () => check(role));
    window.addEventListener('storage', () => check(role));
  };
  const requireLogin = () => guard();
  const requireMod = () => guard('moderator');

  return { ROLES, roleLabel, setRole, needsWelcome, markWelcomed, resetPassword, createAccount, changePassword, rename, deleteAccount, roster, standing, moderate, avatar, decorate, seed, signup, login, logout, session, profile, updateProfile, requireLogin, requireMod };
})();

// Reports, moderation log, and moderator access to the board's saved posts.
// DEMO ONLY (same as Auth): everything lives in this browser's localStorage.
const Mod = (() => {
  const RKEY = 'studentpulse_reports', LKEY = 'studentpulse_log', FKEY = 'studentpulse_feed_v2';
  const read = (k, d) => { try { const v = JSON.parse(Store.get(k)); return v == null ? d : v; } catch { return d; } };
  const write = (k, v) => Store.set(k, JSON.stringify(v));

  const reports = () => read(RKEY, []);
  // One open report per post; more reporters/reasons get added to it
  function report(post, reporter, reason) {
    const all = reports();
    let r = all.find(x => x.postId === post.id && (x.cid || '') === (post.cid || '') && x.status === 'open');
    if (!r) {
      r = { id: Date.now() + '-' + post.id + (post.cid ? '-' + post.cid : ''), postId: post.id, author: post.author, title: post.title, board: post.board,
            reasons: [], reporters: [], time: Date.now(), status: 'open' };
      if (post.cid) { r.cid = post.cid; r.excerpt = post.excerpt || ''; }   // a report on a comment
      all.push(r);
    }
    if (!r.reporters.includes(reporter)) r.reporters.push(reporter);
    if (!r.reasons.includes(reason)) r.reasons.push(reason);
    write(RKEY, all);
  }
  const reportedBy = name => new Set(reports().filter(r => r.status === 'open' && r.reporters.includes(name)).map(r => r.cid || r.postId));   // a post's id, or a comment's id
  const resolve = (id, outcome) => {
    const all = reports(), r = all.find(x => x.id === id);
    if (r) { r.status = 'done'; r.outcome = outcome; write(RKEY, all); }
  };

  const logs = () => read(LKEY, []);
  const log = (who, text) => write(LKEY, [{ who, text, t: Date.now() }, ...logs()].slice(0, 50));

  const feedDoc = () => new DOMParser().parseFromString(Store.get(FKEY) || '', 'text/html');
  const count = (p, k) => (p.dataset[k] || '').split(',').filter(Boolean).length;
  const posts = () => [...feedDoc().querySelectorAll('.post')].map(p => ({
    id: p.dataset.id, board: p.dataset.board, mood: p.dataset.mood, t: +p.dataset.t || 0, sample: p.dataset.sample === '1',
    title: p.querySelector('h2').textContent,
    author: (p.querySelector('.meta .n') || {}).textContent || '',
    comments: p.querySelectorAll('.cm').length,
    score: count(p, 'up') - count(p, 'down'),
    pinned: p.dataset.pinned === '1', locked: p.dataset.locked === '1'
  })).sort((a, b) => b.id - a.id);
  const editPost = (id, fn) => {
    const d = feedDoc(), p = d.querySelector('.post[data-id="' + id + '"]');
    if (!p) return false;
    fn(p); Store.set(FKEY, d.body.innerHTML); return true;
  };
  const removePost = id => editPost(id, p => p.remove());
  const removeComment = (postId, cid) => editPost(postId, p => {
    const c = p.querySelector('.cm[data-cid="' + cid + '"]'); if (c) c.remove();
    const n = p.querySelector('.cm-count'); if (n) n.textContent = p.querySelectorAll('.cm').length;
  });
  const liveComments = () => new Set([...feedDoc().querySelectorAll('.cm[data-cid]')].map(c => c.dataset.cid));
  // Sample posts spread over the last 3 weeks, so the "mood over time" chart can be demonstrated
  const MOOD_TAG = { happy: '😊 Happy', meh: '😐 Meh', stressed: '😟 Stressed', upset: '😠 Frustrated' };
  const SAMPLES = [
    ['Events', 'Pep rally was great', 'The band and the cheer squad really brought the energy.'],
    ['Academics', 'Too many tests this week', 'Three quizzes and a project due on the same days.'],
    ['Facilities', 'Water fountain on the 2nd floor', 'It has been broken for a while now.'],
    ['Campus life', 'Lunch lines are very long', 'We only get about ten minutes to eat after queuing.'],
    ['Suggestions', 'Quiet study hour after class', 'A supervised room would help a lot of us.'],
    ['Events', 'Science fair sign-ups', 'Does anyone know when sign-ups close?'],
    ['Academics', 'Feeling good about the new schedule', 'Longer breaks make the day easier.'],
    ['Campus life', 'Club fair was fun', 'Lots of new clubs to look at this year.']
  ];
  const WHO = ['maria_s', 'jay_k', 'lea_p', 'omar_t', 'nina_r'];
  const addSamples = () => {
    const raw = Store.get(FKEY) || '', d = feedDoc();
    if (d.querySelector('.post[data-sample="1"]')) return false;
    if (!d.querySelector('#empty')) d.body.insertAdjacentHTML('beforeend', '<div class="empty" id="empty" hidden>Nothing here yet. Be the first to post!</div>');
    let id = Math.max(100, ...[...d.querySelectorAll('.post')].map(p => +p.dataset.id + 1));
    let seed = 7; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
    const days = 21, now = Date.now(), html = [];
    for (let i = days - 1; i >= 0; i--) {
      const exam = i >= 6 && i <= 11;                              // a stressful stretch, then recovery
      const w = exam ? [.15, .2, .45, .2] : i < 6 ? [.4, .3, .18, .12] : [.3, .3, .25, .15];
      const n = 1 + Math.floor(rnd() * (exam ? 4 : 3));
      for (let k = 0; k < n; k++) {
        const r = rnd(); let m = 0, acc = w[0]; while (r > acc && m < 3) acc += w[++m];
        const mood = ['happy', 'meh', 'stressed', 'upset'][m];
        const [board, title, body] = SAMPLES[Math.floor(rnd() * SAMPLES.length)];
        const t = now - i * 864e5 - Math.floor(rnd() * 8) * 36e5;
        const when = new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
        html.push('<article class="card post" data-id="' + (id++) + '" data-board="' + board + '" data-mood="' + mood + '" data-up="" data-down="" data-t="' + t + '" data-sample="1"><div class="pb"><div class="meta"><span class="b">' + board + '</span> · <span class="n">' + WHO[Math.floor(rnd() * WHO.length)] + '</span> · ' + when + '<span class="tag">' + MOOD_TAG[mood] + '</span></div><h2>' + title + '</h2><p>' + body + '</p><div class="acts"><button data-a="cm">💬 <span class="cm-count">0</span> comments</button><button data-a="rp">Report</button><button class="dng remove" data-a="rm">Remove</button></div><div class="cmts" hidden><div class="cm-list"></div><form class="cm-form"><input class="cm-text" placeholder="Add a comment"><label class="photo-btn" title="Add a photo">📷<input type="file" class="cm-file vh" accept="image/*"></label><button>Reply</button><div class="cm-prev" hidden><img alt="Preview of the photo you are adding"><button type="button" class="cm-rm">Remove photo</button></div></form></div></div></article>');
      }
    }
    d.body.insertAdjacentHTML('afterbegin', html.reverse().join(''));
    Store.set(FKEY, d.body.innerHTML);
    return true;
  };
  const removeSamples = () => { const d = feedDoc(), s = d.querySelectorAll('.post[data-sample="1"]'); if (!s.length) return false; s.forEach(p => p.remove()); Store.set(FKEY, d.body.innerHTML); return true; };
  const toggle = (id, key) => editPost(id, p => { if (p.dataset[key] === '1') delete p.dataset[key]; else p.dataset[key] = '1'; });
  // Reveal who wrote an anonymous post. Only allowed for serious reports (bullying, harassment, threats).
  const SERIOUS = ['Bullying', 'Harassment', 'Threat or safety concern'];
  const reveal = id => {
    const all = reports(), r = all.find(x => x.id === id);
    if (!r || !r.reasons.some(x => SERIOUS.includes(x))) return false;
    const d = feedDoc();
    const target = r.cid ? d.querySelector('.cm[data-cid="' + r.cid + '"]') : d.querySelector('.post[data-id="' + r.postId + '"]');
    const owner = target && target.dataset.owner;
    if (!owner) return false;
    r.revealed = owner; write(RKEY, all); return true;
  };
  const reset = () => [RKEY, LKEY, FKEY, 'studentpulse_admin'].forEach(k => Store.remove(k));

  // Used when a student renames or deletes their account
  const rewriteFeed = fn => { if (!Store.get(FKEY)) return; const d = feedDoc(); fn(d); Store.set(FKEY, d.body.innerHTML); };
  const swapVote = (p, from, to) => ['up', 'down'].forEach(k => {
    const l = (p.dataset[k] || '').split(',').filter(Boolean);
    if (!l.includes(from)) return;
    const rest = l.filter(x => x !== from);
    if (to) rest.push(to);
    p.dataset[k] = rest.join(',');
  });
  const mapReports = (fn) => write(RKEY, reports().map(fn));
  const renameUser = (old, nw) => {
    rewriteFeed(d => {
      d.querySelectorAll('.meta .n, .cm .n').forEach(n => { if (n.textContent.trim() === old) n.textContent = nw; });
      d.querySelectorAll('.post').forEach(p => swapVote(p, old.toLowerCase(), nw.toLowerCase()));
      d.querySelectorAll('[data-owner]').forEach(x => { if (x.dataset.owner.toLowerCase() === old.toLowerCase()) x.dataset.owner = nw; });   // hidden author of anonymous posts/comments
    });
    mapReports(r => ({ ...r, author: r.author === old ? nw : r.author, revealed: r.revealed === old ? nw : r.revealed, reporters: r.reporters.map(x => x === old ? nw : x) }));
    write(LKEY, logs().map(l => l.who === old ? { ...l, who: nw } : l));
  };
  const forgetUser = name => {
    rewriteFeed(d => {
      d.querySelectorAll('.meta .n, .cm .n').forEach(n => { if (n.textContent.trim() === name) n.textContent = 'Anonymous'; });
      d.querySelectorAll('.post').forEach(p => swapVote(p, name.toLowerCase(), null));
      d.querySelectorAll('[data-owner]').forEach(x => { if (x.dataset.owner.toLowerCase() === name.toLowerCase()) x.removeAttribute('data-owner'); });   // deleted account: nobody can be revealed any more
    });
    mapReports(r => ({ ...r, author: r.author === name ? 'Anonymous' : r.author, revealed: r.revealed === name ? 'Deleted user' : r.revealed, reporters: r.reporters.map(x => x === name ? 'Deleted user' : x) }));
  };

  return { renameUser, forgetUser, report, reports, reportedBy, resolve, log, logs, posts, removePost, removeComment, liveComments, addSamples, removeSamples, toggle, reveal, reset };
})();

// Banned-words filter. DEMO: the word list lives in this browser. Moderators manage it on the moderator page.
// Students are blocked from posting text that contains a listed word or phrase; moderators are exempt.
const Filter = (() => {
  const KEY = 'studentpulse_words';
  const DEFAULTS = ['idiot', 'stupid', 'loser', 'dumb', 'shut up', 'kill yourself'];
  const read = () => {
    try { const v = JSON.parse(Store.get(KEY)); if (v && Array.isArray(v.list)) return { on: v.on !== false, list: v.list }; } catch {}
    return { on: true, list: DEFAULTS.slice() };
  };
  const write = v => Store.set(KEY, JSON.stringify(v));
  const norm = s => String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ');
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // The listed word that appears in the text (whole words only), or null. Ignores who is logged in.
  const match = text => {
    const { on, list } = read(); if (!on) return null;
    const t = ' ' + norm(text) + ' ';
    for (const w of list) {
      const n = norm(w).trim(); if (!n) continue;
      if (new RegExp('[^\\p{L}\\p{N}]' + esc(n) + '(?=[^\\p{L}\\p{N}])', 'u').test(t)) return w;
    }
    return null;
  };
  const check = text => { const s = Auth.session(); return s && s.role === 'moderator' ? null : match(text); };
  const get = () => read();
  const add = word => {
    word = String(word).trim().toLowerCase().replace(/\s+/g, ' ');
    if (word.length < 2) return { error: 'Type a word or phrase (at least 2 characters).' };
    if (word.length > 40) return { error: 'Keep it under 40 characters.' };
    const v = read();
    if (v.list.some(w => norm(w) === norm(word))) return { error: 'That word is already on the list.' };
    if (v.list.length >= 200) return { error: 'The list is full (200 words).' };
    v.list.push(word); write(v); return { ok: true, word };
  };
  const remove = word => { const v = read(); v.list = v.list.filter(w => w !== word); write(v); };
  const setOn = on => { const v = read(); v.on = !!on; write(v); };
  const reset = () => write({ on: true, list: DEFAULTS.slice() });
  const message = w => 'Your text includes “' + w + '”, which is not allowed on this board. Please rephrase it.';
  return { check, match, get, add, remove, setOn, reset, message };
})();
