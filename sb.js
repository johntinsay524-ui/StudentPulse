// Supabase login and sign-up. Students type a username; behind the scenes it becomes a private email address.
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const SB = (() => {
  const emailOf = n => n.trim().toLowerCase() + '@users.studentpulse.app';
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
    async login(name, pw) {
      const { error } = await sb.auth.signInWithPassword({ email: emailOf(name), password: pw });
      return error ? { error: 'Wrong username or password.' } : finish();
    },
    async signup(name, pw, pw2) {
      name = name.trim();
      if (!/^[A-Za-z0-9_]{3,20}$/.test(name)) return { error: 'Username must be 3–20 letters, numbers or underscores.' };
      if (pw.length < 8) return { error: 'Password must be at least 8 characters.' };
      if (pw !== pw2) return { error: 'Passwords do not match.' };
      const { data: free } = await sb.rpc('username_free', { n: name });
      if (!free) return { error: 'That username is taken.' };
      const { data, error } = await sb.auth.signUp({ email: emailOf(name), password: pw, options: { data: { username: name } } });
      if (error) return { error: error.message };
      if (!data.session) return { error: 'Sign-up needs "Confirm email" switched off in Supabase (Authentication > Providers > Email).' };
      return finish();
    },
    logout: async () => { await sb.auth.signOut(); }
  };
})();
