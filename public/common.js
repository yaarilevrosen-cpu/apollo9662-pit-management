// כלים משותפים למסך הפיט ולטלפון
const Pit = (() => {
  // אחסון בטלפון. בסימולטור כל טלפון מקבל אחסון משלו (HoustonStore).
  const store = window.HoustonStore || {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
  };
  let token = store.get('pit-token');
  const keyFromUrl = new URLSearchParams(location.search).get('key');

  // מסך הפיט לא שולח אסימון של טלפון, גם אם נשאר כזה בדפדפן
  const isPit = window.HoustonRole === 'pit';
  function authQS() {
    if (keyFromUrl && isPit) return `key=${encodeURIComponent(keyFromUrl)}`;
    if (token && !isPit) return `token=${encodeURIComponent(token)}`;
    return '';
  }
  function setToken(t) { token = t || null; store.set('pit-token', token); }

  async function api(path, body) {
    const sep = path.includes('?') ? '&' : '?';
    const r = await fetch(`${path}${sep}${authQS()}`, body === undefined ? {} : {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(data.error || String(r.status)); e.status = r.status; throw e; }
    return data;
  }

  // חיבור חי לשרת. אם הדפדפן מוותר (למשל שגיאה ממנהרה כשהשרת הופעל מחדש), פותחים חיבור חדש.
  function stream(handlers) {
    let es = null, closed = false, retry = null;
    function open() {
      es = new EventSource(`/api/stream?${authQS()}`);
      for (const [ev, fn] of Object.entries(handlers)) {
        es.addEventListener(ev, (e) => { let d = {}; try { d = JSON.parse(e.data); } catch {} fn(d); });
      }
      es.onerror = () => {
        handlers.down && handlers.down();
        if (es.readyState === EventSource.CLOSED && !closed) { clearTimeout(retry); retry = setTimeout(open, 3000); }
      };
      es.onopen = () => handlers.up && handlers.up();
    }
    open();
    return { close() { closed = true; clearTimeout(retry); es && es.close(); } };
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const time = (t) => (t ? new Date(t).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false }) : '');
  const ago = (t) => {
    if (!t) return '';
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 45) return 'עכשיו';
    if (s < 3600) return `לפני ${Math.max(1, Math.round(s / 60))} דק׳`;
    return `ב־${time(t)}`;
  };
  const seconds = (t) => Math.max(0, Math.floor((Date.now() - t) / 1000));
  const allianceName = (c) => (c === 'red' ? 'ברית אדומה' : 'ברית כחולה');
  const other = (c) => (c === 'red' ? 'blue' : 'red');
  const RESULT = { W: 'ניצחון', L: 'הפסד', T: 'תיקו' };

  function teamsHtml(list, color, me) {
    return list.map((n) => `<span class="tn ${n === me ? 'me' : color}">${esc(n)}</span>`).join('');
  }
  function awayText(n) {
    if (n == null) return '';
    if (n === 0) return 'על המגרש עכשיו';
    if (n === 1) return 'עוד משחק אחד';
    return `עוד ${n} משחקים`;
  }

  // ---------- צליל ----------
  let ctx = null, loop = null;
  function unlockAudio() {
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      const o = ctx.createOscillator(), g = ctx.createGain();
      g.gain.value = 0.0001; o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.02);
    } catch {}
  }
  function beep(freq = 880, dur = 0.18, vol = 0.6) {
    if (!ctx || window.HoustonMute) return;
    try {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'square'; o.frequency.value = freq;
      g.gain.setValueAtTime(vol, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + dur);
    } catch {}
  }
  function alarm(on, pattern = 'alarm') {
    clearInterval(loop); loop = null;
    if (!on) return;
    const tick = () => {
      if (pattern === 'alarm') { beep(988, 0.16); setTimeout(() => beep(740, 0.16), 200); }
      else { beep(660, 0.12, 0.4); setTimeout(() => beep(880, 0.2, 0.4), 160); }
    };
    tick();
    loop = setInterval(tick, pattern === 'alarm' ? 600 : 1400);
  }

  let toastTimer;
  function toast(text) {
    let el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div'); el.className = 'toast';
      el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
      document.body.append(el);
    }
    el.textContent = text; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  // סיבות קריאה מוכנות, כדי שבלחץ לא צריך להקליד
  const REASONS = ['לתור עכשיו', 'להביא סוללה', 'צריך נהג', 'בדיקת שופטים', 'תיקון דחוף'];

  return {
    api, stream, esc, time, ago, seconds, allianceName, other, RESULT, teamsHtml, awayText,
    unlockAudio, beep, alarm, toast, setToken, store, REASONS,
    get token() { return token; },
  };
})();
