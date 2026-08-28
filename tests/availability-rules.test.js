import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, wouldExceed, isCritical, sessionsInPeriod, CAP_CRITICAL_DAYS }
  from '../sched/js/availability-rules.js';

/* A real fortnight: nine sessions a week across seven days, two of which
   (Saturday, Sunday) run twice. Fourteen calendar days, eighteen sessions. */
function fortnight(startMonday = '2026-08-17') {
  const [y, m, d] = startMonday.split('-').map(Number);
  const out = [];
  for (let i = 0; i < 14; i++) {
    const dt = new Date(Date.UTC(y, m - 1, d + i));
    const iso = dt.toISOString().slice(0, 10);
    const dow = dt.getUTCDay();
    if (dow === 0 || dow === 6) out.push({ date: iso, part: 'AM' }, { date: iso, part: 'PM' });
    else out.push({ date: iso, part: 'PM' });
  }
  return out;
}

test('a fortnight is 18 sessions across 14 days', () => {
  const s = fortnight();
  assert.equal(s.length, 18);
  assert.equal(new Set(s.map(x => x.date)).size, 14);
});

test('everything starts available — an untouched form declines nothing', () => {
  const s = fortnight();
  const r = evaluate(s, []);
  assert.equal(r.sessionsAvailable, 18);
  assert.equal(r.sessionsOff, 0);
  assert.equal(r.daysOffCount, 0);
});

test('a floor runner may turn off as many days as they like', () => {
  const s = fortnight();
  const off = s.filter(x => x.date <= '2026-08-25');       // most of the period
  const r = evaluate(s, off, { critical: false });
  assert.equal(r.needsApproval, false);
  assert.equal(r.cap, null);
  assert.equal(r.daysLeft, null);
});

test('critical staff get two days and are told how many remain', () => {
  const s = fortnight();
  const r0 = evaluate(s, [], { critical: true });
  assert.equal(r0.daysLeft, 2);
  assert.match(r0.message, /2 still available/);

  const r1 = evaluate(s, [{ date: '2026-08-19', part: 'PM' }], { critical: true });
  assert.equal(r1.daysLeft, 1);
  assert.equal(r1.needsApproval, false);
});

test('turning off one half of a weekend costs one day, not two', () => {
  const s = fortnight();
  // Saturday 2026-08-22 runs AM and PM. Decline only the evening.
  const r = evaluate(s, [{ date: '2026-08-22', part: 'PM' }], { critical: true });
  assert.equal(r.daysOffCount, 1);
  assert.equal(r.daysLeft, 1);
  assert.equal(r.sessionsOff, 1);
  assert.equal(r.sessionsAvailable, 17, 'the Saturday afternoon must stay available');
});

test('declining both halves of one day still costs only that one day', () => {
  const s = fortnight();
  const r = evaluate(s, [{ date: '2026-08-22', part: 'AM' }, { date: '2026-08-22', part: 'PM' }],
                     { critical: true });
  assert.equal(r.daysOffCount, 1);
  assert.equal(r.sessionsOff, 2);
  assert.equal(r.daysLeft, 1);
});

test('a third day is accepted but flagged for the manager, never refused', () => {
  const s = fortnight();
  const off = [{ date: '2026-08-18', part: 'PM' },
               { date: '2026-08-19', part: 'PM' },
               { date: '2026-08-20', part: 'PM' }];
  const r = evaluate(s, off, { critical: true });
  assert.equal(r.daysOffCount, 3);
  assert.equal(r.overBy, 1);
  assert.equal(r.needsApproval, true);
  assert.equal(r.daysLeft, 0);
  // The answer is preserved. Someone with jury duty on a third day still has it,
  // and a form that swallows the answer produces a no-show instead of a decline.
  assert.equal(r.sessionsOff, 3, 'the third day must still be recorded as unavailable');
  assert.match(r.message, /manager/);
});

test('days outside the period are ignored rather than counted', () => {
  const s = fortnight();
  const r = evaluate(s, [{ date: '2026-09-30', part: 'PM' }], { critical: true });
  assert.equal(r.daysOffCount, 0, 'a date with no session cannot be declined');
  assert.equal(r.daysLeft, 2);
});

test('wouldExceed warns before the third day, not the second', () => {
  const s = fortnight();
  const one = [{ date: '2026-08-18', part: 'PM' }];
  const two = [...one, { date: '2026-08-19', part: 'PM' }];
  assert.equal(wouldExceed(s, one, '2026-08-20', { critical: true }), false);
  assert.equal(wouldExceed(s, two, '2026-08-20', { critical: true }), true);
  // Adding a second session on a day already off is free — the day is spent.
  assert.equal(wouldExceed(s, two, '2026-08-19', { critical: true }), false);
  // Floor runners are never warned.
  assert.equal(wouldExceed(s, two, '2026-08-20', { critical: false }), false);
});

test('critical means qualified for something beyond the universal role', () => {
  const U = 'flash-runners';
  const caps = [
    { staff_id: 'runner', role_id: U, can_do: true, is_deputy: false },
    { staff_id: 'caller', role_id: 'callers', can_do: true, is_deputy: false },
    { staff_id: 'deputy', role_id: 'mod', can_do: false, is_deputy: true },
    { staff_id: 'lapsed', role_id: 'mod', can_do: false, is_deputy: false },
  ];
  assert.equal(isCritical('runner', caps, U), false, 'everyone runs flash; that is not critical');
  assert.equal(isCritical('caller', caps, U), true);
  assert.equal(isCritical('deputy', caps, U), true, 'a named deputy can be called on');
  assert.equal(isCritical('lapsed', caps, U), false, 'a revoked qualification does not count');
  assert.equal(isCritical('nobody', caps, U), false);
});

test('sessionsInPeriod takes only what falls inside the window, in order', () => {
  const all = [
    { id: '1', session_date: '2026-08-16', part: 'PM', hall_id: 'sc' },
    { id: '2', session_date: '2026-08-17', part: 'PM', hall_id: 'sc' },
    { id: '3', session_date: '2026-08-22', part: 'PM', hall_id: 'sc' },
    { id: '4', session_date: '2026-08-22', part: 'AM', hall_id: 'sc' },
    { id: '5', session_date: '2026-08-31', part: 'PM', hall_id: 'sc' },
  ];
  const got = sessionsInPeriod(all, '2026-08-17', '2026-08-30');
  assert.deepEqual(got.map(s => s.id), ['2', '4', '3']);
});

test('the cap is a named constant, not a number sprinkled through the code', () => {
  assert.equal(CAP_CRITICAL_DAYS, 2);
  const s = fortnight();
  const r = evaluate(s, [{ date: '2026-08-18', part: 'PM' }], { critical: true, cap: 4 });
  assert.equal(r.daysLeft, 3, 'the cap must be overridable per request');
});
