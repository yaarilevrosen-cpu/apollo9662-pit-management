// כלים משותפים למסך הפיט ולטלפון
const Pit = (() => {
  let token = null;
  try { token = localStorage.getItem('pit-token'); } catch {}
  const keyFromUrl = new URLSearchParams(location.search).get('key');

  function authQS() {
    if (keyFromUrl) return `key=${encodeURIComponent(keyFromUrl)}`;
    if (token) return `token=${encodeURIComponent(token)}`;
    return '';
  }
  function setToken(t) { token = t; try { t ? localStorage.setItem('pit-token', t) : localStorage.removeItem('pit-token'); } catch {} }

  async function api(path, body) {
    const sep = path.includes('?') ? '&' : '?';
    const r = await fetch(`${path}${sep}${authQS()}`, body === undefined ? {} : {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(data.error || r.status); e.status = r.status; throw e; }
    return data;
  }

  function stream(handlers) {
    const es = new EventSource(`/api/stream?${authQS()}`);
    for (const [ev, fn] of Object.entries(handlers)) {
      es.addEventListener(ev, (e) => { let d = {}; try { d = JSON.parse(e.data); } catch {} fn(d); });
    }
    es.onerror = () => handlers.down && handlers.down();
    es.onopen = () => handlers.up && handlers.up();
    return es;
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const time = (t) => t ? new Date(t).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) : '';
  const ago = (t) => {
    if (!t) return '';
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return 'עכשיו';
    if (s < 3600) return `לפני ${Math.round(s / 60)} דק׳`;
    return time(t);
  };
  const colorName = (c) => (c === 'red' ? 'אדומה' : 'כחולה');
  const fixed = (v, n = 1) => (v == null ? '—' : Number(v).toFixed(n));

  function teamsHtml(list, color, me) {
    return list.map((n) => `<span class="tn ${color} ${n === me ? 'me' : ''}">${n}</span>`).join('');
  }
  function awayText(n) {
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
    if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square'; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + dur);
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
    if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.append(el); }
    el.textContent = text; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  return { api, stream, esc, time, ago, colorName, fixed, teamsHtml, awayText, unlockAudio, beep, alarm, toast, setToken, get token() { return token; } };
})();
