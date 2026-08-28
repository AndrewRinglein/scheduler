/**
 * board.html is a hand-written page, not generated from a view module, so the
 * views-render test does not cover it. This executes its real script the way a
 * browser would and asserts the one property that matters legally: NOBODY who
 * is clocked in disappears from the plan. A person dropped from the break board
 * is a person whose missed meal nobody notices, and that is an hour of premium
 * pay per occurrence.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function boardApi() {
  const html = readFileSync('sched/board.html', 'utf8');
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1]
    .replace(/\nboot\(\);/, '');
  const stub = { textContent: '', innerHTML: '', value: 'sc',
                 classList: { add() {}, remove() {} }, addEventListener() {} };
  const document = { getElementById: () => stub, addEventListener() {} };
  const supabase = { createClient: () => ({ rpc: async () => ({ data: null }),
                     auth: { getSession: async () => ({ data: { session: {} } }) } }) };
  let api;
  new Function('supabase', 'document', 'setInterval', 'alert', '__probe', script + `
    ;__probe({ compute, get plan(){return plan}, get conflicts(){return conflicts},
               get takeover(){return takeover}, setBoard(v){ board=v; },
               petSrc, petName, stepYard, walk });`
  )(supabase, document, () => {}, () => {}, x => { api = x; });
  return api;
}

const NOW = '2026-08-11T04:20:00.000+00:00';
const person = (name, id, role_id, floor, role) => ({
  name, staff_id: id, role_id, floor, role, pet: null,
  clock_in: '2026-08-11T01:16:00.000+00:00', clock_out: null,
  scheduled_end: '10:00', breaks: [] });

test('somebody clocked in with no assignment still gets breaks planned', () => {
  const api = boardApi();
  api.setBoard({ now: NOW, decisions: [],
                 people: [person('Walk Up', 'w', null, null, null)] });
  api.compute();
  const mine = api.plan.filter(b => b.personId === 'w');
  assert.ok(mine.length > 0,
    'a walk-up with no role vanished from the break board — they are still owed meals and rests');
  assert.ok(mine.some(b => b.kind === 'meal'), 'no meal planned for the walk-up');
});

test('an unassigned person carries no coverage obligation', () => {
  const api = boardApi();
  api.setBoard({ now: NOW, decisions: [],
                 people: [person('Walk Up', 'w', null, null, null)] });
  api.compute();
  assert.equal(api.conflicts.length, 0,
    'the lone walk-up blocked their own break — floor should be zero when nobody depends on them');
});

test('a real crew still respects its floor', () => {
  const api = boardApi();
  const crew = [1, 2, 3, 4, 5].map(n => person(`C${n}`, `c${n}`, 'caller', 3, 'Caller'));
  const api2 = api;
  api2.setBoard({ now: NOW, decisions: [], people: crew });
  api2.compute();
  const byMinute = new Map();
  for (const b of api2.plan) {
    for (let m = b.startMin; m < b.endMin; m++) byMinute.set(m, (byMinute.get(m) || 0) + 1);
  }
  const worst = Math.max(0, ...byMinute.values());
  assert.ok(worst <= 5 - 3,
    `${worst} callers away at once leaves the floor below 3`);
});

/* The characters are the whole reason anybody looks up at this TV. A board that
 * renders correct break times and no cats has missed the point of being a board
 * rather than a spreadsheet. */
const withPet = (name, id, pet, kind, breaks = []) => ({
  name, staff_id: id, role_id: 'run', floor: 4, role: 'Flash Runners', pet, pet_kind: kind,
  clock_in: '2026-08-12T01:00:00.000+00:00', clock_out: null, scheduled_end: '10:00', breaks });

test('every tile shows that person’s character', () => {
  const api = boardApi();
  api.setBoard({ now: NOW, decisions: [], people: [
    withPet('Gina', 'g', 'beans', 'cat'),
    withPet('Shelly', 's', 'ducky', 'boss'),
  ]});
  api.compute();
  assert.equal(api.petSrc('beans', 'cat'), 'art/pets/beans-sit.png');
  assert.equal(api.petSrc('ducky', 'boss'), 'art/monsters/ducky-sit.png',
    'monsters are not in the pets folder');
  assert.equal(api.petSrc('beans', 'cat', 'walk'), 'art/pets/beans-walk.png');
});

test('the -d suffix never reaches a person’s eyes', () => {
  const api = boardApi();
  assert.equal(api.petName('biscuit-d'), 'biscuit');
  assert.equal(api.petName('waffle-d'), 'waffle');
});

test('the floor holds everyone on shift and drops anyone away on a break', () => {
  const api = boardApi();
  api.setBoard({ now: NOW, decisions: [], people: [
    withPet('Gina', 'g', 'beans', 'cat'),
    withPet('Hector', 'h', 'mochi', 'cat'),
    withPet('Away', 'a', 'olive', 'cat',
      [{ kind: 'meal', started_at: '2026-08-12T04:00:00.000+00:00', ended_at: null }]),
  ]});
  api.compute(); api.stepYard();
  const w = api.walk;
  assert.ok(w.has('g') && w.has('h'), 'people on the floor are on the floor');
  assert.ok(!w.has('a'), 'somebody on their meal is not also wandering about downstairs');
});

test('characters keep their place across a refresh', () => {
  const api = boardApi();
  const people = [withPet('Gina', 'g', 'beans', 'cat')];
  api.setBoard({ now: NOW, decisions: [], people });
  api.compute();
  api.stepYard(); api.stepYard(); api.stepYard();
  const moved = api.walk.get('g').x;
  // The board reloads every twenty seconds; a character that jumped back to the
  // start on each reload would be worse than no character at all.
  api.setBoard({ now: NOW, decisions: [], people });
  api.compute(); api.stepYard();
  assert.notEqual(api.walk.get('g').x, 0, 'position was reset by the reload');
  assert.ok(Math.abs(api.walk.get('g').x - moved) < 100, 'position should continue, not restart');
});

test('someone who clocks out stops being drawn on the floor', () => {
  const api = boardApi();
  api.setBoard({ now: NOW, decisions: [], people: [
    withPet('Gina', 'g', 'beans', 'cat'), withPet('Hector', 'h', 'mochi', 'cat')]});
  api.compute(); api.stepYard();
  assert.equal(api.walk.size, 2);
  api.setBoard({ now: NOW, decisions: [], people: [withPet('Gina', 'g', 'beans', 'cat')]});
  api.compute(); api.stepYard();
  assert.equal(api.walk.size, 1, 'a departed person must not keep pacing the floor forever');
});

test('somebody with no character does not break the floor', () => {
  const api = boardApi();
  api.setBoard({ now: NOW, decisions: [], people: [
    withPet('Nopet', 'n', null, null), withPet('Gina', 'g', 'beans', 'cat')]});
  api.compute();
  assert.doesNotThrow(() => api.stepYard());
  assert.ok(!api.walk.has('n'));
});
