// ===== מצב הדגמה: אין שרת, הכול קורה בתוך הקובץ =====
(() => {
  const D = __DEMO_STATE__;
  const now = Date.now();
  // מזיזים את הזמנים כך שייראו עדכניים
  D.messages.forEach((m, i) => (m.at = now - (D.messages.length - i) * 4 * 60000));
  D.repairs.forEach((r, i) => (r.at = now - (i + 1) * 9 * 60000));
  D.ours.forEach((m, i) => (m.time = new Date(now + (i - 2) * 22 * 60000).toISOString()));
  D.updatedAt = now;
  let handlers = {};
  let n = 1;
  const id = () => 'd' + n++;
  const copy = () => JSON.parse(JSON.stringify(D));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function pitSays(text, delay = 1800) {
    setTimeout(() => {
      D.messages.push({ id: id(), from: 'pit', to: 'all', text, at: Date.now(), readBy: [] });
      handlers.message && handlers.message({ from: 'הפיט', to: 'all' });
    }, delay);
  }

  function advance() {
    const next = D.ours.find((m) => !m.played);
    if (!next) return Pit.toast('אין עוד משחקים');
    if (next.away > 0) {
      D.ours.forEach((m) => { if (!m.played) m.away = Math.max(0, m.away - 1); });
    } else {
      next.played = true;
      next.our = 90 + Math.floor(Math.random() * 140);
      next.their = 90 + Math.floor(Math.random() * 140);
      next.result = next.our > next.their ? 'W' : next.our < next.their ? 'L' : 'T';
      next.away = null;
      D.ours.forEach((m) => { if (!m.played) m.away = Math.max(0, m.away - 1); });
      D.checklist.forEach((c) => (c.done = false));
    }
    D.next = D.ours.find((m) => !m.played) || null;
    handlers.change && handlers.change();
  }

  Pit.api = async (path, body) => {
    await wait(80);
    const p = path.split('?')[0];
    if (p === '/api/join') {
      if (!body.name?.trim()) throw new Error('צריך שם');
      D.me.name = body.name.trim();
      return { token: 'demo', id: 'me' };
    }
    if (p === '/api/state') return copy();
    if (p === '/api/check') {
      if (body.reset) D.checklist.forEach((c) => (c.done = false));
      else D.checklist[body.index].done = !!body.done;
    }
    if (p === '/api/message') {
      D.messages.push({ id: id(), from: 'me', to: 'pit', text: body.text, at: Date.now(), readBy: [] });
      const msg = D.messages[D.messages.length - 1];
      setTimeout(() => { msg.readBy.push('pit'); handlers.change && handlers.change(); }, 1200);
      pitSays(/בדרך/.test(body.text) ? 'מעולה, מחכים לך 👍' : 'קיבלנו 👍', 2600);
    }
    if (p === '/api/read') D.messages.forEach((m) => body.ids.includes(m.id) && !m.readBy.includes('me') && m.readBy.push('me'));
    if (p === '/api/battery') {
      const b = D.batteries.find((x) => x.id === body.id);
      if (b && body.action === 'status') {
        if (body.status === 'robot') { D.batteries.forEach((o) => o.status === 'robot' && o !== b && (o.status = 'used')); b.uses++; }
        b.status = body.status;
      }
    }
    if (p === '/api/repair') {
      if (body.action === 'add') D.repairs.unshift({ id: id(), text: body.text, by: D.me.name, at: Date.now(), done: false });
      const r = D.repairs.find((x) => x.id === body.id);
      if (r && body.action === 'toggle') r.done = !r.done;
    }
    if (p === '/api/ack') { D.me.alert = { state: 'ack' }; pitSays('ראינו, תודה! 🙏', 1500); }
    return { ok: true };
  };
  Pit.stream = (h) => { handlers = h; setTimeout(() => h.up && h.up(), 200); return { close() {} }; };

  // פאנל הדגמה
  window.addEventListener('DOMContentLoaded', () => {
    const css = document.createElement('style');
    css.textContent = `
      .demo-fab { position: fixed; bottom: calc(86px + env(safe-area-inset-bottom)); inset-inline-start: 12px; z-index: 40; background: #ffb020; color: #1a1200; border: 0; border-radius: 99px; padding: 8px 14px; font-weight: 700; box-shadow: 0 6px 20px #0008; }
      .demo-menu { position: fixed; bottom: calc(132px + env(safe-area-inset-bottom)); inset-inline-start: 12px; z-index: 40; background: var(--panel); border: 1px solid var(--accent); border-radius: 14px; padding: 8px; display: none; flex-direction: column; gap: 6px; width: 230px; box-shadow: 0 10px 30px #000a; }
      .demo-menu.show { display: flex; }
      .demo-menu small { color: var(--muted); padding: 4px 6px; }
      .demo-menu button { text-align: start; }`;
    document.head.append(css);
    const fab = Object.assign(document.createElement('button'), { className: 'demo-fab', textContent: '▶ הדגמה' });
    const menu = Object.assign(document.createElement('div'), { className: 'demo-menu' });
    menu.innerHTML = `
      <small>זו הדגמה בלבד, בלי שרת. נסו:</small>
      <button data-d="alarm">🔴 קריאה מהפיט</button>
      <button data-d="alarm2">🔴 קריאה עם סיבה</button>
      <button data-d="msg">💬 הודעה מהפיט</button>
      <button data-d="adv">⏩ להתקדם משחק</button>
      <button data-d="out">↩ חזרה למסך ההתחברות</button>`;
    document.body.append(fab, menu);
    fab.onclick = (e) => { e.stopPropagation(); menu.classList.toggle('show'); };
    menu.onclick = (e) => {
      const a = e.target.closest('[data-d]')?.dataset.d;
      if (!a) return;
      menu.classList.remove('show');
      Pit.unlockAudio();
      if (a === 'alarm' || a === 'alarm2') {
        const reason = a === 'alarm2' ? 'להביא את השלט השני' : 'בוא לפיט עכשיו!';
        D.me.alert = { state: 'ringing', reason };
        setTimeout(() => handlers.alert && handlers.alert({ reason }), 600);
      }
      if (a === 'msg') pitSays(['הסוללה ברובוט חלשה, תבדקו', 'שופט מבקש לראות את הרובוט', 'עוד שני משחקים, להתחיל להתכונן'][Math.floor(Math.random() * 3)], 300);
      if (a === 'adv') advance();
      if (a === 'out') { Pit.setToken(null); location.reload(); }
    };
    document.addEventListener('click', () => menu.classList.remove('show'));
    fab.hidden = true;
    new MutationObserver(() => (fab.hidden = document.querySelector('#appView').hidden)).observe(document.querySelector('#appView'), { attributes: true });
  });
})();
