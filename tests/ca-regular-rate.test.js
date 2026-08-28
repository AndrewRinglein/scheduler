import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regularRateForWeek, commissionRateAdjustment, breakPremiumPay,
         payPeriodFor, PRODUCTION, FLAT_SUM } from '../sched/js/ca-regular-rate.js';

test('with no extra pay the regular rate is just the base rate', () => {
  const r = regularRateForWeek({ hoursWorked: 45, ot15Hours: 5, ot20Hours: 0, baseRate: 20 });
  assert.equal(r.regularRate, 20);
  assert.equal(r.premium, 50);            // 0.5 * 20 * 5
  assert.equal(r.total, 950);             // 900 straight + 50 premium
});

test('THE ONE THAT MATTERS: commission raises the regular rate, so overtime costs more', () => {
  // 45 hours at $20, plus $180 commission earned that week.
  // regular rate = (900 + 180) / 45 = $24, not $20.
  const r = regularRateForWeek({
    hoursWorked: 45, ot15Hours: 5, ot20Hours: 0, baseRate: 20,
    extraPay: [{ amount: 180, kind: PRODUCTION }],
  });
  assert.equal(r.regularRate, 24);
  assert.equal(r.premium, 60, '0.5 * 24 * 5');
  assert.equal(r.premiumOnBaseRateOnly, 50, 'what paying on base rate would have given');
  assert.equal(commissionRateAdjustment({
    hoursWorked: 45, ot15Hours: 5, ot20Hours: 0, baseRate: 20,
    extraPay: [{ amount: 180, kind: PRODUCTION }] }), 10,
    'the $10 underpayment that would otherwise be invisible');
});

test('double-time hours owe a full extra regular rate, not a half', () => {
  const r = regularRateForWeek({ hoursWorked: 14, ot15Hours: 4, ot20Hours: 2, baseRate: 20 });
  assert.equal(r.premium, 0.5*20*4 + 1.0*20*2);   // 40 + 40
});

test('the regular rate can never fall below minimum wage', () => {
  const r = regularRateForWeek({ hoursWorked: 40, ot15Hours: 0, ot20Hours: 0,
                                 baseRate: 10, minimumWage: 16.5 });
  assert.equal(r.regularRate, 16.5);
  assert.equal(r.belowMinimum, true);
});

test('flat-sum bonuses use non-overtime hours and a 1.5x multiplier', () => {
  // $100 flat sum, 45 hours worked, 5 of them overtime.
  // flat-sum rate = 100 / 40 non-OT hours = 2.50
  // premium = 1.5 * 2.50 * 5 = 18.75  (NOT 0.5 * rate)
  const r = regularRateForWeek({
    hoursWorked: 45, ot15Hours: 5, ot20Hours: 0, baseRate: 20,
    extraPay: [{ amount: 100, kind: FLAT_SUM }],
  });
  assert.equal(r.flatSumPremium, 18.75);
  assert.equal(r.regularRate, 20, 'a flat sum must NOT be spread across all hours');
});

test('production pay and flat-sum pay are treated differently', () => {
  const prod = regularRateForWeek({ hoursWorked: 45, ot15Hours: 5, ot20Hours: 0, baseRate: 20,
                                    extraPay: [{ amount: 100, kind: PRODUCTION }] });
  const flat = regularRateForWeek({ hoursWorked: 45, ot15Hours: 5, ot20Hours: 0, baseRate: 20,
                                    extraPay: [{ amount: 100, kind: FLAT_SUM }] });
  assert.notEqual(prod.regularRate, flat.regularRate);
  assert.equal(prod.regularRate, round4((900+100)/45));
  assert.equal(flat.regularRate, 20);
  function round4(n){ return Math.round(n*10000)/10000; }
});

test('extraPay defaults to production when kind is omitted', () => {
  const a = regularRateForWeek({ hoursWorked: 45, ot15Hours: 5, ot20Hours: 0, baseRate: 20,
                                 extraPay: [{ amount: 180 }] });
  assert.equal(a.regularRate, 24);
});

test('break premiums are paid at the regular rate, so commission raises them', () => {
  const withComm = regularRateForWeek({ hoursWorked: 45, ot15Hours: 5, ot20Hours: 0,
                                        baseRate: 20, extraPay: [{ amount: 180 }] });
  const p = breakPremiumPay(withComm.regularRate,
    [{ mealViolation: true, restViolation: true }, { mealViolation: true }]);
  assert.equal(p.hours, 3, 'capped at one meal + one rest per day');
  assert.equal(p.pay, 72, '3 * 24, not 3 * 20');
});

test('break premiums cap at two hours per day however many breaks were missed', () => {
  const p = breakPremiumPay(20, [{ mealViolation: true, restViolation: true }]);
  assert.equal(p.hours, 2);
});

test('zero hours does not divide by zero', () => {
  const r = regularRateForWeek({ hoursWorked: 0, ot15Hours: 0, ot20Hours: 0, baseRate: 20 });
  assert.equal(r.regularRate, 0);
  assert.equal(r.total, 0);
});

test('semi-monthly pay periods split at the 15th', () => {
  assert.deepEqual(payPeriodFor('2026-08-01'), { start:'2026-08-01', end:'2026-08-15', half:1 });
  assert.deepEqual(payPeriodFor('2026-08-15'), { start:'2026-08-01', end:'2026-08-15', half:1 });
  assert.deepEqual(payPeriodFor('2026-08-16'), { start:'2026-08-16', end:'2026-08-31', half:2 });
  assert.deepEqual(payPeriodFor('2026-02-20'), { start:'2026-02-16', end:'2026-02-28', half:2 });
  assert.deepEqual(payPeriodFor('2028-02-20'), { start:'2028-02-16', end:'2028-02-29', half:2 },
    'leap year');
});
