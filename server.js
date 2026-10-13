// מרכז הפיט — Apollo #9662
// שרת יחיד בלי תלויות. הפעלה: node server.js
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA_FILE = path.join(ROOT, 'data.json');
// הגדרות מקומיות שלא נכנסות למאגר (מוחרג ב־.gitignore)
const LOCAL_CONFIG_FILE = path.join(ROOT, 'config.local.json');
const PORT = Number(process.env.PORT) || 8765;
const API = 'https://api.ftcscout.org/rest/v1';
const REFRESH_MS = 45_000;
const DEMO_STEP_MS = 75_000; // במצב הדגמה: משחק חדש "משוחק" כל 75 שניות

// ---------- אחסון ----------
const rid = (n = 8) => crypto.randomBytes(n).toString('hex');
const code6 = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

function defaultSeason(d = new Date()) {
  // עונת FTC מתחילה בספטמבר
  return d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
}

const DEFAULT_STATE = () => ({
  settings: {
    team: 9662,
    season: null,          // null = אוטומטי
    eventCode: '',         // ריק = אוטומטי
    joinCode: code6(),
    adminKey: rid(12),
    queueWarnAt: 2,
    demo: false,
    checklist: [
      'סוללה טעונה ומחוברת',
      'רכזת הנהג טעונה ומחוברת לרובוט',
      'שלטים מחוברים ומשויכים',
      'נבחרה תוכנית אוטונומית נכונה',
      'ברגים ומחברים נבדקו',
      'סימון הברית על הרובוט',
    ],
  },
  members: {},     // id -> {id, name, token, joinedAt, lastSeen, alert:{state, at, ackAt}}
  messages: [],    // {id, from, to, text, at, readBy:[]}
  checklistDone: { matchKey: '', done: [] },
  batteries: [],   // {id, name, status, voltage, uses, updatedAt}
  repairs: [],     // {id, text, by, at, done, doneAt}
  demoStartedAt: 0,
});

// ---------- הגדרות מקומיות ----------
// הקישור לאפליקציית הסקאוטינג (04) נשמר רק כאן, כי המאגר ציבורי.
// אם הקובץ חסר או שהקישור לא תקין, הכפתור מוצג כלא פעיל.
let localConfig = { scoutingUrl: '' };
let localConfigMtime = -1;
function loadLocalConfig() {
  let mtime = 0;
  try { mtime = fs.statSync(LOCAL_CONFIG_FILE).mtimeMs; } catch { mtime = 0; }
  if (mtime === localConfigMtime) return;
  localConfigMtime = mtime;
  localConfig = { scoutingUrl: '' };
  if (!mtime) return;
  try {
    const c = JSON.parse(fs.readFileSync(LOCAL_CONFIG_FILE, 'utf8'));
    const u = new URL(String(c.scoutingUrl || ''));
    if (u.protocol === 'https:') localConfig.scoutingUrl = u.href;
    else console.error('config.local.json: scoutingUrl חייב להתחיל ב־https');
  } catch (e) {
    console.error('config.local.json לא נקרא:', e.message);
  }
}
loadLocalConfig();

let state;
try {
  state = Object.assign(DEFAULT_STATE(), JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
  state.settings = Object.assign(DEFAULT_STATE().settings, state.settings);
} catch {
  state = DEFAULT_STATE();
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(DATA_FILE + '.tmp', JSON.stringify(state, null, 2), (e) => {
      if (!e) fs.rename(DATA_FILE + '.tmp', DATA_FILE, () => {});
    });
  }, 300);
}
save();

// ---------- נתוני תחרות ----------
const cache = {
  event: null, matches: [], error: '', updatedAt: 0, season: null,
};

async function getJSON(url) {
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

function seasonInUse() {
  if (state.settings.demo) return 2025;
  return state.settings.season || defaultSeason();
}

async function pickEvent(team, season) {
  const list = await getJSON(`${API}/teams/${team}/events/${season}`);
  if (!list.length) return null;
  const events = await Promise.all(
    list.map((e) => getJSON(`${API}/events/${season}/${e.eventCode}`).catch(() => null)),
  );
  const today = new Date().toISOString().slice(0, 10);
  const ok = events.filter(Boolean).filter((e) => !e.remote);
  // אירוע שמתקיים היום, אחרת הבא בתור, אחרת האחרון שהיה
  const running = ok.find((e) => e.start <= today && e.end >= today);
  if (running) return running;
  const upcoming = ok.filter((e) => e.start > today).sort((a, b) => a.start.localeCompare(b.start));
  if (upcoming.length) return upcoming[0];
  return ok.sort((a, b) => b.end.localeCompare(a.end))[0] || null;
}

async function refresh() {
  const s = state.settings;
  const season = seasonInUse();
  try {
    let event;
    if (s.demo) {
      event = await getJSON(`${API}/events/2025/ILCMPMSDA`);
    } else if (s.eventCode) {
      event = await getJSON(`${API}/events/${season}/${s.eventCode.toUpperCase()}`);
    } else {
      event = await pickEvent(s.team, season);
    }
    cache.event = event;
    cache.season = season;
    if (event) {
      cache.matches = await getJSON(`${API}/events/${season}/${event.code}/matches`);
    } else {
      cache.matches = [];
    }
    cache.error = '';
    cache.updatedAt = Date.now();
  } catch (e) {
    cache.error = 'אין חיבור לנתוני התחרות כרגע. מנסה שוב בקרוב.';
    console.error('refresh failed:', e.message);
  }
  broadcast('change');
}

// ---------- עיבוד משחקים ----------
function matchLabel(m) {
  // מ׳ = מוקדמות, פ׳ = פלייאוף, ג׳ = גמר
  if (m.tournamentLevel === 'Quals') return `מ׳${m.id}`;
  if (m.tournamentLevel === 'DoubleElim' || m.tournamentLevel === 'Playoffs') return `פ׳${m.series || m.id}`;
  if (m.tournamentLevel === 'Finals') return `ג׳${m.series || m.id}`;
  return String(m.id);
}
const STATION = { One: 1, Two: 2, Three: 3 };

function demoCut(sorted) {
  // כמה משחקים כבר "שוחקו" במצב הדגמה
  // מתחילים באמצע האירוע: שני משחקים שלנו כבר שוחקו, והשלישי עוד ארבעה משחקים
  const oursIdx = sorted.map((m, i) => (m.teams?.some((t) => t.teamNumber === state.settings.team) ? i : -1)).filter((i) => i >= 0);
  const third = oursIdx[2] ?? oursIdx[oursIdx.length - 1] ?? 4;
  const base = Math.max(0, third - 4);
  const step = Math.floor((Date.now() - (state.demoStartedAt || Date.now())) / DEMO_STEP_MS);
  return Math.min(sorted.length, base + step);
}

function buildView() {
  const team = Number(state.settings.team);
  const sorted = [...cache.matches].sort((a, b) => {
    const ta = a.scheduledStartTime || '', tb = b.scheduledStartTime || '';
    return ta === tb ? a.id - b.id : ta.localeCompare(tb);
  });
  const cut = state.settings.demo ? demoCut(sorted) : Infinity;
  const played = (m, i) => (state.settings.demo ? i < cut : m.hasBeenPlayed);

  const ours = [];
  let firstUnplayedIdx = sorted.findIndex((m, i) => !played(m, i));
  if (firstUnplayedIdx === -1) firstUnplayedIdx = sorted.length;

  sorted.forEach((m, i) => {
    const me = m.teams?.find((t) => t.teamNumber === team);
    if (!me) return;
    const color = me.alliance === 'Red' ? 'red' : 'blue';
    const other = color === 'red' ? 'blue' : 'red';
    const partners = m.teams.filter((t) => t.alliance === me.alliance && t.teamNumber !== team).map((t) => t.teamNumber);
    const opponents = m.teams.filter((t) => t.alliance !== me.alliance).map((t) => t.teamNumber);
    const isPlayed = played(m, i);
    let our = null, their = null, result = null;
    if (isPlayed && m.scores?.[color]) {
      our = m.scores[color].totalPoints;
      their = m.scores[other].totalPoints;
      result = our > their ? 'W' : our < their ? 'L' : 'T';
    }
    ours.push({
      key: `${m.tournamentLevel}-${m.series}-${m.id}`,
      label: matchLabel(m),
      level: m.tournamentLevel,
      color, station: STATION[me.station] || null,
      partners, opponents,
      time: m.scheduledStartTime,
      played: isPlayed, our, their, result,
      away: isPlayed ? null : Math.max(0, i - firstUnplayedIdx),
    });
  });

  const next = ours.find((m) => !m.played) || null;
  loadLocalConfig();

  return {
    team,
    season: cache.season,
    demo: !!state.settings.demo,
    event: cache.event && {
      code: cache.event.code, name: cache.event.name, start: cache.event.start, end: cache.event.end,
      venue: cache.event.venue, city: cache.event.city, fields: cache.event.fieldCount,
    },
    error: cache.error,
    updatedAt: cache.updatedAt,
    totalMatches: sorted.length,
    playedMatches: Math.min(firstUnplayedIdx, sorted.length),
    ours, next,
    playingNow: !!(next && next.away === 0),
    scoutingUrl: localConfig.scoutingUrl,
  };
}

// ---------- רשימת בדיקה: מתאפסת כשהמשחק הבא מתחלף ----------
function checklistView(view) {
  const key = view.next?.key || 'none';
  if (state.checklistDone.matchKey !== key) {
    state.checklistDone = { matchKey: key, done: [] };
    save();
  }
  return state.settings.checklist.map((text, i) => ({ text, done: state.checklistDone.done.includes(i) }));
}

// ---------- זמן אמת (אירועים מהשרת) ----------
const clients = new Set(); // {res, kind:'admin'|'member', memberId}
function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`);
}
function broadcast(event, data, filter = () => true) {
  for (const c of clients) if (filter(c)) sse(c.res, event, data);
}
setInterval(() => broadcast('ping', { t: Date.now() }), 20_000);

function online(memberId) {
  for (const c of clients) if (c.memberId === memberId) return true;
  return false;
}

// ---------- הרשאות ----------
function isLocal(req) {
  const a = req.socket.remoteAddress || '';
  const host = (req.headers.host || '').split(':')[0];
  const loop = a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
  // מנהרה מתחברת מהמחשב עצמו, לכן בודקים גם את שם המארח
  return loop && (host === 'localhost' || host === '127.0.0.1' || host === '[::1]');
}
function auth(req, url) {
  const key = url.searchParams.get('key') || req.headers['x-admin-key'];
  if (isLocal(req) || key === state.settings.adminKey) return { admin: true };
  const token = url.searchParams.get('token') || req.headers['x-token'];
  if (token) {
    const m = Object.values(state.members).find((x) => x.token === token);
    if (m) { m.lastSeen = Date.now(); return { member: m }; }
  }
  return {};
}

// ---------- מצב לכל סוג משתמש ----------
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  }
  return out;
}

function memberList() {
  return Object.values(state.members).map((m) => ({
    id: m.id, name: m.name, online: online(m.id), lastSeen: m.lastSeen,
    alert: m.alert || { state: 'none' },
  }));
}

function adminState() {
  const view = buildView();
  return {
    ...view,
    checklist: checklistView(view),
    settings: { ...state.settings, adminKey: undefined },
    adminKey: state.settings.adminKey,
    members: memberList(),
    messages: state.messages.slice(-200),
    batteries: state.batteries,
    repairs: state.repairs,
    addresses: lanAddresses().map((ip) => `http://${ip}:${PORT}`),
  };
}

function memberState(m) {
  const view = buildView();
  return {
    ...view,
    checklist: checklistView(view),
    me: { id: m.id, name: m.name, alert: m.alert || { state: 'none' } },
    messages: state.messages.filter((x) => x.to === 'all' || x.to === m.id || x.from === m.id).slice(-100),
    batteries: state.batteries,
    repairs: state.repairs,
  };
}

// ---------- בקשות ----------
function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } });
  });
}
const clean = (s, n = 500) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png',
};
function serveStatic(res, file) {
  const p = path.normalize(path.join(PUBLIC, file));
  if (!p.startsWith(PUBLIC)) return send(res, 404, 'not found', 'text/plain');
  fs.readFile(p, (e, buf) => {
    if (e) return send(res, 404, 'not found', 'text/plain');
    send(res, 200, buf, MIME[path.extname(p)] || 'application/octet-stream');
  });
}

function changed() { save(); broadcast('change'); }

const routes = {
  'POST /api/join': async (req, res, a, body) => {
    const name = clean(body.name, 30);
    if (!name) return send(res, 400, { error: 'צריך שם' });
    if (state.settings.joinCode && String(body.code || '').trim() !== state.settings.joinCode) {
      return send(res, 403, { error: 'קוד ההצטרפות שגוי' });
    }
    // אותו שם = אותו חבר צוות (מתחבר מחדש מטלפון אחר)
    let m = Object.values(state.members).find((x) => x.name === name);
    if (!m) {
      m = { id: rid(4), name, joinedAt: Date.now(), alert: { state: 'none' } };
      state.members[m.id] = m;
    }
    m.token = rid(16);
    m.lastSeen = Date.now();
    changed();
    send(res, 200, { token: m.token, id: m.id, team: state.settings.team });
  },

  'GET /api/state': (req, res, a) => {
    if (a.admin) return send(res, 200, adminState());
    if (a.member) return send(res, 200, memberState(a.member));
    send(res, 401, { error: 'לא מחובר' });
  },

  'POST /api/alert': (req, res, a, body) => {
    if (!a.admin) return send(res, 403, {});
    const ids = body.id === 'all' ? Object.keys(state.members) : [body.id];
    const reason = clean(body.reason, 80) || 'בוא לפיט עכשיו!';
    for (const id of ids) {
      const m = state.members[id];
      if (!m) continue;
      m.alert = { state: 'ringing', at: Date.now(), reason };
      broadcast('alert', { reason }, (c) => c.memberId === id);
    }
    changed();
    send(res, 200, { ok: true });
  },

  'POST /api/alert/cancel': (req, res, a, body) => {
    if (!a.admin) return send(res, 403, {});
    const m = state.members[body.id];
    if (m) { m.alert = { state: 'none' }; broadcast('alert-stop', {}, (c) => c.memberId === m.id); }
    changed();
    send(res, 200, { ok: true });
  },

  'POST /api/ack': (req, res, a) => {
    if (!a.member) return send(res, 403, {});
    a.member.alert = { ...(a.member.alert || {}), state: 'ack', ackAt: Date.now() };
    broadcast('ack', { name: a.member.name }, (c) => c.kind === 'admin');
    changed();
    send(res, 200, { ok: true });
  },

  'POST /api/message': (req, res, a, body) => {
    const text = clean(body.text, 500);
    if (!text) return send(res, 400, {});
    let msg;
    if (a.admin) {
      const to = body.to === 'all' || state.members[body.to] ? body.to : 'all';
      msg = { id: rid(5), from: 'pit', to, text, at: Date.now(), readBy: [] };
    } else if (a.member) {
      msg = { id: rid(5), from: a.member.id, fromName: a.member.name, to: 'pit', text, at: Date.now(), readBy: [] };
    } else return send(res, 403, {});
    state.messages.push(msg);
    if (state.messages.length > 500) state.messages.splice(0, state.messages.length - 500);
    broadcast('message', { from: msg.from === 'pit' ? 'הפיט' : msg.fromName, to: msg.to }, (c) =>
      msg.to === 'all' || c.memberId === msg.to || (msg.to === 'pit' && c.kind === 'admin'));
    changed();
    send(res, 200, { ok: true });
  },

  'POST /api/read': (req, res, a, body) => {
    const who = a.admin ? 'pit' : a.member?.id;
    if (!who) return send(res, 403, {});
    let dirty = false;
    for (const m of state.messages) {
      if ((body.ids || []).includes(m.id) && !m.readBy.includes(who)) { m.readBy.push(who); dirty = true; }
    }
    if (dirty) changed();
    send(res, 200, { ok: true });
  },

  'POST /api/check': (req, res, a, body) => {
    if (!a.admin && !a.member) return send(res, 403, {});
    if (body.reset) { state.checklistDone.done = []; changed(); return send(res, 200, { ok: true }); }
    const i = Number(body.index);
    const done = new Set(state.checklistDone.done);
    if (body.done) done.add(i); else done.delete(i);
    state.checklistDone.done = [...done];
    changed();
    send(res, 200, { ok: true });
  },

  'POST /api/battery': (req, res, a, body) => {
    if (!a.admin && !a.member) return send(res, 403, {});
    const STATUSES = ['charging', 'ready', 'robot', 'used'];
    if (body.action === 'add') {
      const name = clean(body.name, 20) || `סוללה ${state.batteries.length + 1}`;
      state.batteries.push({ id: rid(4), name, status: 'charging', voltage: null, uses: 0, updatedAt: Date.now() });
    } else {
      const b = state.batteries.find((x) => x.id === body.id);
      if (!b) return send(res, 404, {});
      if (body.action === 'delete') state.batteries = state.batteries.filter((x) => x !== b);
      if (body.action === 'status' && STATUSES.includes(body.status)) {
        if (body.status === 'robot') {
          // רק סוללה אחת ברובוט בכל רגע
          for (const o of state.batteries) if (o.status === 'robot' && o !== b) o.status = 'used';
          b.uses += 1;
        }
        b.status = body.status;
      }
      if (body.action === 'voltage') {
        const v = Number(body.voltage);
        b.voltage = Number.isFinite(v) && v > 0 && v < 20 ? Math.round(v * 100) / 100 : null;
      }
      b.updatedAt = Date.now();
    }
    changed();
    send(res, 200, { ok: true });
  },

  'POST /api/repair': (req, res, a, body) => {
    if (!a.admin && !a.member) return send(res, 403, {});
    const by = a.admin ? 'הפיט' : a.member.name;
    if (body.action === 'add') {
      const text = clean(body.text, 200);
      if (!text) return send(res, 400, {});
      state.repairs.unshift({ id: rid(4), text, by, at: Date.now(), done: false });
    } else {
      const r = state.repairs.find((x) => x.id === body.id);
      if (!r) return send(res, 404, {});
      if (body.action === 'toggle') { r.done = !r.done; r.doneAt = r.done ? Date.now() : null; r.doneBy = by; }
      if (body.action === 'delete') state.repairs = state.repairs.filter((x) => x !== r);
    }
    changed();
    send(res, 200, { ok: true });
  },

  'POST /api/settings': async (req, res, a, body) => {
    if (!a.admin) return send(res, 403, {});
    const s = state.settings;
    if (body.team !== undefined) { const t = parseInt(body.team, 10); if (t > 0 && t < 100000) s.team = t; }
    if (body.season !== undefined) { const y = parseInt(body.season, 10); s.season = y > 2018 && y < 2100 ? y : null; }
    if (body.eventCode !== undefined) s.eventCode = clean(body.eventCode, 20).replace(/[^A-Za-z0-9]/g, '');
    if (body.joinCode !== undefined) s.joinCode = clean(body.joinCode, 12);
    if (body.newJoinCode) s.joinCode = code6();
    if (body.queueWarnAt !== undefined) s.queueWarnAt = Math.max(0, Math.min(10, parseInt(body.queueWarnAt, 10) || 0));
    if (Array.isArray(body.checklist)) s.checklist = body.checklist.map((x) => clean(x, 120)).filter(Boolean).slice(0, 30);
    if (body.demo !== undefined) { s.demo = !!body.demo; state.demoStartedAt = Date.now(); }
    if (body.removeMember && state.members[body.removeMember]) {
      broadcast('kicked', {}, (c) => c.memberId === body.removeMember);
      delete state.members[body.removeMember];
    }
    if (body.clearMessages) state.messages = [];
    save();
    send(res, 200, { ok: true });
    refresh();
  },

  'POST /api/refresh': (req, res, a) => {
    if (!a.admin) return send(res, 403, {});
    send(res, 200, { ok: true });
    refresh();
  },
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const a = auth(req, url);

  if (req.method === 'GET' && url.pathname === '/api/stream') {
    if (!a.admin && !a.member) return send(res, 401, {});
    res.writeHead(200, {
      'content-type': 'text/event-stream', 'cache-control': 'no-store',
      connection: 'keep-alive', 'x-accel-buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    const c = { res, kind: a.admin ? 'admin' : 'member', memberId: a.member?.id };
    clients.add(c);
    if (a.member?.alert?.state === 'ringing') sse(res, 'alert', { reason: a.member.alert.reason });
    broadcast('change', {}, (x) => x.kind === 'admin');
    req.on('close', () => { clients.delete(c); broadcast('change', {}, (x) => x.kind === 'admin'); });
    return;
  }

  const route = routes[`${req.method} ${url.pathname}`];
  if (route) {
    const body = req.method === 'POST' ? await readBody(req) : {};
    try { return await route(req, res, a, body); } catch (e) {
      console.error(e);
      return send(res, 500, { error: 'שגיאה בשרת' });
    }
  }

  if (req.method !== 'GET') return send(res, 404, {});
  if (url.pathname === '/' ) {
    // המסך הראשי נפתח רק מהמחשב עצמו או עם מפתח מנהל
    return a.admin ? serveStatic(res, 'dashboard.html') : serveStatic(res, 'phone.html');
  }
  if (url.pathname === '/m' || url.pathname === '/phone') return serveStatic(res, 'phone.html');
  serveStatic(res, url.pathname.slice(1));
});

server.listen(PORT, '0.0.0.0', () => {
  const addrs = lanAddresses();
  console.log('\n  מרכז הפיט פועל');
  console.log(`  מסך הפיט:      http://localhost:${PORT}`);
  for (const ip of addrs) console.log(`  לטלפונים:      http://${ip}:${PORT}/m`);
  console.log(`  קוד הצטרפות:   ${state.settings.joinCode || '(ללא)'}`);
  console.log(`  מפתח מנהל (לפתיחת מסך הפיט ממחשב אחר): /?key=${state.settings.adminKey}\n`);
  refresh();
  setInterval(refresh, REFRESH_MS);
  // במצב הדגמה מרעננים לעתים קרובות כדי לראות את ההתקדמות
  setInterval(() => { if (state.settings.demo) broadcast('change'); }, 15_000);
});
