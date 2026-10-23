// Form handling for login.html and signup.html
const go = role => location.replace(role === 'moderator' ? 'admin.html' : 'index.html');

// Already logged in? Skip the form.
const skipIfLoggedIn = () => { const s = Auth.session(); if (s) go(s.role); };
skipIfLoggedIn();
window.addEventListener('pageshow', skipIfLoggedIn);
Auth.seed();

function wire(formId, action) {
  const form = document.getElementById(formId);
  if (!form) return;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const err = document.getElementById('err');
    err.textContent = '';
    const f = new FormData(form);
    const res = await action(f);
    if (res.error) err.textContent = res.error; else go(res.role);
  });
}
wire('loginForm',  f => Auth.login(f.get('username'), f.get('password')));
wire('signupForm', f => Auth.signup(f.get('username'), f.get('password'), f.get('confirm')));
