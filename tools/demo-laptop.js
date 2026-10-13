// ===== מצב הדגמה למסך הפיט: אין שרת, הכול קורה בתוך הקובץ =====
(() => {
  const D = __DEMO_STATE__;
  const TEAMS = D._teams; delete D._teams;
  const now = Date.now();
  D.messages.forEach((m, i) => (m.at = now - (D.messages.length - i) * 3 * 60000));
  D.repairs.forEach((r, i) => (r.at = now - (i + 1) * 11 * 60000));
  D.ours.forEach((m, i) => (m.time = new Date(now + (i - 2) * 22 * 60000).toISOString()));
  D.members.forEach((m) => { m.lastSeen = now; if (m.alert?.state === 'ack') { m.alert.at = now - 5 * 60000; m.alert.ackAt = now - 4 * 60000; } });
  D.updatedAt = now;
  D.settings.queueWarnAt = 2;
  let handlers = {};
  let n = 1;
  const id = () => 'd' + n++;
  const fire = (ev, data) => handlers[ev] && handlers[ev](data || {});
  const member = (mid) => D.members.find((m) => m.id === mid);

  function memberSays(m, text, delay = 1500) {
    setTimeout(() => {
      D.messages.push({ id: id(), from: m.id, fromName: m.name, to: 'pit', text, at: Date.now(), readBy: [] });
      fire('message', { from: m.name, to: 'pit' });
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
    D.playingNow = !!(D.next && D.next.away === 0);
    D.playedMatches = Math.min(D.totalMatches, D.playedMatches + 1);
    D.updatedAt = Date.now();
    fire('change');
  }

  function ring(m, reason) {
    m.alert = { state: 'ringing', at: Date.now(), reason };
    if (!m.online) return;
    // חבר צוות מחובר "עונה" אחרי כמה שניות
    setTimeout(() => {
      if (m.alert.state !== 'ringing') return;
      m.alert = { ...m.alert, state: 'ack', ackAt: Date.now() };
      fire('ack', { name: m.name });
    }, 3000 + Math.random() * 2500);
  }

  Pit.api = async (path, body) => {
    await new Promise((r) => setTimeout(r, 60));
    const p = path.split('?')[0];
    const tm = p.match(/^\/api\/team\/(\d+)$/);
    if (tm) return TEAMS[tm[1]] || { info: null, quick: null };
    if (p === '/api/state') return JSON.parse(JSON.stringify(D));
    if (p === '/api/check') {
      if (body.reset) D.checklist.forEach((c) => (c.done = false));
      else D.checklist[body.index].done = !!body.done;
    }
    if (p === '/api/alert') {
      const list = body.id === 'all' ? D.members : [member(body.id)].filter(Boolean);
      list.forEach((m) => ring(m, body.reason || 'בוא לפיט עכשיו!'));
      if (list.some((m) => !m.online)) setTimeout(() => Pit.toast('חבר צוות לא מחובר לא יקבל את הקריאה עד שיתחבר'), 900);
    }
    if (p === '/api/alert/cancel') { const m = member(body.id); if (m) m.alert = { state: 'none' }; }
    if (p === '/api/message') {
      const msg = { id: id(), from: 'pit', to: body.to || 'all', text: body.text, at: Date.now(), readBy: [] };
      D.messages.push(msg);
      const readers = msg.to === 'all' ? D.members.filter((m) => m.online) : [member(msg.to)].filter((m) => m && m.online);
      readers.forEach((m, i) => setTimeout(() => { msg.readBy.push(m.id); fire('change'); }, 1200 + i * 900));
      if (readers[0]) memberSays(readers[0], ['קיבלתי 👍', 'בדרך!', 'עוד 2 דקות'][Math.floor(Math.random() * 3)], 3200);
    }
    if (p === '/api/read') D.messages.forEach((m) => body.ids.includes(m.id) && !m.readBy.includes('pit') && m.readBy.push('pit'));
    if (p === '/api/battery') {
      if (body.action === 'add') D.batteries.push({ id: id(), name: body.name, status: 'charging', voltage: null, uses: 0 });
      const b = D.batteries.find((x) => x.id === body.id);
      if (b && body.action === 'delete') D.batteries = D.batteries.filter((x) => x !== b);
      if (b && body.action === 'status') {
        if (body.status === 'robot') { D.batteries.forEach((o) => o.status === 'robot' && o !== b && (o.status = 'used')); b.uses++; }
        b.status = body.status;
      }
      if (b && body.action === 'voltage') { const v = Number(body.voltage); b.voltage = v > 0 && v < 20 ? Math.round(v * 100) / 100 : null; }
    }
    if (p === '/api/repair') {
      if (body.action === 'add') D.repairs.unshift({ id: id(), text: body.text, by: 'הפיט', at: Date.now(), done: false });
      const r = D.repairs.find((x) => x.id === body.id);
      if (r && body.action === 'toggle') r.done = !r.done;
      if (r && body.action === 'delete') D.repairs = D.repairs.filter((x) => x !== r);
    }
    if (p === '/api/settings') {
      const s = D.settings;
      if (body.newJoinCode) s.joinCode = String(Math.floor(100000 + Math.random() * 900000));
      if (Array.isArray(body.checklist)) {
        const list = body.checklist.map((x) => x.trim()).filter(Boolean);
        s.checklist = list;
        D.checklist = list.map((text, i) => ({ text, done: D.checklist[i]?.text === text && D.checklist[i].done }));
      }
      if (body.queueWarnAt !== undefined) s.queueWarnAt = Math.max(0, Math.min(10, parseInt(body.queueWarnAt, 10) || 0));
      if (body.team && Number(body.team) !== D.team) setTimeout(() => Pit.toast('בהדגמה הקבוצה קבועה. בגרסה האמיתית הנתונים מתחלפים לקבוצה החדשה'), 400);
      if (body.removeMember) D.members = D.members.filter((m) => m.id !== body.removeMember);
      if (body.clearMessages) D.messages = [];
      setTimeout(() => fire('change'), 100);
    }
    if (p === '/api/refresh') setTimeout(() => { D.updatedAt = Date.now(); fire('change'); }, 500);
    return { ok: true };
  };
  Pit.stream = (h) => { handlers = h; setTimeout(() => h.up && h.up(), 200); return { close() {} }; };

  // פאנל הדגמה
  window.addEventListener('DOMContentLoaded', () => {
    const css = document.createElement('style');
    css.textContent = `
      .demo-fab { position: fixed; bottom: 20px; inset-inline-start: 20px; z-index: 40; background: #ffb020; color: #1a1200; border: 0; border-radius: 99px; padding: 10px 18px; font-weight: 700; box-shadow: 0 6px 20px #0008; }
      .demo-menu { position: fixed; bottom: 70px; inset-inline-start: 20px; z-index: 40; background: var(--panel); border: 1px solid var(--accent); border-radius: 14px; padding: 8px; display: none; flex-direction: column; gap: 6px; width: 270px; box-shadow: 0 10px 30px #000a; }
      .demo-menu.show { display: flex; }
      .demo-menu small { color: var(--muted); padding: 4px 6px; }
      .demo-menu button { text-align: start; }`;
    document.head.append(css);
    const fab = Object.assign(document.createElement('button'), { className: 'demo-fab', textContent: '▶ הדגמה' });
    const menu = Object.assign(document.createElement('div'), { className: 'demo-menu' });
    menu.innerHTML = `
      <small>זו הדגמה בלבד, בלי שרת. נסו:</small>
      <button data-d="adv">⏩ להתקדם משחק (עד התראת התור)</button>
      <button data-d="msg">💬 חבר צוות שולח הודעה</button>
      <button data-d="join">📱 טלפון חדש מתחבר</button>
      <button data-d="toggle">🔌 איתי מתחבר או מתנתק</button>
      <small>וגם: לחצו "קריאה" ליד חבר צוות, על מספר קבוצה, על סוללה, ועל לשונית הסקאוטינג</small>`;
    document.body.append(fab, menu);
    fab.onclick = (e) => { e.stopPropagation(); menu.classList.toggle('show'); };
    const names = ['רוני', 'מאיה', 'עידו', 'תמר', 'אורי'];
    menu.onclick = (e) => {
      const a = e.target.closest('[data-d]')?.dataset.d;
      if (!a) return;
      menu.classList.remove('show');
      Pit.unlockAudio();
      if (a === 'adv') advance();
      if (a === 'msg') {
        const on = D.members.filter((m) => m.online);
        if (!on.length) return Pit.toast('אין חברי צוות מחוברים');
        memberSays(on[Math.floor(Math.random() * on.length)], ['צריך עוד אזיקונים', 'השופט ביקש לראות את הרובוט', 'אנחנו בתור', 'הסוללה ברובוט נראית חלשה'][Math.floor(Math.random() * 4)], 200);
      }
      if (a === 'join') {
        const name = names.find((x) => !D.members.some((m) => m.name === x));
        if (!name) return Pit.toast('כולם כבר מחוברים');
        D.members.push({ id: id(), name, online: true, lastSeen: Date.now(), alert: { state: 'none' } });
        Pit.toast(`${name} התחבר/ה`); fire('change');
      }
      if (a === 'toggle') {
        const m = D.members.find((x) => x.name === 'איתי');
        if (!m) return Pit.toast('איתי נותק מהרשימה');
        m.online = !m.online; Pit.toast(m.online ? 'איתי מחובר' : 'איתי התנתק'); fire('change');
      }
    };
    document.addEventListener('click', () => menu.classList.remove('show'));
  });
})();
