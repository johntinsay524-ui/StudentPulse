// Form handling for login.html and signup.html
const go = role => location.replace(role === 'moderator' ? 'admin.html' : 'index.html');

// Already logged in? Skip the form.
const skipIfLoggedIn = () => { const s = Auth.session(); if (s) go(s.role); };
skipIfLoggedIn();
window.addEventListener('pageshow', skipIfLoggedIn);

function wire(formId, action) {
  const form = document.getElementById(formId);
  if (!form) return;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const err = document.getElementById('err');
    err.textContent = '';
    const f = new FormData(form);
    const res = await action(f);
    const nt = document.getElementById('notice'); if (nt) nt.textContent = res.notice || '';
    if (res.error) err.textContent = res.error; else if (res.notice) form.reset(); else go(res.role);
  });
}
wire('loginForm',  f => SB.login(f.get('email'), f.get('password')));
wire('signupForm', f => SB.signup(f.get('username'), f.get('email'), f.get('password'), f.get('confirm')));
