// ===== סימולטור יוסטון: "השרת" שרץ בתוך הדף =====
// מריץ את אותו קוד שרת (lib/core.js) בתוך הדפדפן, ומחבר אליו מסך פיט ושלושה טלפונים.
// כל הקבוצות והתוצאות בדויות: מספרים מ־90001 ומעלה (החלטה 02, כלל ב).
(() => {
  const TEAM = 9662;
  const JOIN = '482913';
  const $ = (s, el = document) => el.querySelector(s);
  const clone = (x) => (x === undefined ? x : JSON.parse(JSON.stringify(x)));

  // ---------- מספרים אקראיים קבועים, כדי שכל פתיחה תיראה אותו דבר ----------
  let seed = 9662;
  const rnd = () => ((seed = (seed * 16_807) % 2147483647) / 2147483647);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const hex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');

  // ---------- אירוע בדוי ----------
  const others = Array.from({ length: 23 }, (_, i) => 90001 + i);
  const OURS = [3, 8, 12, 17, 21, 26, 30, 34];
  const TOTAL = 36;
  const START_PLAYED = 8; // נכנסים באמצע: שני משחקים שלנו כבר שוחקו
  const t0 = Date.now() + 2 * 60_000;
  const matches = [];
  for (let id = 1; id <= TOTAL; id++) {
    const pool = [...others].sort(() => rnd() - 0.5).slice(0, 4);
    if (OURS.includes(id)) pool[Math.floor(rnd() * 4)] = TEAM;
    const st = ['One', 'Two', 'One', 'Two'];
    matches.push({
      id, series: 0, tournamentLevel: 'Quals',
      scheduledStartTime: new Date(t0 + (id - START_PLAYED - 1) * 6 * 60_000).toISOString(),
      teams: pool.map((n, i) => ({ teamNumber: n, alliance: i < 2 ? 'Red' : 'Blue', station: st[i] })),
      hasBeenPlayed: false, scores: null,
    });
  }
  function play(m) {
    let a = 60 + Math.floor(rnd() * 160), b = 60 + Math.floor(rnd() * 160);
    // הרובוט שלנו טוב: קצת יתרון לברית שלנו
    const us = m.teams.find((t) => t.teamNumber === TEAM);
    if (us && us.alliance === 'Red') a += 45;
    if (us && us.alliance === 'Blue') b += 45;
    m.hasBeenPlayed = true;
    m.scores = { red: { totalPoints: a }, blue: { totalPoints: b } };
  }
  matches.slice(0, START_PLAYED).forEach(play);

  // ---------- השרת ----------
  const core = HoustonCore.createCore({
    rid: (n = 8) => hex(n),
    code6: () => JOIN,
    addresses: () => ['http://192.168.1.20:8765'],
  });
  core.state.settings.joinCode = JOIN;
  core.state.batteries = [
    { id: 'b1', name: 'סוללה 1', status: 'robot', voltage: 13.1, uses: 3, updatedAt: Date.now() },
    { id: 'b2', name: 'סוללה 2', status: 'ready', voltage: 13.6, uses: 2, updatedAt: Date.now() },
    { id: 'b3', name: 'סוללה 3', status: 'charging', voltage: null, uses: 2, updatedAt: Date.now() },
    { id: 'b4', name: 'סוללה 4', status: 'used', voltage: 12.2, uses: 4, updatedAt: Date.now() },
  ];
  core.state.repairs = [
    { id: 'r1', text: 'להדק את הברגים של הזרוע', by: 'נועה', at: Date.now() - 14 * 60_000, done: false },
    { id: 'r2', text: 'להחליף גלגל שמאלי קדמי', by: 'הפיט', at: Date.now() - 31 * 60_000, done: true, doneAt: Date.now() - 20 * 60_000 },
  ];
  const publish = () => core.setSchedule({
    event: { code: 'DEMO', name: 'אירוע הדגמה', city: 'עיר בדויה', fieldCount: 2, start: '', end: '' },
    matches: clone(matches), season: 2026, updatedAt: Date.now(), error: '',
  });
  publish();

  // חברי צוות שכבר מחוברים: נועה ועומר. תמר תתחבר בעצמה מהטלפון השלישי.
  function seedMember(name) {
    const id = hex(4), token = hex(16);
    core.state.members[id] = { id, name, tokens: [token], joinedAt: Date.now(), lastSeen: Date.now(), alert: { state: 'none' } };
    return token;
  }
  const preTokens = { p1: seedMember('נועה'), p2: seedMember('עומר') };
  core.state.messages.push({ id: 'm0', from: 'pit', to: 'all', text: 'בוקר טוב! סוללה 2 מוכנה למשחק הבא', at: Date.now() - 9 * 60_000, readBy: [] });

  // ---------- המסכים ----------
  const frames = {}; // id -> {id, kind, name, store, online, handlers, bye, el}
  function frameInfo(id) { return frames[id]; }

  const Sim = {
    fontCss: '',
    autoAck: true,
    muted: true,

    store(id) {
      const f = frames[id];
      return { get: (k) => (f.store.has(k) ? f.store.get(k) : null), set: (k, v) => (v == null ? f.store.delete(k) : f.store.set(k, String(v))) };
    },

    authFor(f) {
      if (f.kind === 'pit') return core.auth({ local: true });
      return core.auth({ token: f.store.get('pit-token') });
    },

    async api(id, fullPath, body) {
      const f = frames[id];
      await new Promise((r) => setTimeout(r, 40 + Math.random() * 60));
      if (!f.online) throw new TypeError('Failed to fetch');
      const [path] = fullPath.split('?');
      const method = body === undefined ? 'GET' : 'POST';
      const a = Sim.authFor(f);
      const r = core.handle(method, path, a, clone(body));
      if (!r) { const e = new Error('404'); e.status = 404; throw e; }
      if (r.code !== 200) { const e = new Error((r.body && r.body.error) || String(r.code)); e.status = r.code; throw e; }
      if (method === 'POST') logAction(f, path, body, a);
      return clone(r.body);
    },

    stream(id, handlers) {
      const f = frames[id];
      f.handlers = handlers;
      connectStream(f);
      return { close() { if (f.bye) { f.bye(); f.bye = null; } f.handlers = null; } };
    },
  };
  window.Sim = Sim;

  function connectStream(f) {
    if (f.bye) { f.bye(); f.bye = null; }
    const h = f.handlers;
    if (!h) return;
    if (!f.online) { setTimeout(() => h.down && h.down(), 30); return; }
    const a = Sim.authFor(f);
    if (!a.admin && !a.member) { setTimeout(() => h.down && h.down(), 30); return; }
    f.bye = core.connect({
      kind: a.admin ? 'admin' : 'member',
      memberId: a.member && a.member.id,
      send: (ev, data) => setTimeout(() => {
        if (f.handlers !== h) return;
        h[ev] && h[ev](clone(data));
        if (ev === 'alert') onRing(f);
      }, 15),
    });
    setTimeout(() => h.up && h.up(), 20);
  }

  // ---------- חבר צוות "עונה" לבד ----------
  function onRing(f) {
    log(`הטלפון של ${f.name} מצלצל`, 'signal');
    if (!Sim.autoAck) return;
    setTimeout(() => {
      const btn = f.el.contentDocument && f.el.contentDocument.querySelector('#alarm.show #ackBtn');
      if (btn && Sim.autoAck) btn.click();
    }, 2500 + Math.random() * 3000);
  }

  // ---------- יומן אירועים ----------
  const logEl = () => $('#log');
  function log(text, tone = '') {
    const li = document.createElement('li');
    li.className = tone;
    const t = new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    li.innerHTML = `<span class="t num">${t}</span><span></span>`;
    li.lastChild.textContent = text;
    logEl().prepend(li);
    while (logEl().children.length > 80) logEl().lastChild.remove();
  }
  const BAT = { charging: 'בטעינה', ready: 'מוכנה', robot: 'ברובוט', used: 'משומשת' };
  function logAction(f, path, body, a) {
    const who = a.admin ? 'הפיט' : (a.member && a.member.name) || f.name;
    const member = (mid) => (core.state.members[mid] || {}).name || 'חבר צוות';
    switch (path) {
      case '/api/join': return log(`${body.name} התחבר מהטלפון`, 'go');
      case '/api/alert': return log(`הפיט קרא ל${body.id === 'all' ? 'כל הצוות' : member(body.id)}${body.reason ? `: ${body.reason}` : ''}`, 'signal');
      case '/api/alert/cancel': return log(`הפיט ביטל את הקריאה ל${member(body.id)}`);
      case '/api/ack': return log(`${who}: קיבלתי, בדרך`, 'go');
      case '/api/message': return log(`${who} כתב${body.to && body.to !== 'all' ? ` ל${member(body.to)}` : who === 'הפיט' ? ' לכולם' : ''}: ${body.text}`);
      case '/api/check': return body.reset ? log(`${who} איפס את רשימת הבדיקה`) : log(`${who} ${body.done ? 'סימן' : 'ביטל סימון'}: ${core.state.settings.checklist[body.index]}`);
      case '/api/battery': {
        const b = core.state.batteries.find((x) => x.id === body.id);
        if (body.action === 'status' && b) return log(`${who}: ${b.name} ${BAT[body.status]}`, body.status === 'robot' ? 'amber' : '');
        if (body.action === 'add') return log(`${who} הוסיף סוללה`);
        if (body.action === 'voltage' && b) return log(`${who}: ${b.name} נמדדה ${b.voltage ?? '?'} וולט`);
        return;
      }
      case '/api/repair': return body.action === 'add' ? log(`${who} הוסיף תיקון: ${body.text}`, 'amber') : body.action === 'toggle' ? log(`${who} עדכן תיקון`) : null;
      default: return null;
    }
  }

  // ---------- שעון המשחקים ----------
  let speed = 25; // שניות בין משחקים. 0 = עצור
  let timer = null;
  function nextMatch() {
    const m = matches.find((x) => !x.hasBeenPlayed);
    if (!m) { log('האירוע נגמר'); setSpeed(0); return; }
    play(m);
    const ours = m.teams.find((t) => t.teamNumber === TEAM);
    if (ours) {
      const c = ours.alliance === 'Red' ? 'red' : 'blue';
      const o = c === 'red' ? 'blue' : 'red';
      const r = m.scores[c].totalPoints > m.scores[o].totalPoints ? 'ניצחנו' : m.scores[c].totalPoints < m.scores[o].totalPoints ? 'הפסדנו' : 'תיקו';
      log(`משחק מ׳${m.id} נגמר: ${r} ${m.scores[c].totalPoints}:${m.scores[o].totalPoints}`, r === 'ניצחנו' ? 'go' : 'signal');
    } else {
      log(`משחק מ׳${m.id} נגמר`);
    }
    publish();
  }
  function setSpeed(s) {
    speed = s;
    clearInterval(timer);
    if (s) timer = setInterval(nextMatch, s * 1000);
    document.querySelectorAll('[data-speed]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === s)));
  }

  // ---------- בדיקה עצמית: "בוטים" שעוברים על המערכת דרך המסכים עצמם ----------
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function until(fn, ms = 4000) {
    const end = Date.now() + ms;
    while (Date.now() < end) { try { if (fn()) return true; } catch {} await wait(80); }
    return false;
  }
  const doc = (id) => frames[id].el.contentDocument;
  const memberId = (name) => Object.values(core.state.members).find((m) => m.name === name)?.id;
  function typeInto(d, sel, text) { const el = d.querySelector(sel); el.value = text; el.dispatchEvent(new Event('input', { bubbles: true })); }
  function submit(d, sel) { d.querySelector(sel).requestSubmit(); }

  async function selfTest() {
    const btn = $('#testBtn');
    btn.disabled = true;
    const list = $('#tests');
    list.innerHTML = '';
    const oldSpeed = speed, oldAuto = Sim.autoAck;
    setSpeed(0);
    Sim.autoAck = false;
    const results = [];
    async function check(name, fn) {
      const li = document.createElement('li');
      li.innerHTML = '<span class="lamp warn"></span><span></span>';
      li.lastChild.textContent = name;
      list.append(li);
      let ok = false;
      try { ok = await fn(); } catch (e) { ok = false; }
      li.firstChild.className = `lamp ${ok ? 'on' : 'bad'}`;
      if (!ok) li.classList.add('fail');
      results.push(ok);
      await wait(250);
    }
    for (const f of Object.values(frames)) if (!f.online) setOnline(f.id, true);
    await wait(400);

    await check('הטלפון של תמר מצטרף עם קוד', async () => {
      const d = doc('p3');
      if (!d.querySelector('#joinView').hidden) {
        typeInto(d, '#jName', 'תמר'); typeInto(d, '#jCode', JOIN); submit(d, '#joinForm');
      }
      return until(() => !d.querySelector('#appView').hidden && doc('pit').querySelector('#members').textContent.includes('תמר'));
    });
    await check('כל הטלפונים מופיעים מחוברים במסך הפיט', () =>
      until(() => doc('pit').querySelectorAll('#members .lamp.on').length === 3));
    await check('קריאה מהפיט מצלצלת בטלפון של עומר', async () => {
      doc('pit').querySelector(`[data-alert="${memberId('עומר')}"]`).click();
      return until(() => doc('p2').querySelector('#alarm').classList.contains('show'));
    });
    await check('"קיבלתי" מהטלפון מופיע בפיט, גדול בראש המסך', async () => {
      doc('p2').querySelector('#ackBtn').click();
      return until(() => !doc('p2').querySelector('#alarm').classList.contains('show')
        && [...doc('pit').querySelectorAll('#members li')].some((li) => li.textContent.includes('עומר') && li.textContent.includes('בדרך'))
        && doc('pit').querySelector('#coming').textContent.includes('עומר בדרך'));
    });
    await check('לחיצה כפולה על "קריאה" לא מבטלת את הקריאה', async () => {
      const d = doc('pit');
      d.querySelector(`[data-alert="${memberId('נועה')}"]`).click();
      await until(() => d.querySelector(`[data-cancel="${memberId('נועה')}"]`), 2000);
      d.querySelector(`[data-cancel="${memberId('נועה')}"]`)?.click();
      await wait(500);
      const ok = core.state.members[memberId('נועה')].alert.state === 'ringing';
      await until(() => doc('p1').querySelector('#alarm').classList.contains('show'));
      doc('p1').querySelector('#ackBtn').click();
      await until(() => !doc('p1').querySelector('#alarm').classList.contains('show'));
      return ok;
    });
    await check('ניתוק השרת מופיע בטלפון כפס אדום', async () => {
      setOnline('p3', false);
      const shown = await until(() => !doc('p3').querySelector('#downStrip').hidden, 8000);
      setOnline('p3', true);
      const gone = await until(() => doc('p3').querySelector('#downStrip').hidden);
      return shown && gone;
    });
    await check('הודעה מהפיט מגיעה לכל הטלפונים', async () => {
      const text = `בדיקה ${Math.floor(Math.random() * 900 + 100)}`;
      doc('pit').querySelector('#sendTo').value = 'all';
      typeInto(doc('pit'), '#sendText', text); submit(doc('pit'), '#sendForm');
      return until(() => ['p1', 'p2', 'p3'].every((p) => doc(p).querySelector('#msgs').textContent.includes(text)));
    });
    await check('תשובה מהירה מהטלפון מגיעה לפיט', async () => {
      doc('p1').querySelector('[data-quick="מוכנים בתור"]').click();
      return until(() => doc('pit').querySelector('#chat').textContent.includes('מוכנים בתור'));
    });
    await check('סימון ברשימת הבדיקה מסונכרן לטלפונים', async () => {
      const d = doc('pit');
      const i = [...d.querySelectorAll('#checklist .tick')].findIndex((x) => !x.classList.contains('done'));
      if (i < 0) return false;
      d.querySelectorAll('#checklist .tick')[i].click();
      return until(() => doc('p3').querySelectorAll('#checklist .tick')[i].classList.contains('done'));
    });
    await check('שינוי סוללה בטלפון מתעדכן בפיט', async () => {
      const sel = doc('p1').querySelector('select[data-batt="b3"]');
      sel.value = 'ready'; sel.dispatchEvent(new Event('change', { bubbles: true }));
      return until(() => doc('pit').querySelector('[data-bstep="b3"]')?.closest('.cell').querySelector('.state').textContent === 'מוכנה');
    });
    await check('רק סוללה אחת ברובוט בכל רגע', async () => {
      doc('pit').querySelector('[data-bstep="b2"][data-to="robot"]').click(); // מוכנה ← לרובוט
      return until(() => core.state.batteries.filter((b) => b.status === 'robot').length === 1
        && core.state.batteries.find((b) => b.id === 'b2').status === 'robot');
    });
    await check('ניתוק טלפון נראה בפיט, וחיבור מחדש מחזיר אותו', async () => {
      setOnline('p2', false);
      const off = await until(() => doc('pit').querySelectorAll('#members .lamp.on').length === 2);
      setOnline('p2', true);
      const on = await until(() => doc('pit').querySelectorAll('#members .lamp.on').length === 3);
      return off && on;
    });
    await check('קריאה לטלפון מנותק מצלצלת כשהוא חוזר', async () => {
      setOnline('p1', false);
      await wait(300);
      doc('pit').querySelector(`[data-alert="${memberId('נועה')}"]`).click();
      await wait(600);
      const silent = !doc('p1').querySelector('#alarm').classList.contains('show');
      setOnline('p1', true);
      const rang = await until(() => doc('p1').querySelector('#alarm').classList.contains('show'));
      doc('p1').querySelector('#ackBtn').click();
      return silent && rang;
    });
    await check('משחק חדש מאפס את רשימת הבדיקה', async () => {
      const key = core.buildView().next?.key;
      let guard = 0;
      while (core.buildView().next?.key === key && guard++ < 6) nextMatch();
      return until(() => doc('pit').querySelectorAll('#checklist .tick.done').length === 0
        && doc('p1').querySelectorAll('#checklist .tick.done').length === 0);
    });
    await check('התראת תור קופצת במסך הפיט כשמתקרבים', async () => {
      const q = doc('pit').querySelector('#queue');
      let guard = 0;
      while (!q.classList.contains('show') && guard++ < 6) { nextMatch(); await wait(500); }
      const ok = q.classList.contains('show');
      if (ok) doc('pit').querySelector('#queueOk').click();
      return ok;
    });

    const passed = results.filter(Boolean).length;
    const sum = $('#testSum');
    sum.textContent = passed === results.length ? `כל ${results.length} הבדיקות עברו` : `${results.length - passed} מתוך ${results.length} בדיקות נכשלו`;
    sum.className = `tag ${passed === results.length ? 'go' : 'signal'}`;
    log(sum.textContent, passed === results.length ? 'go' : 'signal');
    Sim.autoAck = oldAuto;
    setSpeed(oldSpeed);
    btn.disabled = false;
  }

  // ---------- חיבור וניתוק טלפון ----------
  function setOnline(id, on) {
    const f = frames[id];
    f.online = on;
    if (!on && f.bye) { f.bye(); f.bye = null; if (f.handlers && f.handlers.down) f.handlers.down(); }
    if (on) connectStream(f);
    const b = document.querySelector(`[data-net="${id}"]`);
    if (b) { b.setAttribute('aria-pressed', String(!on)); b.textContent = on ? 'ניתוק מהרשת' : 'חיבור לרשת'; }
    f.el.parentElement.classList.toggle('off', !on);
    log(on ? `${f.name} חזר לרשת` : `${f.name} יצא מהרשת`, on ? 'go' : 'amber');
  }

  // ---------- בניית המסכים ----------
  function makeFrame(id, kind, name, html, init) {
    const el = document.querySelector(`iframe[data-sim="${id}"]`);
    const f = { id, kind, name, store: new Map(), online: true, handlers: null, bye: null, el };
    frames[id] = f;
    if (init) init(f);
    el.addEventListener('load', () => {
      try { el.contentWindow.HoustonMute = Sim.muted; } catch {}
    });
    el.srcdoc = html.replace('/*__FONTS__*/', Sim.fontCss);
  }

  function fit() {
    document.querySelectorAll('.screen').forEach((s) => {
      const fr = s.querySelector('iframe');
      const k = s.clientWidth / Number(fr.getAttribute('width'));
      fr.style.transform = `scale(${k})`;
      s.style.height = `${Number(fr.getAttribute('height')) * k}px`;
    });
  }

  window.addEventListener('DOMContentLoaded', () => {
    Sim.fontCss = window.SIM_FONTS;
    makeFrame('pit', 'pit', 'מסך הפיט', window.SIM_PAGES.pit);
    makeFrame('p1', 'phone', 'נועה', window.SIM_PAGES.phone, (f) => { f.store.set('pit-token', preTokens.p1); f.store.set('pit-name', 'נועה'); });
    makeFrame('p2', 'phone', 'עומר', window.SIM_PAGES.phone, (f) => { f.store.set('pit-token', preTokens.p2); f.store.set('pit-name', 'עומר'); });
    makeFrame('p3', 'phone', 'תמר', window.SIM_PAGES.phone, (f) => { f.store.set('pit-name', 'תמר'); });
    // בטלפון של תמר קוד ההצטרפות כבר ממולא, כאילו סרקה את הקוד מהמסך
    frames.p3.el.addEventListener('load', () => { const c = frames.p3.el.contentDocument.querySelector('#jCode'); if (c) c.value = JOIN; });

    new ResizeObserver(fit).observe(document.body);
    fit();
    setSpeed(25);
    log('הסימולטור התחיל. נועה ועומר מחוברים, תמר עוד לא התחברה.', 'go');

    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-speed],[data-net],[data-call],#nextBtn,#testBtn,#muteBtn,#autoBtn');
      if (!t) return;
      if (t.dataset.call) {
        // במסך צר אין מסך פיט, אז קוראים מכאן
        const id = memberId(frames[t.dataset.call].name);
        if (!id) return log(`${frames[t.dataset.call].name} עוד לא התחברה`, 'amber');
        const r = core.handle('POST', '/api/alert', { admin: true }, { id, reason: 'לתור עכשיו' });
        if (r && r.code === 200) logAction(frames.pit, '/api/alert', { id, reason: 'לתור עכשיו' }, { admin: true });
        return;
      }
      if (t.dataset.speed !== undefined) return setSpeed(Number(t.dataset.speed));
      if (t.dataset.net) return setOnline(t.dataset.net, !frames[t.dataset.net].online);
      if (t.id === 'nextBtn') return nextMatch();
      if (t.id === 'testBtn') return selfTest();
      if (t.id === 'muteBtn') {
        Sim.muted = !Sim.muted;
        t.setAttribute('aria-pressed', String(!Sim.muted));
        t.textContent = Sim.muted ? 'הפעלת צלילים' : 'השתקה';
        Object.values(frames).forEach((f) => { try { f.el.contentWindow.HoustonMute = Sim.muted; } catch {} });
      }
      if (t.id === 'autoBtn') {
        Sim.autoAck = !Sim.autoAck;
        t.setAttribute('aria-pressed', String(Sim.autoAck));
      }
    });
  });
})();
