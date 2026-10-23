// Short welcome guide for new students. Shows once after signing up (or the first time a
// moderator-made account logs in). "Show the welcome guide" at the bottom of the board replays it.
(() => {
  const STEPS = [
    { icon: '👋', title: 'Welcome to Student Pulse', text: 'A board where students share how school and events are going. Pick a board, choose how you feel, and post. It takes a few seconds.' },
    { icon: '🤝', title: 'Keep it honest and kind', list: ['Criticize ideas and policies, not people.', 'No names in complaints.', 'Tag spoilers and sensitive stuff.', 'Some words are blocked by a filter. If your post is stopped, rephrase it.'] },
    { icon: '🕶️', title: 'Anonymous, but not untraceable', text: 'You can post or comment anonymously, and other students will not see your name. If something is reported for bullying, harassment or a threat to safety, a moderator may reveal who wrote it.' },
    { icon: '🛠️', title: 'You are in control', list: ['Edit or delete your own posts and comments, and change their photos.', 'Use 🚩 Report on anything that breaks the rules.', 'Edit your profile and password from your name at the top.'] }
  ];
  let open = false;

  function show(replay) {
    if (open) return;
    open = true;
    const prev = document.activeElement;
    let i = 0;
    const wrap = document.createElement('div'); wrap.className = 'uimodal';
    const box = document.createElement('div'); box.className = 'card uibox welcome';
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'wtitle');
    wrap.appendChild(box);

    const close = () => {
      document.removeEventListener('keydown', onKey, true); wrap.remove(); open = false;
      if (!replay) Auth.markWelcomed();
      if (prev && prev.focus) prev.focus();
    };
    const paint = () => {
      const s = STEPS[i], last = i === STEPS.length - 1;
      box.innerHTML = '';
      const add = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; box.appendChild(e); return e; };
      const dots = add('div', 'uisteps'); dots.setAttribute('aria-hidden', 'true');
      STEPS.forEach((_, k) => { const d = document.createElement('i'); if (k === i) d.className = 'on'; dots.appendChild(d); });
      add('p', 'stepcount', 'Step ' + (i + 1) + ' of ' + STEPS.length);
      const ic = add('div', 'uiicon', s.icon); ic.setAttribute('aria-hidden', 'true');
      const h = add('h3', '', s.title); h.id = 'wtitle';
      if (s.text) add('p', '', s.text).style.textAlign = 'center';
      if (s.list) { const ul = add('ul', 'uilist'); s.list.forEach(t => { const li = document.createElement('li'); li.textContent = t; ul.appendChild(li); }); }
      const row = add('div', 'uibtns');
      row.style.justifyContent = 'space-between';
      const left = document.createElement('div'); left.style.display = 'flex'; left.style.gap = '8px';
      const right = document.createElement('div'); right.style.display = 'flex'; right.style.gap = '8px';
      row.append(left, right);
      const btn = (cls, text, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = text; b.addEventListener('click', fn); return b; };
      if (!last) left.appendChild(btn('ghost', 'Skip', close));
      if (i > 0) right.appendChild(btn('ghost', 'Back', () => { i--; paint(); box.querySelector('.post-btn').focus(); }));
      const next = btn('post-btn', last ? 'Get started' : 'Next', () => { if (last) close(); else { i++; paint(); box.querySelector('.post-btn').focus(); } });
      right.appendChild(next);
    };
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'Tab') {
        const f = [...box.querySelectorAll('button')], k = f.indexOf(document.activeElement);
        e.preventDefault(); f[(k + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    paint();
    document.body.appendChild(wrap);
    box.querySelector('.post-btn').focus();
  }

  const btn = document.getElementById('welcomeBtn');
  if (btn) btn.addEventListener('click', () => show(true));
  if (Auth.needsWelcome()) show(false);
})();
