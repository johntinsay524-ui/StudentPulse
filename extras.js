// Light / dark toggle (remembers your choice). Add <script src="extras.js"></script> at the end of a page.
(() => {
  const root = document.documentElement;
  const cur = () => root.dataset.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'themebtn';
  btn.setAttribute('aria-label', 'Switch between light and dark theme');
  const paint = () => btn.textContent = cur() === 'dark' ? '☀️ Light' : '🌙 Dark';
  btn.addEventListener('click', () => {
    const next = cur() === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next; Store.set('studentpulse_theme', next); paint();
  });
  paint();
  const host = document.querySelector('.top') || document.querySelector('.me');
  const lo = document.getElementById('logoutBtn');
  if (host) lo && lo.parentNode === host ? host.insertBefore(btn, lo) : host.appendChild(btn);
})();
