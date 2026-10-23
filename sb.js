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
    logout: async () => { await sb.auth.signOut(); },

    // Moderators only: create a real Supabase account (email + password) so the person can log in.
    // Uses a separate client so signUp does not replace the moderator's session.
    async createAccount(name, email, pw, role) {
      try {
        name = String(name || '').trim();
        email = String(email || '').trim().toLowerCase();
        role = ['student', 'teacher', 'staff', 'moderator'].includes(role) ? role : 'student';
        if (!/^[A-Za-z0-9_]{3,20}$/.test(name)) return { error: 'Username must be 3–20 letters, numbers or underscores.' };
        if (!/^\S+@\S+\.\S+$/.test(email)) return { error: 'Enter a valid email address.' };
        const generated = !pw;
        if (generated) {
          const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
          pw = [...crypto.getRandomValues(new Uint8Array(10))].map(b => chars[b % chars.length]).join('');
        } else if (String(pw).length < 8) {
          return { error: 'Password must be at least 8 characters (or leave it blank to generate one).' };
        }

        // Moderator must still have a live Supabase session (localStorage-only is not enough for RPCs)
        const { data: sess } = await sb.auth.getSession();
        if (!sess.session) {
          return { error: 'Your moderator login has expired. Log out, log in again with your email, then try creating the account.' };
        }

        const { data: free, error: freeErr } = await sb.rpc('username_free', { n: name });
        if (freeErr) return { error: 'Could not check the username: ' + freeErr.message };
        if (free === false) return { error: 'That username is taken.' };

        // Separate client: signUp must not touch the moderator's stored session
        const signupClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
        });
        const metaRole = role === 'moderator' ? 'student' : role;
        const { data, error } = await signupClient.auth.signUp({
          email,
          password: pw,
          options: {
            data: { username: name, role: metaRole },
            emailRedirectTo: new URL('confirmed.html', location.href).href
          }
        });
        if (error) return { error: error.message };
        if (data.user && data.user.identities && data.user.identities.length === 0) {
          return { error: 'That email already has an account.' };
        }
        if (!data.user) return { error: 'Supabase did not return a user. Check Authentication settings in the dashboard.' };

        // Promote role when needed (needs the moderator's session on the main client)
        let finalRole = metaRole;
        let notice = '';
        if (role !== 'student') {
          const { error: roleErr } = await sb.rpc('mod_set_role', { uname: name, new_role: role });
          if (roleErr) {
            notice = 'Account created as student. Role could not be set: ' + roleErr.message +
              ' Run supabase-migration-mod-create.sql in the SQL Editor, then change the role on this page.';
          } else {
            finalRole = role;
          }
        }

        // Keep the moderator Students table in sync (local bridge)
        let u = {}; try { u = JSON.parse(Store.get('studentpulse_users')) || {}; } catch {}
        u[name.toLowerCase()] = {
          ...(u[name.toLowerCase()] || {}),
          name, role: finalRole, joined: Date.now(), bio: '', avatar: '', salt: 'x', hash: 'x'
        };
        Store.set('studentpulse_users', JSON.stringify(u));

        return {
          ok: true,
          password: pw,
          generated,
          role: finalRole,
          email,
          needsConfirm: !data.session,
          notice: notice || undefined
        };
      } catch (e) {
        return { error: (e && e.message) ? e.message : String(e) };
      }
    },

    // Moderators only: permanently delete a non-moderator account from Supabase Auth.
    // Their posts and comments stay on the board and show as Anonymous.
    async deleteAccount(name) {
      try {
        name = String(name || '').trim();
        if (!name) return { error: 'No username given.' };
        const { data: sess } = await sb.auth.getSession();
        if (!sess.session) {
          return { error: 'Your moderator login has expired. Log out, log in again, then try deleting the account.' };
        }
        const { error } = await sb.rpc('mod_delete_account', { uname: name });
        if (error) return { error: error.message };

        // Remove from local bridge so the Students table updates
        let u = {}; try { u = JSON.parse(Store.get('studentpulse_users')) || {}; } catch {}
        delete u[name.toLowerCase()];
        Store.set('studentpulse_users', JSON.stringify(u));
        if (typeof Mod !== 'undefined' && Mod.forgetUser) Mod.forgetUser(name);

        return { ok: true };
      } catch (e) {
        return { error: (e && e.message) ? e.message : String(e) };
      }
    }
  };
})();
