import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planBreaks, hhmm } from '../sched/js/break-planner.js';

const runners = (n, start = 17*60, end = 24*60) =>
  Array.from({length:n}, (_,i) => ({ id:'r'+i, name:'R'+(i+1), roleId:'FR', startMin:start, endMin:end }));

test('everyone owed a meal gets one, and never after the 5th hour', () => {
  const people = runners(4);
  const { plan, conflicts } = planBreaks(people, { FR: 2 });
  assert.equal(conflicts.length, 0);
  for (const p of people) {
    const meal = plan.find(b => b.personId === p.id && b.kind === 'meal');
    assert.ok(meal, `${p.name} has no meal`);
    assert.ok(meal.startMin <= p.startMin + 5*60,
      `${p.name}'s meal starts at ${hhmm(meal.startMin)}, past the 5th hour`);
  }
});

test('COVERAGE IS NEVER BROKEN — the floor holds at every minute', () => {
  const people = runners(4);
  const floor = 2;
  const { plan } = planBreaks(people, { FR: floor });
  for (let m = 17*60; m < 24*60; m++) {
    const away = plan.filter(b => b.startMin <= m && m < b.endMin).length;
    assert.ok(people.length - away >= floor,
      `at ${hhmm(m)} only ${people.length - away} on the floor, floor is ${floor}`);
  }
});

test('a tighter floor serialises breaks rather than dropping them', () => {
  const people = runners(3);
  const { plan, conflicts } = planBreaks(people, { FR: 2 });
  assert.equal(conflicts.length, 0, 'three people with a floor of two can still all break');
  for (let m = 17*60; m < 24*60; m++) {
    const away = plan.filter(b => b.startMin <= m && m < b.endMin).length;
    assert.ok(away <= 1, `two people away at ${hhmm(m)} when only one may be`);
  }
});

/* Angela's rule, stated after seeing a morning session refuse every break:
 * "We always need to be assigning breaks. The number of flash runners could be
 * higher or lower. We always need breaks."
 *
 * So the floor is a preference. This test used to assert the opposite -- that
 * a lone Paymaster on a floor of one got NOTHING -- which was the bug. */
test('a lone person still gets their breaks; the floor yields, not the break', () => {
  const solo = [{ id:'p', name:'Paymaster', roleId:'PM', startMin:14*60, endMin:24*60 }];
  const { plan, conflicts, owed } = planBreaks(solo, { PM: 1 });
  assert.equal(conflicts.length, 0, 'nobody is refused a break for coverage');
  assert.equal(plan.filter(b => b.kind === 'meal').length, 1, 'a 10h shift owes a meal');
  assert.ok(plan.filter(b => b.kind === 'rest').length >= 2, 'and its rests');
  assert.deepEqual(owed, {}, 'nothing missed, so no premium owed');
  /* The cost is reported instead: the desk is unmanned while they are out. */
  for (const b of plan) assert.equal(b.dip, 1, 'the dip below the floor is recorded');
  const said = summariseDips(plan, () => 'Paymaster');
  assert.equal(said.length, 1);
  assert.match(said[0].text, /runs 1 under its floor/);
  assert.match(said[0].text, /Everyone still gets their breaks/);
});

test('a 10-hour shift owes one meal; over 10 owes two', () => {
  const ten = [{ id:'a', name:'A', roleId:'X', startMin:0, endMin:600 },
               { id:'b', name:'B', roleId:'X', startMin:0, endMin:600 },
               { id:'c', name:'C', roleId:'X', startMin:0, endMin:601 },
               { id:'d', name:'D', roleId:'X', startMin:0, endMin:601 }];
  const { plan } = planBreaks(ten, { X: 1 });
  assert.equal(plan.filter(b => b.personId==='a' && b.kind==='meal').length, 1);
  assert.equal(plan.filter(b => b.personId==='c' && b.kind==='meal').length, 2,
    'over 10 hours owes a second meal');
});

test('RE-PLANNING: a taken break is not scheduled again', () => {
  const people = runners(4);
  const first = planBreaks(people, { FR: 2 });
  const meal = first.plan.find(b => b.kind === 'meal');
  const after = planBreaks(people, { FR: 2 },
    [{ personId: meal.personId, kind: 'meal', startMin: meal.startMin, endMin: meal.endMin }]);
  assert.equal(after.plan.filter(b => b.personId === meal.personId && b.kind === 'meal').length, 0,
    'the meal already taken must not be planned a second time');
});

test('RE-PLANNING: a skipped break is not silently re-offered', () => {
  const people = runners(4);
  const { plan } = planBreaks(people, { FR: 2 }, [], { skipped: [{ personId:'r0', kind:'meal' }] });
  assert.equal(plan.filter(b => b.personId==='r0' && b.kind==='meal').length, 0);
});

test('RE-PLANNING mid-shift: nothing is scheduled in the past', () => {
  const people = runners(4);
  const now = 21*60;
  const { plan } = planBreaks(people, { FR: 2 }, [], { nowMin: now });
  for (const b of plan) assert.ok(b.startMin >= now, `${b.name} planned at ${hhmm(b.startMin)}, before now`);
});

test('a break in progress still occupies coverage when re-planning', () => {
  const people = runners(3);
  const inProgress = [{ personId:'r0', kind:'meal', startMin:20*60, endMin:20*60+30 }];
  const { plan } = planBreaks(people, { FR: 2 }, inProgress, { nowMin: 20*60 });
  for (let m = 20*60; m < 20*60+30; m++) {
    const away = plan.filter(b => b.startMin <= m && m < b.endMin).length;
    assert.equal(away, 0, `someone else sent away at ${hhmm(m)} while r0 is already out`);
  }
});

test('breaks are not scheduled past the end of a shift', () => {
  const people = runners(4);
  const { plan } = planBreaks(people, { FR: 2 });
  for (const b of plan) {
    const p = people.find(x => x.id === b.personId);
    assert.ok(b.endMin <= p.endMin, `${b.name}'s ${b.kind} runs past clock-out`);
  }
});

test('a short shift owes nothing', () => {
  const short = [{ id:'s', name:'S', roleId:'X', startMin:0, endMin:3*60 },
                 { id:'t', name:'T', roleId:'X', startMin:0, endMin:3*60 }];
  const { plan, conflicts } = planBreaks(short, { X: 1 });
  assert.equal(plan.length, 0);
  assert.equal(conflicts.length, 0);
});

/* The MOD, Opener, Paymaster and Flash Manager are each alone in their role,
 * so no per-role floor can stop them all breaking at once. Rachel's rule:
 * stagger them where there is room, but never hold someone back — a missed
 * break costs a premium hour, an empty office at dinner costs nothing. */
test('roles in a cover group are staggered rather than sent together', () => {
  const people = [
    { id: 'mod',  name: 'MOD',       roleId: 'mod',  startMin: 840, endMin: 1440 },
    { id: 'open', name: 'Opener',    roleId: 'open', startMin: 840, endMin: 1440 },
    { id: 'pay',  name: 'Paymaster', roleId: 'pay',  startMin: 840, endMin: 1440 },
    { id: 'fm',   name: 'FlashMgr',  roleId: 'fm',   startMin: 840, endMin: 1440 },
  ];
  const floors = { mod: 0, open: 0, pay: 0, fm: 0 };
  const coverGroups = { mod: 'mgmt', open: 'mgmt', pay: 'mgmt', fm: 'mgmt' };

  const grouped = planBreaks(people, floors, [], { nowMin: 840, coverGroups });
  assert.equal(grouped.conflicts.length, 0, 'staggering must not cost anybody a break');

  for (const a of grouped.plan) {
    for (const b of grouped.plan) {
      if (a === b || a.personId === b.personId) continue;
      const overlap = a.startMin < b.endMin && b.startMin < a.endMin;
      assert.ok(!overlap,
        `${a.name} (${a.kind}) and ${b.name} (${b.kind}) are away together — the group was not staggered`);
    }
  }

  // Without the group, they pile up — proving the option is what separated them.
  const ungrouped = planBreaks(people, floors, [], { nowMin: 840 });
  const together = ungrouped.plan.some(a => ungrouped.plan.some(b =>
    a !== b && a.personId !== b.personId && a.startMin < b.endMin && b.startMin < a.endMin));
  assert.ok(together, 'the fixture no longer demonstrates the pile-up it was written for');
});

/* Staggering is a preference, not a floor. When the room genuinely runs out,
 * everybody still gets their break even if that means overlapping. */
test('a cover group never costs somebody a break when there is no room', () => {
  // Six people, one group, a short shift: they cannot all be staggered.
  const people = Array.from({ length: 6 }, (_, i) => (
    { id: `p${i}`, name: `P${i}`, roleId: `r${i}`, startMin: 600, endMin: 960 }));
  const floors = {}, coverGroups = {};
  for (let i = 0; i < 6; i++) { floors[`r${i}`] = 0; coverGroups[`r${i}`] = 'mgmt'; }

  const r = planBreaks(people, floors, [], { nowMin: 600, coverGroups });
  assert.equal(r.conflicts.length, 0,
    'somebody was refused a break to keep the group staggered — that is backwards');
  for (const p of people) {
    assert.ok(r.plan.some(b => b.personId === p.id && b.kind === 'meal'),
      `${p.name} lost their meal to the stagger preference`);
  }
});

/* ---------------------------------------------------------------------------
   How early is too early for a meal.

   The statute sets a latest and no earliest, so a planner told only the
   deadline sends people to lunch twenty minutes into a nine-hour shift the
   moment the floor allows it — which is what began happening once placement
   started scoring by crowding.
--------------------------------------------------------------------------- */
test('a meal is not placed in the first two hours of a shift', () => {
  const p = { id:'a', name:'R', roleId:'r', startMin: 915, endMin: 1440 };
  const r = planBreaks([p], { r: 0 }, [], { nowMin: 915 });
  const meal = r.plan.find(b => b.kind === 'meal');
  assert.ok(meal, 'a nine-hour shift owes a meal');
  assert.ok(meal.startMin - p.startMin >= 120,
    `meal fell ${(meal.startMin - p.startMin)} minutes in, inside the two-hour floor`);
});

test('with a whole crew competing, none of them lunches before two hours', () => {
  const crew = Array.from({ length: 11 }, (_, i) =>
    ({ id: 'r'+i, name: 'R'+i, roleId: 'run', startMin: 915, endMin: 1440 }));
  const r = planBreaks(crew, { run: 4 }, [], { nowMin: 915 });
  const meals = r.plan.filter(b => b.kind === 'meal');
  assert.equal(meals.length, 11);
  const earliest = Math.min(...meals.map(m => m.startMin)) - 915;
  assert.ok(earliest >= 120, `earliest meal was ${earliest} minutes in`);
  /* and still inside the deadline for everybody */
  assert.equal(r.conflicts.length, 0);
  assert.ok(Math.max(...meals.map(m => m.startMin)) - 915 <= 300);
});

test('the floor yields rather than let a meal miss its deadline', () => {
  /* Clocked in with only 100 minutes before the deadline: holding the floor
     would push the meal past it, so the floor gives way. Missing the deadline
     costs a premium hour; a slightly early meal costs nothing. */
  const p = { id:'a', name:'Late', roleId:'r', startMin: 915, endMin: 1440 };
  const r = planBreaks([p], { r: 0 }, [], { nowMin: 915 + 300 - 100 });
  const meal = r.plan.find(b => b.kind === 'meal');
  assert.ok(meal, 'the meal must still be planned');
  assert.ok(meal.startMin <= 915 + 300, 'and must still meet the deadline');
});

/* ---------------------------------------------------------------------------
   Reading the conflicts back to a person.

   The raw list is one entry per break, so a role that is short-staffed makes
   three entries per person. Angela saw twelve lines of red for what is one
   fact -- "Flash Runners runs 3 with a floor of 4" -- and reasonably asked
   what it was all for.
--------------------------------------------------------------------------- */
import { summariseConflicts, summariseDips } from '../sched/js/break-planner.js';

const shortStaffedCrew = () => {
  /* Three runners, floor of four: the floor can never be met, so nobody in
     the role may ever be released. Long enough a shift to owe two rests and
     a meal each, which is what produced twelve lines. */
  const people = ['Abel', 'Amanda', 'Andrea'].map((n, i) =>
    ({ id: 'r'+i, name: n, roleId: 'FR', startMin: 9*60, endMin: 19*60 }));
  return planBreaks(people, { FR: 4 }, [], { nowMin: 9*60 });
};

test('a role rostered below its own floor still breaks everybody', () => {
  const { plan, conflicts } = shortStaffedCrew();
  assert.equal(conflicts.length, 0,
    'three runners against a floor of four refused twelve breaks — never again');
  for (const n of ['Abel', 'Amanda', 'Andrea']) {
    assert.ok(plan.some(b => b.name === n && b.kind === 'meal'), `${n} has no meal`);
    assert.ok(plan.some(b => b.name === n && b.kind === 'rest'), `${n} has no rest`);
  }
});

test('the floor still holds as far as it can — they go one at a time', () => {
  const { plan } = shortStaffedCrew();
  /* Headcount 3, so the honourable floor is 2: one away at a time, never two,
     even though the configured floor of 4 is unreachable. */
  for (let m = 9*60; m < 19*60; m++) {
    const away = plan.filter(b => b.startMin <= m && m < b.endMin).length;
    assert.ok(away <= 1, `${away} away at once at minute ${m} — the floor gave up too much`);
  }
});

test('the dip below the configured floor is reported rather than hidden', () => {
  const { plan } = shortStaffedCrew();
  const said = summariseDips(plan, () => 'Flash Runners');
  assert.equal(said.length, 1);
  assert.equal(said[0].under, 2, '3 working, 1 away, floor of 4 — two under');
  assert.match(said[0].text, /Flash Runners runs 2 under its floor/);
  for (const n of ['Abel', 'Amanda', 'Andrea'])
    assert.match(said[0].text, new RegExp(n));
});

test('coverage can no longer be the cause of a conflict', () => {
  const { conflicts } = shortStaffedCrew();
  assert.equal(conflicts.length, 0);
  /* And where a conflict IS raised, it is about the clock, not the floor. */
  const late = [{ id:'x', name:'Late', roleId:'FR', startMin:9*60, endMin:19*60 }];
  const r = planBreaks(late, { FR: 4 }, [], { nowMin: 19*60 - 5 });
  for (const c of r.conflicts) assert.equal(c.cause, 'no-window');
});

test('a conflict that IS raised reads as one line per person', () => {
  const people = Array.from({ length: 3 }, (_, i) =>
    ({ id: 'r'+i, name: 'R'+i, roleId: 'FR', startMin: 8*60, endMin: 18*60 }));
  /* Five minutes left in the shift: nothing fits, and no amount of yielding
     on coverage creates time that is not there. */
  const { conflicts } = planBreaks(people, { FR: 2 }, [], { nowMin: 18*60 - 5 });
  assert.ok(conflicts.length > 3, 'more conflicts than people, one per break');
  const said = summariseConflicts(conflicts, () => 'Flash Runners');
  assert.equal(said.length, 3, 'one line per person');
  assert.match(said[0].text, /cannot be fitted into what is left of the shift/);
});
