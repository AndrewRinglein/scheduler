import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyWorkweek, workweekStart, consecutiveDaysIfAdded,
         violatesSeventhDay, shiftHours } from '../sched/js/ca-overtime.js';

const d = (date, hours, worked) => ({ date, hours, ...(worked===false?{worked:false}:{}) });
/* Frontier's workweek starts on MONDAY (confirmed Aug 2026). 2026-08-03 is a
   Monday, so this week runs Mon 3rd to Sun 9th. The boundary is not cosmetic:
   under the old Sunday assumption the 9th opened a new week, and now it closes
   this one. */
const W = ['2026-08-03','2026-08-04','2026-08-05','2026-08-06','2026-08-07','2026-08-08','2026-08-09'];

test('workweek boundary is fixed, not rolling, and starts on Monday', () => {
  assert.equal(workweekStart('2026-08-03'), '2026-08-03'); // Monday
  assert.equal(workweekStart('2026-08-09'), '2026-08-03'); // Sunday, same week
  assert.equal(workweekStart('2026-08-10'), '2026-08-10'); // next Monday
  // The weekend belongs to the week that began before it, not after.
  assert.equal(workweekStart('2026-08-08'), '2026-08-03'); // Saturday
  assert.equal(workweekStart('2026-08-02'), '2026-07-27'); // the Sunday before
});

test('mixing workweeks throws rather than silently mis-calculating', () => {
  // Sunday the 9th and Monday the 10th are different weeks under a Monday start.
  assert.throws(() => classifyWorkweek([d('2026-08-09',8), d('2026-08-10',8)]),
    /different workweeks/);
});

test('daily: over 8 up to 12 is time-and-a-half', () => {
  const r = classifyWorkweek([d(W[0], 10)]);
  assert.deepEqual(r.totals, { regular: 8, ot1_5: 2, ot2_0: 0 });
});

test('daily: over 12 is double time', () => {
  const r = classifyWorkweek([d(W[0], 14)]);
  assert.deepEqual(r.totals, { regular: 8, ot1_5: 4, ot2_0: 2 });
});

test('exactly 8 and exactly 12 are boundaries, not overtime', () => {
  assert.deepEqual(classifyWorkweek([d(W[0], 8)]).totals,  { regular: 8, ot1_5: 0, ot2_0: 0 });
  assert.deepEqual(classifyWorkweek([d(W[0], 12)]).totals, { regular: 8, ot1_5: 4, ot2_0: 0 });
});

test('weekly: straight-time hours over 40 become time-and-a-half', () => {
  // 6 days x 8h = 48h, all straight time, none daily-OT.
  const r = classifyWorkweek(W.slice(0,6).map(x => d(x, 8)));
  assert.deepEqual(r.totals, { regular: 40, ot1_5: 8, ot2_0: 0 });
});

test('NO PYRAMIDING: hours already paid as daily OT are excluded from the 40', () => {
  // 5 days x 10h = 50h. Each day: 8 straight + 2 daily OT.
  // Straight-time total is 40 exactly -> no weekly OT on top.
  // Wrong answer (pyramiding) would add 10 more hours of weekly OT.
  const r = classifyWorkweek(W.slice(0,5).map(x => d(x, 10)));
  assert.deepEqual(r.totals, { regular: 40, ot1_5: 10, ot2_0: 0 });
});

test('seventh consecutive day: first 8 at 1.5x, beyond at 2x', () => {
  const r = classifyWorkweek(W.map(x => d(x, 8)));
  assert.equal(r.seventhDay, W[6]);
  const seventh = r.days.find(x => x.date === W[6]);
  assert.deepEqual({ r: seventh.regular, a: seventh.ot1_5, b: seventh.ot2_0 },
                   { r: 0, a: 8, b: 0 });
});

test('seventh day over 8 hours goes to double time', () => {
  const days = W.slice(0,6).map(x => d(x, 8)).concat([d(W[6], 10)]);
  const r = classifyWorkweek(days);
  const seventh = r.days.find(x => x.date === W[6]);
  assert.deepEqual({ a: seventh.ot1_5, b: seventh.ot2_0 }, { a: 8, b: 2 });
});

test('seventh-day hours do not also count toward the 40', () => {
  // 6x8 = 48 straight -> 40 regular + 8 weekly OT. The 7th day adds only
  // its own premium hours, never straight time.
  const r = classifyWorkweek(W.map(x => d(x, 8)));
  assert.equal(r.totals.regular, 40);
  assert.equal(r.totals.ot1_5, 8 + 8, 'weekly OT 8 + seventh-day 8');
  assert.equal(r.totals.ot2_0, 0);
});

test('the rule is CONSECUTIVE days, not simply the seventh day worked', () => {
  // Works Sun-Tue, off Wed, Thu-Sat. Seven entries would be impossible;
  // six worked days with a gap means no seventh-day premium.
  const days = [d(W[0],8), d(W[1],8), d(W[2],8), d(W[4],8), d(W[5],8), d(W[6],8)];
  const r = classifyWorkweek(days);
  assert.equal(r.seventhDay, null);
});

test('PTO does not count toward the 40 and breaks the consecutive run', () => {
  const days = W.map((x,i) => i === 3 ? d(x, 8, false) : d(x, 8));
  const r = classifyWorkweek(days);
  assert.equal(r.seventhDay, null, 'PTO day breaks the run');
  // 6 worked days x 8h = 48 straight -> 40 + 8 weekly OT. PTO's 8h are paid
  // but must not push anything into overtime.
  assert.equal(r.totals.ot1_5, 8);
  assert.equal(r.totals.regular, 48, '40 worked + 8 PTO, none of it premium');
});

test('daily and weekly interact correctly on a heavy week', () => {
  // Mon-Fri 10h (50h: 40 straight + 10 daily OT), Sat 6h.
  // Straight-time reaches 40 during Friday; Saturday's 6h are all weekly OT.
  const days = [d(W[1],10), d(W[2],10), d(W[3],10), d(W[4],10), d(W[5],10), d(W[6],6)];
  const r = classifyWorkweek(days);
  assert.equal(r.totals.regular, 40);
  assert.equal(r.totals.ot1_5, 10 + 6);
  assert.equal(r.totals.ot2_0, 0);
});

test('no hours are ever lost or invented', () => {
  const cases = [
    W.map(x => d(x, 8)),
    W.slice(0,5).map(x => d(x, 13)),
    [d(W[0], 16)],
    W.map((x,i) => d(x, i + 2)),
  ];
  for (const days of cases) {
    const r = classifyWorkweek(days);
    const inHours = days.reduce((s,x) => s + x.hours, 0);
    const outHours = r.totals.regular + r.totals.ot1_5 + r.totals.ot2_0;
    assert.equal(Math.round(outHours*100)/100, Math.round(inHours*100)/100,
      `hours must balance: in ${inHours}, out ${outHours}`);
  }
});

test('seventh-day blocking helper', () => {
  const six = W.slice(0,6);
  assert.equal(consecutiveDaysIfAdded(six, W[6]), 7);
  assert.equal(violatesSeventhDay(six, W[6]), true);
  // a gap in the run means the seventh calendar day is only the fourth in a row
  const withGap = [W[0], W[1], W[3], W[4], W[5]];
  assert.equal(violatesSeventhDay(withGap, W[6]), false);
  // The next workweek is a fresh start. Under a Monday boundary that is the
  // 10th — the 9th is the Sunday that CLOSES this week, and adding it would be
  // the seventh consecutive day rather than the first of a new run.
  assert.equal(violatesSeventhDay(W, '2026-08-10'), false);
  assert.equal(violatesSeventhDay(W.slice(0,6), '2026-08-09'), true,
    'Sunday closes the week, so it is the seventh day and not a fresh start');
});

test('shiftHours handles bingo sessions crossing midnight', () => {
  assert.equal(shiftHours('17:00', '00:45'), 7.75);
  assert.equal(shiftHours('10:45', '16:30'), 5.75);
  assert.equal(shiftHours('09:30', '15:30'), 6);
});

/* The Monday boundary is not a cosmetic setting. Under the old Sunday
 * assumption a weekend OPENED a week; under a Monday one it CLOSES the week
 * that began five days earlier. The same hours therefore land in a different
 * week and can cross the 40-hour line that they previously started fresh
 * against. This is the case that would quietly underpay somebody if the
 * boundary were ever set back by mistake. */
test('weekend hours close the week rather than starting a new one', () => {
  // Mon-Fri 8h each = 40 straight. Then the Saturday.
  const week = ['2026-08-03','2026-08-04','2026-08-05','2026-08-06','2026-08-07']
    .map(x => d(x, 8));
  const withSaturday = week.concat([d('2026-08-08', 6)]);

  const r = classifyWorkweek(withSaturday);
  assert.equal(r.workweek, '2026-08-03', 'the Saturday belongs to the week that began Monday');
  assert.deepEqual(r.totals, { regular: 40, ot1_5: 6, ot2_0: 0 },
    'the Saturday is entirely over 40 and owes time-and-a-half');

  // Under a Sunday boundary those same six hours would have been the start of a
  // new week and paid straight through — six hours of premium, missed.
  const asSunday = classifyWorkweek(withSaturday.slice(0, 5), { startDow: 0 });
  assert.equal(asSunday.totals.ot1_5, 0);
});

test('Sunday is the seventh day of the week, not the first', () => {
  const mondayToSunday = ['2026-08-03','2026-08-04','2026-08-05','2026-08-06',
                          '2026-08-07','2026-08-08','2026-08-09'].map(x => d(x, 8));
  const r = classifyWorkweek(mondayToSunday);
  assert.equal(r.seventhDay, '2026-08-09',
    'the seventh consecutive day is the Sunday that ends the week');
  assert.equal(r.totals.regular, 40);
  assert.equal(r.totals.ot1_5, 16, '8h of daily-into-weekly OT plus 8h of seventh-day');
});
