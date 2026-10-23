// Supabase login and sign-up. People sign up with an email (confirmed by link), a username and a role; they log in with the email.
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const SB = (() => {
  async function finish() {
    const { data: { user } } = await sb.auth.getUser();
    const { data: p } = await sb.from('profiles').select('*').eq('id', user.id).single();
    const { data: st } = await sb.from('standing').select('banned').eq('user_id', user.id).single();
    if (!p || (st && st.banned)) { await sb.auth.signOut(); return { error: 'This account has been banned by a moderator.' }; }
    bridge(p);
    return { ok: true, role: p.role };
  }
  // TEMPORARY: the board, profile and moderator pages still read the browser's saved data until they are moved to Supabase.
  // This copies the logged-in profile there (no password) so they keep working. Delete it when those pages are converted.
  function bridge(p) {
    let u = {}; try { u = JSON.parse(Store.get('studentpulse_users')) || {}; } catch {}
    const k = p.username.toLowerCase();
    u[k] = { ...(u[k] || {}), name: p.username, role: p.role, joined: Date.parse(p.joined), bio: p.bio || '', avatar: p.avatar || '', salt: 'x', hash: 'x' };
    Store.set('studentpulse_users', JSON.stringify(u));
    Store.set('studentpulse_session', JSON.stringify({ name: p.username, role: p.role }));
  }
  return {
    async login(email, pw) {
      const { error } = await sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: pw });
      if (error) return { error: /confirm/i.test(error.message) ? 'Please confirm your email first. Check your inbox (and spam) for the link.' : 'Wrong email or password.' };
      return finish();
    },
    async signup(name, email, pw, pw2, role) {
      name = name.trim(); email = email.trim().toLowerCase();
      if (!/^[A-Za-z0-9_]{3,20}$/.test(name)) return { error: 'Username must be 3–20 letters, numbers or underscores.' };
      if (!['student', 'teacher', 'staff'].includes(role)) return { error: 'Please choose whether you are a student, teacher or staff.' };
      if (!/^\S+@\S+\.\S+$/.test(email)) return { error: 'Enter a valid email address.' };
      if (pw.length < 8) return { error: 'Password must be at least 8 characters.' };
      if (pw !== pw2) return { error: 'Passwords do not match.' };
      const { data: free, error: freeErr } = await sb.rpc('username_free', { n: name });
      if (freeErr) return { error: 'Could not check the username: ' + freeErr.message };
      if (free === false) return { error: 'That username is taken.' };
      // The role is only a label (badge). The database accepts student, teacher or staff and never moderator.
      // The confirmation link lands on confirmed.html, which tells the person their account is ready.
      const { data, error } = await sb.auth.signUp({ email, password: pw, options: { data: { username: name, role }, emailRedirectTo: new URL('confirmed.html', location.href).href } });
      if (error) return { error: error.message };
      // When "Confirm email" is on, Supabase answers an already-registered email with an empty identities list instead of an error.
      if (data.user && data.user.identities && data.user.identities.length === 0) return { error: 'That email already has an account. Try logging in instead.' };
      if (data.session) return finish();   // only if confirmation is switched off in Supabase
      return { sent: true, email, notice: 'Almost done! We sent a confirmation link to ' + email + '. Open it, then come back here and log in.' };
    },
    logout: async () => { await sb.auth.signOut(); }
  };
})();
