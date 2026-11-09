// יוסטון — אפליקציית ניהול הפיט של Apollo #9662
// שרת יחיד בלי תלויות. הפעלה: node server.js
// הלוגיקה עצמה ב־lib/core.js. כאן רק רשת, קבצים ולוח המשחקים מהאתר.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { createCore } = require('./lib/core');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA_FILE = process.env.HOUSTON_DATA || path.join(ROOT, 'data.json');
const PORT = Number(process.env.PORT) || 8765;
const API = 'https://api.ftcscout.org/rest/v1';
const REFRESH_MS = 45_000;

// ---------- אחסון ----------
const rid = (n = 8) => crypto.randomBytes(n).toString('hex');
const code6 = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

let saved = null;
try { saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) {
  // קובץ פגום לא נמחק: שומרים עותק לפני שמתחילים מחדש
  if (e.code !== 'ENOENT') { try { fs.copyFileSync(DATA_FILE, `${DATA_FILE}.broken-${Date.now()}`); } catch {} }
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(DATA_FILE + '.tmp', JSON.stringify(core.state, null, 2), (e) => {
      if (!e) fs.rename(DATA_FILE + '.tmp', DATA_FILE, () => {});
    });
  }, 300);
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  }
  return out;
}

const core = createCore({
  state: saved, rid, code6, save,
  addresses: () => lanAddresses().map((ip) => `http://${ip}:${PORT}`),
});
const state = core.state;
save();

// ---------- לוח המשחקים מהאתר ----------
function defaultSeason(d = new Date()) {
  // עונת FTC מתחילה בספטמבר
  return d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
}

async function getJSON(url) {
  const r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
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

let refreshing = false, again = false;
async function refresh() {
  // אם כבר מושכים, מושכים שוב בסוף עם ההגדרות החדשות
  if (refreshing) { again = true; return; }
  refreshing = true;
  const s = state.settings;
  const season = seasonInUse();
  try {
    let event;
    if (s.demo) event = await getJSON(`${API}/events/2025/ILCMPMSDA`);
    else if (s.eventCode) event = await getJSON(`${API}/events/${season}/${s.eventCode.toUpperCase()}`);
    else event = await pickEvent(s.team, season);
    const matches = event ? await getJSON(`${API}/events/${season}/${event.code}/matches`) : [];
    core.setSchedule({ event, matches, season, error: '', updatedAt: Date.now() });
  } catch (e) {
    // שומרים את הלוח האחרון שהצלחנו להביא, ומודיעים שהוא לא מתעדכן
    core.setSchedule({ error: 'אין חיבור ללוח המשחקים כרגע. מוצג הלוח האחרון שהתקבל, ומנסים שוב בקרוב.' });
    console.error('refresh failed:', e.message);
  } finally {
    refreshing = false;
    if (again) { again = false; refresh(); }
  }
}

// ---------- בקשות ----------
function isLocal(req) {
  const a = req.socket.remoteAddress || '';
  const host = (req.headers.host || '').split(':')[0];
  const loop = a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
  // מנהרה מתחברת מהמחשב עצמו, לכן בודקים גם את שם המארח
  return loop && (host === 'localhost' || host === '127.0.0.1' || host === '[::1]');
}

// מאיפה הבקשה. דרך מנהרה כל הבקשות מגיעות מהמחשב עצמו, ואז הכתובת האמיתית בכותרת.
function clientIp(req) {
  const a = req.socket.remoteAddress || '';
  const loop = a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
  if (loop) return String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || a).split(',')[0].trim();
  return a;
}

function send(res, code, body, type = 'application/json; charset=utf-8') {
  const headers = { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  // הדפים לא נטענים בתוך אתר אחר, ולא טוענים מסגרות מאתרים אחרים
  if (type.startsWith('text/html')) headers['content-security-policy'] = "frame-src 'self'; child-src 'self'; frame-ancestors 'self'";
  res.writeHead(code, headers);
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 1e5) { req.destroy(); resolve(null); } });
    req.on('end', () => { try { const v = JSON.parse(d || '{}'); resolve(v && typeof v === 'object' ? v : {}); } catch { resolve({}); } });
    req.on('error', () => resolve(null));
    req.on('close', () => resolve(null));
  });
}

// בקשת שינוי חייבת להגיע מהדפים של יוסטון עצמו, ולא מאתר אחר שפתוח בדפדפן של המחשב בפיט
function sameSite(req) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) return false;
  const origin = req.headers.origin;
  if (!origin || origin === 'null') return !origin;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.woff2': 'font/woff2',
};
function serveStatic(res, file) {
  if (file.includes('\0')) return send(res, 404, 'not found', 'text/plain');
  const p = path.normalize(path.join(PUBLIC, file));
  if (!p.startsWith(PUBLIC + path.sep)) return send(res, 404, 'not found', 'text/plain');
  fs.readFile(p, (e, buf) => {
    if (e) return send(res, 404, 'not found', 'text/plain');
    send(res, 200, buf, MIME[path.extname(p)] || 'application/octet-stream');
  });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.error('request failed:', e && e.message);
    try { if (!res.headersSent) send(res, 500, { error: 'שגיאה בשרת' }); else res.end(); } catch {}
  });
});

async function handle(req, res) {
  let url;
  try { url = new URL(req.url, 'http://x'); if (url.host !== 'x') throw new Error('host'); } catch { return send(res, 400, 'bad request', 'text/plain'); }
  const a = core.auth({
    ip: clientIp(req),
    local: isLocal(req),
    key: url.searchParams.get('key') || req.headers['x-admin-key'],
    token: url.searchParams.get('token') || req.headers['x-token'],
  });

  if (req.method === 'GET' && url.pathname === '/api/stream') {
    if (!a.admin && !a.member) return send(res, 401, {});
    res.writeHead(200, {
      'content-type': 'text/event-stream', 'cache-control': 'no-store',
      connection: 'keep-alive', 'x-accel-buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    const bye = core.connect({
      kind: a.admin ? 'admin' : 'member',
      memberId: a.member && a.member.id,
      send: (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`),
      close: () => res.end(),
    });
    req.on('close', bye);
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    if (req.method === 'POST' && !sameSite(req)) return send(res, 403, { error: 'בקשה לא מורשית' });
    const body = req.method === 'POST' ? await readBody(req) : {};
    if (body === null) return;
    let r;
    try { r = core.handle(req.method, url.pathname, a, body); } catch (e) {
      console.error(e);
      return send(res, 500, { error: 'שגיאה בשרת' });
    }
    if (!r) return send(res, 404, {});
    send(res, r.code, r.body);
    if (r.refresh) refresh();
    return;
  }

  if (req.method !== 'GET') return send(res, 404, {});
  let file;
  try { file = path.posix.normalize(decodeURIComponent(url.pathname)).replace(/^\/+/, ''); } catch { return send(res, 404, 'not found', 'text/plain'); }
  // מסך הפיט נפתח רק מהמחשב עצמו או עם מפתח מנהל
  if (file === '' || file === 'dashboard.html') return serveStatic(res, a.admin ? 'dashboard.html' : 'phone.html');
  if (file === 'm' || file === 'phone') return serveStatic(res, 'phone.html');
  serveStatic(res, file);
}

process.on('uncaughtException', (e) => console.error('unexpected error:', e && e.stack));
process.on('unhandledRejection', (e) => console.error('unexpected error:', e));

// סימן חיים לכל מי שמחובר, כדי שהחיבור לא ייסגר ושהטלפון יידע שהוא עדיין מחובר
setInterval(() => core.broadcast('ping', { t: Date.now() }), 20_000);

server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `\n  יוסטון כבר פועל על פורט ${PORT}. סוגרים את החלון השני.\n` : e);
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  const addrs = lanAddresses();
  console.log('\n  יוסטון פועל');
  console.log(`  מסך הפיט:      http://localhost:${PORT}`);
  for (const ip of addrs) console.log(`  לטלפונים:      http://${ip}:${PORT}/m`);
  console.log(`  קוד הצטרפות:   ${state.settings.joinCode || '(ללא)'}`);
  console.log('  לפתיחת מסך הפיט ממחשב אחר: הקישור נמצא בחלון "חיבור טלפונים והגדרות"\n');
  refresh();
  setInterval(refresh, REFRESH_MS);
  // במצב הדגמה מרעננים לעתים קרובות כדי לראות את ההתקדמות
  setInterval(() => { if (state.settings.demo) core.broadcast('change'); }, 15_000);
});
