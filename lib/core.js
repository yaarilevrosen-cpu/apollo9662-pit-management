// יוסטון — הלוגיקה של השרת, בלי רשת ובלי קבצים.
// אותו קוד רץ בשרת האמיתי (server.js) ובסימולטור (demo/houston-simulator.html),
// כך שמה שנבדק בסימולטור הוא בדיוק מה שרץ בפיט.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HoustonCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEMO_STEP_MS = 75_000; // במצב הדגמה: משחק חדש "משוחק" כל 75 שניות
  const STATION = { One: 1, Two: 2, Three: 3 };
  const BATTERY = ['charging', 'ready', 'robot', 'used'];
  const RING_MS = 120_000;       // אחרי שתי דקות בלי תשובה: "לא ענה"
  const MAX_TOKENS = 3;          // אותו חבר צוות יכול להיות מחובר מכמה טלפונים
  const JOIN_FAILS_PER_MIN = 10; // הגנה מניחוש של קוד ההצטרפות

  function defaultSettings(code6, rid) {
    return {
      team: 9662,
      season: null,          // ריק = אוטומטי
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
    };
  }

  function defaultState(code6, rid) {
    return {
      settings: defaultSettings(code6, rid),
      members: {},     // מזהה -> {id, name, token, joinedAt, lastSeen, alert:{state, at, ackAt, reason}}
      messages: [],    // {id, from, to, text, at, readBy:[]}
      checklistDone: { matchKey: '', done: [] },
      batteries: [],   // {id, name, status, voltage, uses, updatedAt}
      repairs: [],     // {id, text, by, at, done, doneAt}
      demoStartedAt: 0,
    };
  }

  /**
   * opts:
   *   state      – מצב שמור (או ריק)
   *   rid(n)     – מזהה אקראי
   *   code6()    – קוד הצטרפות בן שש ספרות
   *   now()      – השעה (בסימולטור אפשר להאיץ)
   *   save()     – נקרא אחרי כל שינוי
   *   addresses()– כתובות המחשב ברשת המקומית
   */
  function createCore(opts) {
    const { rid, code6 } = opts;
    const now = opts.now || (() => Date.now());
    const save = opts.save || (() => {});
    const addresses = opts.addresses || (() => []);

    const base = defaultState(code6, rid);
    const state = Object.assign(base, opts.state || {});
    state.settings = Object.assign(defaultSettings(code6, rid), state.settings || {});
    // גרסה 1 שמרה אסימון אחד לכל חבר צוות
    for (const m of Object.values(state.members)) {
      if (!Array.isArray(m.tokens)) m.tokens = m.token ? [m.token] : [];
      delete m.token;
    }
    const has = (obj, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(obj, k);
    const member = (id) => (has(state.members, id) ? state.members[id] : null);

    // לוח המשחקים מגיע מבחוץ (השרת מושך מהאתר, הסימולטור ממציא)
    const schedule = { event: null, matches: [], error: '', updatedAt: 0, season: null };
    function setSchedule(s) { Object.assign(schedule, s); broadcast('change'); }

    // ---------- זמן אמת ----------
    const clients = new Set(); // {kind:'admin'|'member', memberId, send(event, data), close()}
    let joinFails = [];
    let missedTimer = null;
    function broadcast(event, data, filter = () => true) {
      for (const c of clients) if (filter(c)) { try { c.send(event, data ?? {}); } catch {} }
    }
    function online(memberId) {
      for (const c of clients) if (c.memberId === memberId) return true;
      return false;
    }
    function dropStreams(memberId) {
      for (const c of [...clients]) if (c.memberId === memberId) { clients.delete(c); try { c.close && c.close(); } catch {} }
    }
    // קריאה שלא נענתה תוך שתי דקות מסומנת "לא ענה" (הטלפון כבר הפסיק לצלצל)
    function alertOf(m) {
      const a = m.alert || { state: 'none' };
      if (a.state === 'ringing' && now() - a.at > RING_MS) return { ...a, state: 'missed' };
      return a;
    }
    function connect(c) {
      clients.add(c);
      const m = member(c.memberId);
      if (m && alertOf(m).state === 'ringing') c.send('alert', { reason: m.alert.reason, at: m.alert.at });
      broadcast('change', {}, (x) => x.kind === 'admin');
      return () => { clients.delete(c); broadcast('change', {}, (x) => x.kind === 'admin'); };
    }

    // ---------- עיבוד משחקים ----------
    function matchLabel(m) {
      // מ׳ = מוקדמות, פ׳ = פלייאוף, ג׳ = גמר
      if (m.tournamentLevel === 'Quals') return `מ׳${m.id}`;
      if (m.tournamentLevel === 'DoubleElim' || m.tournamentLevel === 'Playoffs') return `פ׳${m.series || m.id}`;
      if (m.tournamentLevel === 'Finals') return `ג׳${m.series || m.id}`;
      return String(m.id);
    }

    function demoCut(sorted) {
      // מתחילים באמצע האירוע: שני משחקים שלנו כבר שוחקו, והשלישי עוד ארבעה משחקים
      const team = Number(state.settings.team);
      const oursIdx = sorted.map((m, i) => ((m.teams || []).some((t) => t.teamNumber === team) ? i : -1)).filter((i) => i >= 0);
      const third = oursIdx[2] ?? oursIdx[oursIdx.length - 1] ?? 4;
      const start = Math.max(0, third - 4);
      const step = Math.floor((now() - (state.demoStartedAt || now())) / DEMO_STEP_MS);
      return Math.min(sorted.length, start + step);
    }

    function buildView() {
      const team = Number(state.settings.team);
      // משחק בלי שעה (למשל פלייאוף שעוד לא נקבע) נכנס בסוף
      const LEVEL = { Quals: 0, Playoffs: 1, DoubleElim: 1, Finals: 2 };
      const sorted = [...schedule.matches].sort((a, b) => {
        const ta = a.scheduledStartTime || '\uffff', tb = b.scheduledStartTime || '\uffff';
        if (ta !== tb) return ta.localeCompare(tb);
        return (LEVEL[a.tournamentLevel] ?? 3) - (LEVEL[b.tournamentLevel] ?? 3) || (a.series || 0) - (b.series || 0) || a.id - b.id;
      });
      const cut = state.settings.demo ? demoCut(sorted) : Infinity;
      const played = (m, i) => (state.settings.demo ? i < cut : m.hasBeenPlayed);

      let firstUnplayed = sorted.findIndex((m, i) => !played(m, i));
      if (firstUnplayed === -1) firstUnplayed = sorted.length;

      const ours = [];
      sorted.forEach((m, i) => {
        const me = (m.teams || []).find((t) => t.teamNumber === team);
        if (!me) return;
        const color = me.alliance === 'Red' ? 'red' : 'blue';
        const other = color === 'red' ? 'blue' : 'red';
        const isPlayed = played(m, i);
        let our = null, their = null, result = null;
        if (isPlayed && m.scores && m.scores[color] && m.scores[other]) {
          our = m.scores[color].totalPoints;
          their = m.scores[other].totalPoints;
          result = our > their ? 'W' : our < their ? 'L' : 'T';
        }
        ours.push({
          key: `${m.tournamentLevel}-${m.series}-${m.id}`,
          label: matchLabel(m),
          level: m.tournamentLevel,
          color, station: STATION[me.station] || null,
          partners: m.teams.filter((t) => t.alliance === me.alliance && t.teamNumber !== team).map((t) => t.teamNumber),
          opponents: m.teams.filter((t) => t.alliance !== me.alliance).map((t) => t.teamNumber),
          time: m.scheduledStartTime,
          played: isPlayed, our, their, result,
          away: isPlayed ? null : Math.max(0, i - firstUnplayed),
        });
      });

      const next = ours.find((m) => !m.played) || null;
      const ev = schedule.event;
      return {
        team,
        season: schedule.season,
        demo: !!state.settings.demo,
        event: ev && { code: ev.code, name: ev.name, start: ev.start, end: ev.end, venue: ev.venue, city: ev.city, fields: ev.fieldCount },
        error: schedule.error,
        updatedAt: schedule.updatedAt,
        totalMatches: sorted.length,
        playedMatches: Math.min(firstUnplayed, sorted.length),
        ours, next,
        playingNow: !!(next && next.away === 0),
      };
    }

    // ---------- רשימת בדיקה: מתאפסת כשהמשחק הבא מתחלף ----------
    function checklistView(view) {
      const key = (view.next && view.next.key) || 'none';
      if (state.checklistDone.matchKey !== key) {
        state.checklistDone = { matchKey: key, done: [] };
        save();
      }
      return state.settings.checklist.map((text, i) => ({ text, done: state.checklistDone.done.includes(i) }));
    }

    // ---------- הרשאות ----------
    function auth({ local, key, token, ip }) {
      const who = auth2({ local, key, token });
      who.ip = ip || '';
      return who;
    }
    function auth2({ local, key, token }) {
      // טלפון שנפתח על המחשב בפיט עצמו נשאר טלפון: האסימון קודם
      if (token) {
        const m = Object.values(state.members).find((x) => (x.tokens || []).includes(token));
        if (m) { m.lastSeen = now(); return { member: m }; }
        return {}; // אסימון שכבר לא בתוקף: מתחברים מחדש, גם אם זה המחשב בפיט
      }
      if (local || (key && key === state.settings.adminKey)) return { admin: true };
      return {};
    }

    // ---------- מצב לכל סוג משתמש ----------
    function memberList() {
      return Object.values(state.members).map((m) => ({
        id: m.id, name: m.name, online: online(m.id), lastSeen: m.lastSeen,
        alert: alertOf(m),
      }));
    }

    function adminState() {
      const view = buildView();
      return {
        ...view,
        checklist: checklistView(view),
        settings: { ...state.settings, adminKey: undefined },
        adminKey: state.settings.adminKey,
        eventLabel: state.settings.eventLabel || '',
        members: memberList(),
        messages: state.messages.slice(-200),
        batteries: state.batteries,
        repairs: state.repairs,
        addresses: addresses(),
      };
    }

    function memberState(m) {
      const view = buildView();
      return {
        ...view,
        checklist: checklistView(view),
        me: { id: m.id, name: m.name, alert: alertOf(m) },
        queueWarnAt: state.settings.queueWarnAt,
        eventLabel: state.settings.eventLabel || '',
        messages: state.messages.filter((x) => x.to === 'all' || x.to === m.id || x.from === m.id).slice(-100),
        batteries: state.batteries,
        repairs: state.repairs,
      };
    }

    const clean = (s, n = 500) => (typeof s === 'string' || typeof s === 'number' ? String(s) : '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
    const ok = (body = { ok: true }) => ({ code: 200, body });
    const no = (code, error) => ({ code, body: error ? { error } : {} });
    function changed() { save(); broadcast('change'); }

    // ---------- בקשות ----------
    // כל נתיב מקבל (הרשאה, גוף הבקשה) ומחזיר {code, body}. אחרי הצלחה – after() אם יש.
    const routes = {
      'POST /api/join': (a, body) => {
        const name = clean(body.name, 30);
        if (!name) return no(400, 'צריך לכתוב שם');
        // הגנה מניחוש: אחרי יותר מדי ניסיונות שגויים בדקה, מחכים
        // לכל כתובת בנפרד, כדי שמישהו אחד לא יחסום את כולם. ותקרה כללית גבוהה יותר.
        const t = now(), ip = a.ip || '';
        joinFails = joinFails.filter((x) => t - x.at < 60_000);
        const mine = joinFails.filter((x) => x.ip === ip).length;
        if (mine >= JOIN_FAILS_PER_MIN || joinFails.length >= JOIN_FAILS_PER_MIN * 6) return no(429, 'יותר מדי ניסיונות. מחכים דקה ומנסים שוב.');
        if (state.settings.joinCode && String(body.code || '').trim() !== state.settings.joinCode) {
          joinFails.push({ at: t, ip });
          return no(403, 'קוד ההצטרפות שגוי');
        }
        if (Object.keys(state.members).length >= 60 && !Object.values(state.members).some((x) => x.name === name)) {
          return no(403, 'יש כבר יותר מדי חברי צוות מחוברים');
        }
        // אותו שם = אותו חבר צוות (טלפון נוסף או טלפון חדש). הטלפון הקודם נשאר מחובר.
        let m = Object.values(state.members).find((x) => x.name === name);
        if (!m) {
          m = { id: rid(4), name, joinedAt: t, alert: { state: 'none' }, tokens: [] };
          state.members[m.id] = m;
        }
        const token = rid(16);
        m.tokens = [...m.tokens, token].slice(-MAX_TOKENS);
        m.lastSeen = t;
        changed();
        return ok({ token, id: m.id, team: state.settings.team });
      },

      'GET /api/state': (a) => {
        if (a.admin) return ok(adminState());
        if (a.member) return ok(memberState(a.member));
        return no(401, 'לא מחובר');
      },

      'POST /api/alert': (a, body) => {
        if (!a.admin) return no(403);
        const ids = body.id === 'all' ? Object.keys(state.members) : [body.id];
        const reason = clean(body.reason, 80);
        for (const id of ids) {
          const m = member(id);
          if (!m) continue;
          m.alert = { state: 'ringing', at: now(), reason };
          broadcast('alert', { reason, at: m.alert.at }, (c) => c.memberId === id);
        }
        // כשעוברות שתי דקות בלי תשובה, כולם רואים "אין תשובה" מיד
        clearTimeout(missedTimer);
        missedTimer = setTimeout(() => broadcast('change'), RING_MS + 500);
        changed();
        return ok();
      },

      'POST /api/alert/cancel': (a, body) => {
        if (!a.admin) return no(403);
        const m = member(body.id);
        if (m) { m.alert = { state: 'none' }; broadcast('alert-stop', {}, (c) => c.memberId === m.id); }
        changed();
        return ok();
      },

      'POST /api/ack': (a) => {
        if (!a.member) return no(403);
        const cur = alertOf(a.member).state;
        if (cur !== 'ringing' && cur !== 'missed' && cur !== 'ack') return ok(); // אין קריאה פתוחה
        // לכל הטלפונים של אותו חבר צוות: להפסיק לצלצל
        broadcast('alert-stop', {}, (c) => c.memberId === a.member.id);
        if (cur !== 'ack') {
          a.member.alert = { ...(a.member.alert || {}), state: 'ack', ackAt: now() };
          broadcast('ack', { name: a.member.name }, (c) => c.kind === 'admin');
        }
        changed();
        return ok();
      },

      'POST /api/message': (a, body) => {
        const text = clean(body.text, 500);
        if (!text) return no(400);
        let msg;
        if (a.admin) {
          const to = body.to === 'all' || member(body.to) ? body.to : 'all';
          msg = { id: rid(5), from: 'pit', to, text, at: now(), readBy: [] };
        } else if (a.member) {
          msg = { id: rid(5), from: a.member.id, fromName: a.member.name, to: 'pit', text, at: now(), readBy: [] };
        } else return no(403);
        state.messages.push(msg);
        if (state.messages.length > 500) state.messages.splice(0, state.messages.length - 500);
        broadcast('message', { from: msg.from === 'pit' ? 'הפיט' : msg.fromName, to: msg.to, text: msg.text }, (c) =>
          msg.to === 'all' ? c.kind === 'member' : c.memberId === msg.to || (msg.to === 'pit' && c.kind === 'admin'));
        changed();
        return ok();
      },

      'POST /api/read': (a, body) => {
        const who = a.admin ? 'pit' : a.member && a.member.id;
        if (!who) return no(403);
        let dirty = false;
        const ids = Array.isArray(body.ids) ? body.ids : [];
        for (const m of state.messages) {
          if (!ids.includes(m.id) || m.readBy.includes(who)) continue;
          // טלפון מסמן רק הודעות שהוא רואה
          if (!a.admin && !(m.to === 'all' || m.to === who)) continue;
          m.readBy.push(who); dirty = true;
        }
        if (dirty) changed();
        return ok();
      },

      'POST /api/check': (a, body) => {
        if (!a.admin && !a.member) return no(403);
        if (body.reset) { if (!a.admin) return no(403); state.checklistDone.done = []; changed(); return ok(); }
        const i = Number(body.index);
        if (!Number.isInteger(i) || i < 0 || i >= state.settings.checklist.length) return no(400);
        const done = new Set(state.checklistDone.done);
        if (body.done) done.add(i); else done.delete(i);
        state.checklistDone.done = [...done];
        changed();
        return ok();
      },

      'POST /api/battery': (a, body) => {
        if (!a.admin && !a.member) return no(403);
        if (body.action === 'add') {
          if (state.batteries.length >= 30) return no(400, 'יותר מדי סוללות');
          const name = clean(body.name, 20) || `סוללה ${state.batteries.length + 1}`;
          state.batteries.push({ id: rid(4), name, status: 'charging', voltage: null, uses: 0, updatedAt: now() });
        } else {
          const b = state.batteries.find((x) => x.id === body.id);
          if (!b) return no(404);
          if (body.action === 'delete') { if (!a.admin) return no(403); state.batteries = state.batteries.filter((x) => x !== b); }
          if (body.action === 'status' && BATTERY.includes(body.status) && body.status !== b.status) {
            if (body.status === 'robot') {
              // רק סוללה אחת ברובוט בכל רגע
              for (const o of state.batteries) if (o.status === 'robot' && o !== b) o.status = 'used';
              b.uses += 1;
            }
            b.status = body.status;
          }
          if (body.action === 'voltage') {
            const raw = String(body.voltage ?? '').trim();
            const m = raw.replace(',', '.').match(/^(\d{1,2}(?:\.\d+)?)\s*(v|וולט)?$/i);
            const v = m ? Number(m[1]) : NaN;
            if (raw === '') b.voltage = null; // שדה ריק = מוחקים את המדידה
            else if (v > 0 && v < 20) b.voltage = Math.round(v * 100) / 100;
            else return no(400, 'זה לא נראה כמו מתח של סוללה. כותבים למשל 13.2');
          }
          b.updatedAt = now();
        }
        changed();
        return ok();
      },

      'POST /api/repair': (a, body) => {
        if (!a.admin && !a.member) return no(403);
        const by = a.admin ? 'הפיט' : a.member.name;
        if (body.action === 'add') {
          const text = clean(body.text, 200);
          if (!text) return no(400);
          state.repairs.unshift({ id: rid(4), text, by, at: now(), done: false });
          if (state.repairs.length > 100) state.repairs.length = 100;
        } else {
          const r = state.repairs.find((x) => x.id === body.id);
          if (!r) return no(404);
          if (body.action === 'toggle') { r.done = !r.done; r.doneAt = r.done ? now() : null; r.doneBy = by; }
          if (body.action === 'delete') { if (!a.admin) return no(403); state.repairs = state.repairs.filter((x) => x !== r); }
        }
        changed();
        return ok();
      },

      'POST /api/settings': (a, body) => {
        if (!a.admin) return no(403);
        const s = state.settings;
        if (body.team !== undefined) { const t = parseInt(body.team, 10); if (t > 0 && t < 100000) s.team = t; }
        if (body.season !== undefined) { const y = parseInt(body.season, 10); s.season = y > 2018 && y < 2100 ? y : null; }
        if (body.eventCode !== undefined) s.eventCode = clean(body.eventCode, 20).replace(/[^A-Za-z0-9]/g, '');
        if (body.eventLabel !== undefined) s.eventLabel = clean(body.eventLabel, 60);
        if (body.joinCode !== undefined) s.joinCode = clean(body.joinCode, 12);
        if (body.newJoinCode) s.joinCode = code6();
        if (body.queueWarnAt !== undefined && String(body.queueWarnAt).trim() !== '') {
          const q = parseInt(body.queueWarnAt, 10);
          if (Number.isFinite(q)) s.queueWarnAt = Math.max(0, Math.min(10, q));
        }
        if (Array.isArray(body.checklist)) {
          const list = body.checklist.map((x) => clean(x, 120)).filter(Boolean).slice(0, 30);
          // רשימה שהשתנתה מתחילה בלי סימונים, כדי שסימון ישן לא ייפול על פריט אחר
          if (JSON.stringify(list) !== JSON.stringify(s.checklist)) state.checklistDone.done = [];
          s.checklist = list;
        }
        if (body.demo !== undefined && !!body.demo !== !!s.demo) { s.demo = !!body.demo; state.demoStartedAt = now(); }
        if (member(body.removeMember)) {
          broadcast('kicked', {}, (c) => c.memberId === body.removeMember);
          dropStreams(body.removeMember);
          delete state.members[body.removeMember];
        }
        if (body.clearMessages) state.messages = [];
        changed();
        return { code: 200, body: { ok: true }, refresh: true };
      },

      'POST /api/refresh': (a) => {
        if (!a.admin) return no(403);
        return { code: 200, body: { ok: true }, refresh: true };
      },
    };

    function handle(method, path, a, body) {
      const r = routes[`${method} ${path}`];
      if (!r) return null;
      return r(a, body || {});
    }

    return { state, schedule, setSchedule, handle, auth, connect, broadcast, buildView, online };
  }

  return { createCore, defaultState };
});
