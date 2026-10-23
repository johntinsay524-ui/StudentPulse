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
    if (res.error) err.textContent = res.error;
    else if (res.notice) {
      form.reset();
      // Sign-up worked but the email still has to be confirmed: tell the student clearly what to do next.
      if (res.sent && window.UI) await UI.alert('We sent a confirmation link to ' + res.email + '.', {
        title: 'Check your email',
        list: ['Open the email from Student Pulse (look in Spam or Junk if you do not see it).', 'Click the confirmation link in it.', 'Come back to the login page and log in with your email and password.'],
        ok: 'OK, got it'
      });
    }
    else go(res.role);
  });
}
wire('loginForm',  f => SB.login(f.get('email'), f.get('password')));
wire('signupForm', f => SB.signup(f.get('username'), f.get('email'), f.get('password'), f.get('confirm'), f.get('role')));
