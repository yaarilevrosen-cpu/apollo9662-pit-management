// בדיקות ללוגיקה של השרת (lib/core.js), בלי רשת ובלי דפדפן.
// הרצה מתיקיית המאגר:  node tools/test-core.js
// הנתונים בדויים: מספרי קבוצה מ־90001 ומעלה.
'use strict';
const assert = require('assert/strict');
const { createCore } = require('../lib/core');

let n = 0;
const rid = (k = 8) => `id${++n}`.padEnd(k, 'x');
let clock = 1_000_000;
const now = () => clock;

function makeCore(extra = {}) {
  const core = createCore({ rid, code6: () => '111222', now, ...extra });
  const matches = [];
  for (let id = 1; id <= 10; id++) {
    const t = [90001, 90002, 90003, 90004];
    if ([2, 5, 9].includes(id)) t[id === 5 ? 2 : 0] = 9662;
    matches.push({
      id, series: 0, tournamentLevel: 'Quals', scheduledStartTime: `2026-01-01T10:${String(id).padStart(2, '0')}:00Z`,
      teams: t.map((x, i) => ({ teamNumber: x, alliance: i < 2 ? 'Red' : 'Blue', station: i % 2 ? 'Two' : 'One' })),
      hasBeenPlayed: id <= 2, scores: id <= 2 ? { red: { totalPoints: 100 }, blue: { totalPoints: 80 } } : null,
    });
  }
  core.setSchedule({ event: { code: 'T', name: 'בדיקה' }, matches, season: 2026, updatedAt: clock });
  return { core, matches };
}

const ADMIN = { admin: true };
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

function join(core, name, code = '111222') {
  const r = core.handle('POST', '/api/join', {}, { name, code });
  assert.equal(r.code, 200, `join ${name}`);
  return { ...core.auth({ token: r.body.token }), token: r.body.token };
}
function listen(core, a) {
  const got = [];
  const bye = core.connect({ kind: a.admin ? 'admin' : 'member', memberId: a.member && a.member.id, send: (e, d) => got.push([e, d]) });
  return { got, bye };
}

test('לוח המשחקים: המשחק הבא, ברית ומרחק', () => {
  const { core } = makeCore();
  const v = core.buildView();
  assert.equal(v.ours.length, 3);
  assert.equal(v.ours[0].result, 'W');
  assert.equal(v.next.label, 'מ׳5');
  assert.equal(v.next.color, 'blue');
  assert.equal(v.next.away, 2); // משחקים 3 ו־4 לפנינו
});

test('הצטרפות: קוד שגוי נדחה, אותו שם מטלפון נוסף לא מנתק את הראשון', () => {
  const { core } = makeCore();
  assert.equal(core.handle('POST', '/api/join', {}, { name: 'נועה', code: '000000' }).code, 403);
  assert.equal(core.handle('POST', '/api/join', {}, { name: '', code: '111222' }).code, 400);
  const r1 = core.handle('POST', '/api/join', {}, { name: 'נועה', code: '111222' });
  const r2 = core.handle('POST', '/api/join', {}, { name: 'נועה', code: '111222' });
  assert.equal(r1.body.id, r2.body.id);
  assert.ok(core.auth({ token: r1.body.token }).member, 'הטלפון הראשון עדיין מחובר');
  assert.ok(core.auth({ token: r2.body.token }).member);
  assert.equal(Object.keys(core.state.members).length, 1);
});

test('הצטרפות: ניחוש קוד נחסם אחרי עשרה ניסיונות בדקה', () => {
  const { core } = makeCore();
  const bad = { ip: '10.0.0.66' }, good = { ip: '10.0.0.7' };
  for (let i = 0; i < 10; i++) assert.equal(core.handle('POST', '/api/join', bad, { name: 'x', code: String(i) }).code, 403);
  assert.equal(core.handle('POST', '/api/join', bad, { name: 'x', code: '111222' }).code, 429);
  assert.equal(core.handle('POST', '/api/join', good, { name: 'y', code: '111222' }).code, 200, 'טלפון אחר לא נחסם');
  clock += 61_000;
  assert.equal(core.handle('POST', '/api/join', bad, { name: 'x', code: '111222' }).code, 200);
});

test('קריאה שלא נענתה תוך שתי דקות מסומנת "לא ענה", ועדיין אפשר לענות', () => {
  const { core } = makeCore();
  const a = join(core, 'נועה');
  core.handle('POST', '/api/alert', ADMIN, { id: a.member.id });
  clock += 121_000;
  assert.equal(core.handle('GET', '/api/state', ADMIN).body.members[0].alert.state, 'missed');
  core.handle('POST', '/api/ack', a, {});
  assert.equal(core.handle('GET', '/api/state', ADMIN).body.members[0].alert.state, 'ack');
});

test('טלפון לא יכול למחוק סוללות ותיקונים או לאפס את הרשימה', () => {
  const { core } = makeCore();
  const m = join(core, 'עומר');
  core.handle('POST', '/api/battery', ADMIN, { action: 'add', name: 'א' });
  core.handle('POST', '/api/repair', m, { action: 'add', text: 'גלגל' });
  assert.equal(core.handle('POST', '/api/battery', m, { action: 'delete', id: core.state.batteries[0].id }).code, 403);
  assert.equal(core.handle('POST', '/api/repair', m, { action: 'delete', id: core.state.repairs[0].id }).code, 403);
  assert.equal(core.handle('POST', '/api/check', m, { reset: true }).code, 403);
  assert.equal(core.handle('POST', '/api/repair', m, { action: 'toggle', id: core.state.repairs[0].id }).code, 200);
});

test('מזהה חשוד לא נוגע באובייקטים של השרת', () => {
  const { core } = makeCore();
  core.handle('POST', '/api/alert', ADMIN, { id: '__proto__' });
  core.handle('POST', '/api/settings', ADMIN, { removeMember: 'constructor' });
  assert.equal(({}).alert, undefined);
});

test('הרשאות: טלפון לא יכול לקרוא לאחרים או לשנות הגדרות', () => {
  const { core } = makeCore();
  const m = join(core, 'עומר');
  for (const [p, body] of [['/api/alert', { id: 'all' }], ['/api/settings', { team: 90099 }], ['/api/alert/cancel', {}], ['/api/refresh', {}]]) {
    assert.equal(core.handle('POST', p, m, body).code, 403, p);
  }
  assert.equal(core.handle('GET', '/api/state', {}, {}).code, 401);
  assert.equal(core.handle('GET', '/api/state', m, {}).body.adminKey, undefined);
});

test('הרשאות: אסימון של טלפון קודם למחשב המקומי', () => {
  const { core } = makeCore();
  const m = join(core, 'תמר');
  const a = core.auth({ local: true, token: m.token });
  assert.ok(a.member && !a.admin);
  assert.ok(core.auth({ local: true }).admin);
  assert.ok(core.auth({ key: core.state.settings.adminKey }).admin);
  const stale = core.auth({ local: true, token: 'stale' });
  assert.ok(!stale.admin && !stale.member, 'אסימון ישן מהמחשב המקומי לא נהיה מנהל');
  assert.ok(!core.auth({ key: 'wrong' }).admin);
});

test('קריאה מגיעה רק לטלפון הנכון, ו"קיבלתי" מגיע לפיט', () => {
  const { core } = makeCore();
  const a = join(core, 'נועה'), b = join(core, 'עומר');
  const la = listen(core, a), lb = listen(core, b), lp = listen(core, ADMIN);
  core.handle('POST', '/api/alert', ADMIN, { id: a.member.id, reason: 'להביא סוללה' });
  assert.ok(la.got.some(([e, d]) => e === 'alert' && d.reason === 'להביא סוללה'));
  assert.ok(!lb.got.some(([e]) => e === 'alert'));
  core.handle('POST', '/api/ack', core.auth({ token: a.token }), {});
  assert.ok(lp.got.some(([e, d]) => e === 'ack' && d.name === 'נועה'));
  assert.equal(core.state.members[a.member.id].alert.state, 'ack');
});

test('טלפון שמתחבר בזמן קריאה מתחיל לצלצל מיד', () => {
  const { core } = makeCore();
  const a = join(core, 'נועה');
  core.handle('POST', '/api/alert', ADMIN, { id: 'all' });
  const la = listen(core, a);
  assert.ok(la.got.some(([e]) => e === 'alert'));
});

test('מחובר ומנותק נראים בפיט', () => {
  const { core } = makeCore();
  const a = join(core, 'נועה');
  const l = listen(core, a);
  assert.equal(core.handle('GET', '/api/state', ADMIN).body.members[0].online, true);
  l.bye();
  assert.equal(core.handle('GET', '/api/state', ADMIN).body.members[0].online, false);
});

test('רשימת הבדיקה מתאפסת כשהמשחק הבא מתחלף', () => {
  const { core, matches } = makeCore();
  core.handle('GET', '/api/state', ADMIN);
  core.handle('POST', '/api/check', ADMIN, { index: 0, done: true });
  assert.equal(core.handle('GET', '/api/state', ADMIN).body.checklist[0].done, true);
  matches.slice(2, 5).forEach((m) => { m.hasBeenPlayed = true; m.scores = { red: { totalPoints: 1 }, blue: { totalPoints: 1 } }; });
  core.setSchedule({ matches });
  const s = core.handle('GET', '/api/state', ADMIN).body;
  assert.equal(s.next.label, 'מ׳9');
  assert.equal(s.checklist[0].done, false);
  assert.equal(s.ours[1].result, 'T');
  assert.equal(core.handle('POST', '/api/check', ADMIN, { index: 99, done: true }).code, 400);
});

test('סוללות: רק אחת ברובוט, ספירת שימושים, מתח עם פסיק', () => {
  const { core } = makeCore();
  core.handle('POST', '/api/battery', ADMIN, { action: 'add', name: 'א' });
  core.handle('POST', '/api/battery', ADMIN, { action: 'add', name: 'ב' });
  const [x, y] = core.state.batteries;
  core.handle('POST', '/api/battery', ADMIN, { action: 'status', id: x.id, status: 'robot' });
  core.handle('POST', '/api/battery', ADMIN, { action: 'status', id: x.id, status: 'robot' }); // אותו מצב: לא נספר פעמיים
  core.handle('POST', '/api/battery', ADMIN, { action: 'status', id: y.id, status: 'robot' });
  assert.equal(x.status, 'used');
  assert.equal(x.uses, 1);
  assert.equal(y.status, 'robot');
  core.handle('POST', '/api/battery', ADMIN, { action: 'voltage', id: y.id, voltage: '12,85' });
  assert.equal(y.voltage, 12.85);
  assert.equal(core.handle('POST', '/api/battery', ADMIN, { action: 'voltage', id: y.id, voltage: 'abc' }).code, 400);
  assert.equal(y.voltage, 12.85, 'קלט לא תקין לא מוחק את המדידה');
  core.handle('POST', '/api/battery', ADMIN, { action: 'voltage', id: y.id, voltage: '12.8V' });
  assert.equal(y.voltage, 12.8);
  assert.equal(core.handle('POST', '/api/battery', ADMIN, { action: 'voltage', id: y.id, voltage: '-5' }).code, 400);
  core.handle('POST', '/api/battery', ADMIN, { action: 'voltage', id: y.id, voltage: '' });
  assert.equal(y.voltage, null);
  assert.equal(core.handle('POST', '/api/battery', ADMIN, { action: 'status', id: 'nope', status: 'ready' }).code, 404);
});

test('הודעות: לכולם, לאחד, מהטלפון לפיט, וסימון "נקראה"', () => {
  const { core } = makeCore();
  const a = join(core, 'נועה'), b = join(core, 'עומר');
  core.handle('POST', '/api/message', ADMIN, { to: 'all', text: 'שלום לכולם' });
  core.handle('POST', '/api/message', ADMIN, { to: a.member.id, text: 'רק לנועה' });
  core.handle('POST', '/api/message', b, { text: 'בדרך!' });
  const sb = core.handle('GET', '/api/state', core.auth({ token: b.token })).body;
  assert.deepEqual(sb.messages.map((m) => m.text), ['שלום לכולם', 'בדרך!']);
  const fromB = core.state.messages.find((m) => m.text === 'בדרך!');
  assert.equal(fromB.to, 'pit');
  core.handle('POST', '/api/read', ADMIN, { ids: [fromB.id] });
  assert.deepEqual(fromB.readBy, ['pit']);
  assert.equal(core.handle('POST', '/api/message', ADMIN, { text: '   ' }).code, 400);
});

test('ניתוק טלפון מההגדרות שולח לו הודעת ניתוק', () => {
  const { core } = makeCore();
  const a = join(core, 'נועה');
  const l = listen(core, a);
  let closed = false;
  core.connect({ kind: 'member', memberId: a.member.id, send() {}, close() { closed = true; } });
  core.handle('POST', '/api/settings', ADMIN, { removeMember: a.member.id });
  assert.ok(l.got.some(([e]) => e === 'kicked'));
  assert.ok(closed, 'החיבור החי של הטלפון נסגר');
  assert.equal(core.auth({ token: a.token }).member, undefined);
});

test('מצב הדגמה מתקדם עם הזמן', () => {
  const { core } = makeCore();
  core.handle('POST', '/api/settings', ADMIN, { demo: true });
  const before = core.buildView().playedMatches;
  clock += 3 * 75_000;
  assert.equal(core.buildView().playedMatches, before + 3);
});

test('בלי אירוע ובלי משחקים: אין קריסה', () => {
  const core = createCore({ rid, code6: () => '111222', now });
  const s = core.handle('GET', '/api/state', ADMIN).body;
  assert.equal(s.event, null);
  assert.equal(s.next, null);
  assert.deepEqual(s.ours, []);
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`  עבר   ${name}`); } catch (e) { failed++; console.log(`  נכשל  ${name}\n         ${e.message}`); }
}
console.log(failed ? `\n${failed} מתוך ${tests.length} בדיקות נכשלו` : `\nכל ${tests.length} הבדיקות עברו`);
process.exit(failed ? 1 : 0);
