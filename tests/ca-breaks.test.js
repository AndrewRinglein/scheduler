import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restBreaksRequired, mealsRequired, firstMealWaivable, secondMealWaivable,
         checkDay, dailyOvertime } from '../sched/js/ca-breaks.js';

test('rest breaks follow the 4-hour-or-major-fraction table', () => {
  assert.equal(restBreaksRequired(3.5), 0);
  assert.equal(restBreaksRequired(3.6), 1);
  assert.equal(restBreaksRequired(6), 1);
  assert.equal(restBreaksRequired(6.1), 2);
  assert.equal(restBreaksRequired(10), 2);
  assert.equal(restBreaksRequired(10.1), 3);
  assert.equal(restBreaksRequired(14), 3);
});

test('meals: one over 5 hours, two over 10', () => {
  assert.equal(mealsRequired(5), 0);
  assert.equal(mealsRequired(5.1), 1);
  assert.equal(mealsRequired(10), 1);
  assert.equal(mealsRequired(10.1), 2);
  assert.equal(mealsRequired(12), 2);
});

test('a bingo session of 7.75h owes one meal and two rests', () => {
  assert.equal(mealsRequired(7.75), 1);
  assert.equal(restBreaksRequired(7.75), 2);
});

test('waiver rules', () => {
  assert.equal(firstMealWaivable(6), true);
  assert.equal(firstMealWaivable(6.1), false, 'over 6 hours cannot be waived');
  assert.equal(secondMealWaivable(12, true), true);
  assert.equal(secondMealWaivable(12.1, true), false, 'over 12 hours cannot be waived');
  assert.equal(secondMealWaivable(11, false), false, 'first must have been TAKEN, not waived');
});

test('a compliant 8-hour day', () => {
  const r = checkDay({hours:8, mealTaken:true, mealStartHour:4, restsTaken:2});
  assert.equal(r.ok, true);
  assert.deepEqual([r.restsRequired, r.mealsRequired], [2, 1]);
  assert.equal(r.premiumHours, 0);
});

test('a late meal is a violation even though it was taken', () => {
  const r = checkDay({hours:8, mealTaken:true, mealStartHour:5.5, restsTaken:2});
  assert.equal(r.ok, false);
  assert.equal(r.mealPremiumHours, 1);
  assert.match(r.problems[0], /after the 5th hour/);
});

test('premiums cap at one per category however many were missed', () => {
  const r = checkDay({hours:13, mealTaken:false, secondMealTaken:false, restsTaken:0});
  assert.equal(r.restsRequired, 3);
  assert.equal(r.mealsRequired, 2);
  assert.ok(r.problems.length >= 3, 'several distinct problems');
  assert.equal(r.mealPremiumHours, 1);
  assert.equal(r.restPremiumHours, 1);
  assert.equal(r.premiumHours, 2, 'never more than two hours in a day');
});

test('an invalid waiver is itself a violation', () => {
  const r = checkDay({hours:8, mealWaived:true, restsTaken:2});
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /only allowed at 6h or less/);
});

test('second meal waived without the first taken is a violation', () => {
  const r = checkDay({hours:11, mealWaived:true, secondMealWaived:true, restsTaken:3});
  assert.ok(r.problems.some(p => /first was not actually taken/.test(p)));
});

test('daily overtime splits at 8 and 12', () => {
  assert.deepEqual(dailyOvertime(7),  {regular:7, ot1_5:0, ot2_0:0});
  assert.deepEqual(dailyOvertime(10), {regular:8, ot1_5:2, ot2_0:0});
  assert.deepEqual(dailyOvertime(14), {regular:8, ot1_5:4, ot2_0:2});
});
