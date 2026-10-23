const $ = s => document.querySelector(s);

const me = Auth.session();
const wanted = new URLSearchParams(location.search).get('user') || me.name;
let prof = Auth.profile(wanted);
// Sample authors on the board (no account) still get a simple profile
if (!prof && wanted !== 'Anonymous') {
  const doc = new DOMParser().parseFromString(Store.get('studentpulse_feed_v2') || '', 'text/html');
  if ([...doc.querySelectorAll('.meta .n, .cm .n')].some(n => n.textContent === wanted))
    prof = { name: wanted, role: 'student', bio: '', avatar: '', joined: null };
}
if (prof && !prof.display) prof.display = prof.name;
const own = !!prof && prof.name.toLowerCase() === me.name.toLowerCase();

$('#logoutBtn').addEventListener('click', Auth.logout);

function setAvatar(el, url, name) {
  el.textContent = '';
  if (url) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = name + "'s profile photo";
    el.appendChild(img);
  } else {
    el.textContent = name[0].toUpperCase();
  }
}

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

// Posts and comments are read from the board's saved data.
// Anonymous posts show as "Anonymous" there, so they never appear on anyone's profile.
function renderPosts() {
  const html = Store.get('studentpulse_feed_v2') || '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const mine = [...doc.querySelectorAll('.post')]
    .filter(p => (p.querySelector('.meta .n') || {}).textContent === prof.name)
    .sort((a, b) => b.dataset.id - a.dataset.id);
  const comments = [...doc.querySelectorAll('.cm .n')].filter(n => n.textContent === prof.name).length;

  $('#nPosts').textContent = mine.length;
  $('#nCm').textContent = comments;

  const list = $('#plist');
  list.textContent = '';
  mine.forEach(p => {
    const meta = p.querySelector('.meta').cloneNode(true);
    meta.querySelector('.tag').remove();
    const time = meta.textContent.split(' · ')[2] || '';
    const card = document.createElement('article');
    card.className = 'card pitem';

    const m = document.createElement('div');
    m.className = 'meta';
    m.textContent = p.dataset.board + (time ? ' · ' + time.trim() : '') + ' · ';
    const tag = document.createElement('span');
    tag.textContent = p.querySelector('.tag').textContent;
    m.appendChild(tag);
    card.appendChild(m);

    const h = document.createElement('h3');
    h.textContent = p.querySelector('h2').textContent;
    card.appendChild(h);

    const body = p.querySelector('.pb > p');
    if (body) { const bp = document.createElement('p'); bp.textContent = body.textContent; card.appendChild(bp); }

    const pic = p.querySelector('.pimg');
    if (pic) { const im = document.createElement('img'); im.className = 'pimg'; im.src = pic.getAttribute('src'); im.alt = 'Photo attached to the post'; card.appendChild(im); }

    const c = document.createElement('div');
    c.className = 'meta';
    c.textContent = '💬 ' + p.querySelectorAll('.cm').length + ' comments';
    card.appendChild(c);
    list.appendChild(card);
  });

  const empty = $('#pempty');
  empty.hidden = mine.length > 0;
  empty.textContent = own ? "You haven't posted yet. Share how school is going on the board!" : 'No posts yet.';
}

// Editing (only on your own profile)
let newAvatar = null;           // null = unchanged, '' = remove photo, otherwise a data URL
const form = $('#editForm');

$('#editBtn').addEventListener('click', () => {
  newAvatar = null;
  $('#bioIn').value = prof.bio;
  $('#dispIn').value = prof.display === prof.name ? '' : prof.display;
  setAvatar($('#avPreview'), prof.avatar, prof.name);
  $('#err').textContent = '';
  form.hidden = false;
  $('#editBtn').hidden = true;
});
$('#cancelBtn').addEventListener('click', () => { form.hidden = true; $('#editBtn').hidden = false; });

$('#avFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    newAvatar = await readImage(file, { max: 256, quality: 0.8, square: true });
    setAvatar($('#avPreview'), newAvatar, prof.name);
    $('#err').textContent = '';
  } catch (err) { $('#err').textContent = err.message; }
  e.target.value = '';
});
$('#avRemove').addEventListener('click', () => { newAvatar = ''; setAvatar($('#avPreview'), '', prof.name); });

form.addEventListener('submit', e => {
  e.preventDefault();
  const disp = $('#dispIn').value.trim();
  if (disp && disp.toLowerCase() !== prof.name.toLowerCase() && (disp.toLowerCase() === 'anonymous' || Auth.profile(disp))) {
    $('#err').textContent = 'That name is already used by someone else.'; return;
  }
  const bad = Filter.check(disp + ' \n ' + $('#bioIn').value);
  if (bad) { $('#err').textContent = Filter.message(bad); return; }
  const patch = { bio: $('#bioIn').value.trim(), display: disp };
  if (newAvatar !== null) patch.avatar = newAvatar;
  if (!Auth.updateProfile(patch)) { $('#err').textContent = 'Could not save. The browser may be out of space.'; return; }
  prof = Auth.profile(prof.name);
  form.hidden = true;
  renderHeader();
});

if (!prof) {
  ['pcard', 'pstats', 'ptitle'].forEach(id => $('#' + id).hidden = true);
  $('#nf').hidden = false;
} else {
  renderHeader();
  renderPosts();
}

// Account settings (only on your own profile)
if (own) {
  $('#acct').hidden = false;
  if (prof.role === 'moderator') $('#delForm').hidden = true;   // moderators can't delete themselves here
}

$('#nameForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('#nameErr').textContent = '';
  const res = await Auth.rename($('#newName').value, $('#namePw').value);
  if (res.error) { $('#nameErr').textContent = res.error; return; }
  location.replace('profile.html');   // reload so every page shows the new name
});

$('#passForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('#passErr').textContent = ''; $('#passOk').textContent = '';
  const res = await Auth.changePassword($('#oldPw').value, $('#newPw').value, $('#newPw2').value);
  if (res.error) { $('#passErr').textContent = res.error; return; }
  e.target.reset();
  $('#passOk').textContent = 'Password changed.';
});

$('#delForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('#delErr').textContent = '';
  if (!await UI.confirm('This cannot be undone. Your posts and comments stay on the board as “Anonymous”.', { title: 'Delete your account permanently?', ok: 'Delete my account', danger: true })) return;
  const res = await Auth.deleteAccount($('#delPw').value);
  if (res.error) { $('#delErr').textContent = res.error; return; }
  location.replace('login.html');
});
