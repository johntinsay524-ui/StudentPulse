// Saves data in the browser so it survives a refresh.
// If the browser blocks storage (some previews, private windows), it falls back to
// memory and shows a warning, because nothing can be saved in that case.
const Store = (() => {
  let ok = true;
  const mem = {};
  try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); } catch { ok = false; }
  return {
    ok,
    get(k)    { try { if (ok) return localStorage.getItem(k); } catch {} return mem[k] ?? null; },
    set(k, v) { try { if (ok) { localStorage.setItem(k, v); return true; } } catch {} mem[k] = v; return false; },
    remove(k) { try { if (ok) localStorage.removeItem(k); } catch {} delete mem[k]; }
  };
})();

{ const t = Store.get('studentpulse_theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; }   // saved light/dark choice

if (!Store.ok) {
  document.addEventListener('DOMContentLoaded', () => {
    const d = document.createElement('div');
    d.className = 'storewarn';
    d.textContent = 'Your browser is blocking saved data, so everything will reset when you refresh. Open the site in a normal browser window (not a preview or private mode).';
    document.body.prepend(d);
  });
}
