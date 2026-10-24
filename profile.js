const $ = s => document.querySelector(s);
const MOODS = { happy: '😊 Happy', meh: '😐 Meh', stressed: '😟 Stressed', upset: '😠 Frustrated' };
const ago = t => { const m = Math.round((Date.now() - new Date(t)) / 6e4); return m < 1 ? 'just now' : m < 60 ? m + 'm ago' : m < 1440 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago'; };

let authUser, prof = null, own = false, newAvatar = null;   // newAvatar: null = unchanged, '' = remove, else data URL
const form = $('#editForm');

$('#logoutBtn').addEventListener('click', async () => { await sb.auth.signOut(); Auth.logout(); });

const verify = async pw => !(await sb.auth.signInWithPassword({ email: authUser.email, password: pw })).error;

function setAvatar(el, url, name) {
  el.textContent = '';
  if (url) { const img = document.createElement('img'); img.src = url; img.alt = name + "'s profile photo"; el.appendChild(img); }
  else el.textContent = name[0].toUpperCase();
}
const shape = r => r && { name: r.username, display: r.display || r.username, role: r.role, bio: r.bio || '', avatar: r.avatar || '', joined: r.joined };

function renderHeader() {
  document.title = prof.display + ' — Student Pulse';
  $('#pname').textContent = prof.display;
  const role = $('#prole');
  role.textContent = Auth.roleLabel(prof.role);
  role.className = 'rolepill r-' + prof.role;
  $('#pjoined').textContent = (prof.display !== prof.name ? '@' + prof.name + ' · ' : '') + (prof.joined
    ? 'Joined ' + new Date(prof.joined).toLocaleDateString([], { month: 'long', year: 'numeric' }) : '');
  $('#pbio').textContent = prof.bio || (own ? 'Add a short bio so other students know who you are.' : 'No bio yet.');
  setAvatar($('#avatar'), prof.avatar, prof.name);
  $('#editBtn').hidden = !own;
  $('#ptitle').textContent = own ? 'Your posts' : prof.display + "'s posts";
}

// Anonymous posts have no author in posts_public, so they never show on a profile.
async function renderPosts() {
  const [{ data: posts }, { count }] = await Promise.all([
    sb.from('posts_public').select('*').eq('author', prof.name).order('id', { ascending: false }),
    sb.from('comments_public').select('id', { count: 'exact', head: true }).eq('author', prof.name)
  ]);
  const mine = posts || [];
  const per = {};
  if (mine.length) ((await sb.from('comments_public').select('post_id').in('post_id', mine.map(p => p.id))).data || []).forEach(c => per[c.post_id] = (per[c.post_id] || 0) + 1);
  $('#nPosts').textContent = mine.length;
  $('#nCm').textContent = count || 0;

  const list = $('#plist');
  list.textContent = '';
  mine.forEach(p => {
    const card = document.createElement('article'); card.className = 'card pitem';
    const m = document.createElement('div'); m.className = 'meta';
    m.textContent = p.board + ' · ' + ago(p.created) + ' · ' + MOODS[p.mood];
    card.appendChild(m);
    const h = document.createElement('h3'); h.textContent = p.title; card.appendChild(h);
    if (p.body) { const bp = document.createElement('p'); bp.textContent = p.body; card.appendChild(bp); }
    if (p.image) { const im = document.createElement('img'); im.className = 'pimg'; im.src = p.image; im.alt = 'Photo attached to the post'; card.appendChild(im); }
    const c = document.createElement('div'); c.className = 'meta'; c.textContent = '💬 ' + (per[p.id] || 0) + ' comments';
    card.appendChild(c);
    list.appendChild(card);
  });
  const empty = $('#pempty');
  empty.hidden = mine.length > 0;
  empty.textContent = own ? "You haven't posted yet. Share how school is going on the board!" : 'No posts yet.';
}

// ---- editing your own profile ----
$('#editBtn').addEventListener('click', () => {
  newAvatar = null;
  $('#bioIn').value = prof.bio;
  $('#dispIn').value = prof.display === prof.name ? '' : prof.display;
  setAvatar($('#avPreview'), prof.avatar, prof.name);
  $('#err').textContent = '';
  form.hidden = false; $('#editBtn').hidden = true;
});
$('#cancelBtn').addEventListener('click', () => { form.hidden = true; $('#editBtn').hidden = false; });

$('#avFile').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  try { newAvatar = await readImage(file, { max: 256, quality: 0.8, square: true }); setAvatar($('#avPreview'), newAvatar, prof.name); $('#err').textContent = ''; }
  catch (err) { $('#err').textContent = err.message; }
  e.target.value = '';
});
$('#avRemove').addEventListener('click', () => { newAvatar = ''; setAvatar($('#avPreview'), '', prof.name); });

form.addEventListener('submit', async e => {
  e.preventDefault();
  const disp = $('#dispIn').value.trim(), err = $('#err');
  err.textContent = '';
  if (disp.toLowerCase() === 'anonymous') { err.textContent = 'That name is already used by someone else.'; return; }
  // blank (or same as the username) is stored as NULL, because display names must be unique
  const patch = { bio: $('#bioIn').value.trim().slice(0, 160), display: disp && disp.toLowerCase() !== prof.name.toLowerCase() ? disp : null };
  if (newAvatar !== null) patch.avatar = newAvatar;
  const { error } = await sb.from('profiles').update(patch).eq('id', authUser.id);
  if (error) { err.textContent = error.code === '23505' ? 'That name is already used by someone else.' : error.message; return; }
  const { data } = await sb.from('profiles').select('*').eq('id', authUser.id).single();
  prof = shape(data);
  form.hidden = true;
  renderHeader();
});

// ---- account settings ----
$('#nameForm').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#nameErr'); err.textContent = '';
  if (!await verify($('#namePw').value)) { err.textContent = 'Wrong password.'; return; }
  const n = $('#newName').value.trim();
  const { error } = await sb.rpc('rename_me', { n });
  if (error) { err.textContent = error.message; return; }
  try { const s = JSON.parse(Store.get('studentpulse_session')); s.name = n; Store.set('studentpulse_session', JSON.stringify(s)); } catch {}
  location.replace('profile.html');
});

$('#passForm').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#passErr'), ok = $('#passOk'); err.textContent = ''; ok.textContent = '';
  const oldPw = $('#oldPw').value, a = $('#newPw').value, b = $('#newPw2').value;
  if (a.length < 8) { err.textContent = 'New password must be at least 8 characters.'; return; }
  if (a !== b) { err.textContent = 'New passwords do not match.'; return; }
  if (a === oldPw) { err.textContent = 'Choose a password different from your current one.'; return; }
  if (!await verify(oldPw)) { err.textContent = 'Wrong current password.'; return; }
  const { error } = await sb.auth.updateUser({ password: a });
  if (error) { err.textContent = error.message; return; }
  e.target.reset(); ok.textContent = 'Password changed.';
});

$('#delForm').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#delErr'); err.textContent = '';
  if (!await UI.confirm('This cannot be undone. Your posts and comments stay on the board as “Anonymous”.', { title: 'Delete your account permanently?', ok: 'Delete my account', danger: true })) return;
  if (!await verify($('#delPw').value)) { err.textContent = 'Wrong password.'; return; }
  const { error } = await sb.rpc('delete_me');
  if (error) { err.textContent = error.message; return; }
  await sb.auth.signOut(); Store.remove('studentpulse_session');
  location.replace('login.html');
});

// ---- start ----
(async () => {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return Auth.logout();
  authUser = user;
  const { data: mineRow } = await sb.from('profiles').select('*').eq('id', user.id).single();
  const wanted = new URLSearchParams(location.search).get('user');
  let row = mineRow;
  if (wanted && mineRow && wanted.toLowerCase() !== mineRow.username.toLowerCase())
    row = (await sb.from('profiles').select('*').eq('username', wanted).maybeSingle()).data;
  prof = shape(row);
  own = !!prof && !!mineRow && row.id === mineRow.id;

  if (!prof) { ['pcard', 'pstats', 'ptitle'].forEach(id => $('#' + id).hidden = true); $('#nf').hidden = false; return; }
  renderHeader();
  if (own) { $('#acct').hidden = false; if (prof.role === 'moderator') $('#delForm').hidden = true; }
  renderPosts();
})();