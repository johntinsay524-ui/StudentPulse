// Styled replacements for the browser's alert(), confirm() and prompt() pop-ups.
//   await UI.alert('Message', { title, password, list })     -> shows a notice (optional copy box / bullet list)
//   await UI.confirm('Message', { title, ok, danger })        -> true / false
//   await UI.prompt('Message', { title, label, value, required, ok, danger, placeholder }) -> text, or null if cancelled
const UI = (() => {
  let uid = 0;
  function ask({ title, message, password, list, field, ok, cancel, danger }) {
    return new Promise(resolve => {
      const id = 'ui' + (++uid);
      const prev = document.activeElement;
      const wrap = document.createElement('div');
      wrap.className = 'uimodal';
      const box = document.createElement('div');
      box.className = 'card uibox';
      box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', id + 't');

      const h = document.createElement('h3'); h.id = id + 't'; h.textContent = title; box.appendChild(h);
      if (message) { const p = document.createElement('p'); p.id = id + 'd'; p.textContent = message; box.appendChild(p); box.setAttribute('aria-describedby', id + 'd'); }
      if (list) {
        const ul = document.createElement('ul'); ul.className = 'uilist';
        list.forEach(t => { const li = document.createElement('li'); li.textContent = t; ul.appendChild(li); });
        box.appendChild(ul);
      }
      if (password) {
        const row = document.createElement('div'); row.className = 'uipw';
        const code = document.createElement('code'); code.textContent = password;
        const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'ghost'; copy.textContent = 'Copy';
        copy.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(password); copy.textContent = 'Copied ✓'; }
          catch { const r = document.createRange(); r.selectNodeContents(code); const s = getSelection(); s.removeAllRanges(); s.addRange(r); copy.textContent = 'Press Ctrl+C'; }
        });
        row.append(code, copy); box.appendChild(row);
      }
      let input = null, err = null;
      if (field) {
        const l = document.createElement('label'); l.htmlFor = id + 'i'; l.className = 'uilabel'; l.textContent = field.label || 'Your answer'; box.appendChild(l);
        input = document.createElement('input'); input.id = id + 'i'; input.type = 'text'; input.maxLength = 200;
        input.className = 'uiinput'; input.value = field.value || ''; input.placeholder = field.placeholder || '';
        box.appendChild(input);
        err = document.createElement('div'); err.className = 'uierr'; err.setAttribute('role', 'alert'); box.appendChild(err);
      }
      const btns = document.createElement('div'); btns.className = 'uibtns';
      let no = null;
      if (cancel) { no = document.createElement('button'); no.type = 'button'; no.className = 'ghost'; no.textContent = cancel; btns.appendChild(no); }
      const yes = document.createElement('button'); yes.type = 'button'; yes.className = 'post-btn' + (danger ? ' dangerbtn' : ''); yes.textContent = ok;
      btns.appendChild(yes); box.appendChild(btns); wrap.appendChild(box);

      const done = v => {
        document.removeEventListener('keydown', onKey, true); wrap.remove();
        if (prev && prev.focus) prev.focus();
        resolve(field ? (v ? input.value.trim() : null) : v);
      };
      const submit = () => {
        if (field && field.required && !input.value.trim()) { err.textContent = 'Please write a reason.'; input.focus(); return; }
        done(true);
      };
      const onKey = e => {
        if (e.key === 'Escape') { e.preventDefault(); done(false); }
        else if (e.key === 'Enter' && e.target === input) { e.preventDefault(); submit(); }
        else if (e.key === 'Tab') {                       // keep keyboard focus inside the dialog
          const f = [...box.querySelectorAll('button,input')], i = f.indexOf(document.activeElement);
          e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
        }
      };
      yes.addEventListener('click', submit);
      if (no) no.addEventListener('click', () => done(false));
      wrap.addEventListener('mousedown', e => { if (e.target === wrap) done(false); });
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(wrap);
      (input || (danger && no ? no : yes)).focus();       // a dangerous action is never the default button
    });
  }
  return {
    alert:   (message, o = {}) => ask({ title: o.title || 'Notice', message, password: o.password, list: o.list, ok: o.ok || 'OK' }),
    confirm: (message, o = {}) => ask({ title: o.title || 'Are you sure?', message, ok: o.ok || 'Yes', cancel: o.cancel || 'Cancel', danger: o.danger }),
    prompt:  (message, o = {}) => ask({ title: o.title || 'Please answer', message, field: { label: o.label, value: o.value, placeholder: o.placeholder, required: o.required }, ok: o.ok || 'OK', cancel: o.cancel || 'Cancel', danger: o.danger })
  };
})();
