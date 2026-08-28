import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planRotation, validateRotation, rotParts, rotStart, rotEnd,
         CALLING, VERIFYING, SUPPORT, TRAINING }
  from '../sched/js/caller-rotation.js';

const REAL = JSON.parse(readFileSync(new URL('../sched/schedule-data.json', import.meta.url))).calling;

test('reproduces Rachel’s 7/31 rotation exactly', () => {
  const plan = planRotation([
    {name:'Gina'},{name:'Nathan'},{name:'Kaylyn'},{name:'Ruthie'},{name:'Thao',training:true}]);
  assert.deepEqual(plan.map(p=>p.sections), [
    [CALLING, SUPPORT, VERIFYING],
    [VERIFYING, CALLING, SUPPORT],
    [SUPPORT, VERIFYING, CALLING],
    [SUPPORT, SUPPORT, SUPPORT],
    [TRAINING, TRAINING, TRAINING],
  ]);
});

test('every generated rotation is structurally valid', () => {
  for (const [key, rows] of Object.entries(REAL)) {
    const callers = rows.map(r => ({
      name: r.name, training: r.sections.some(s => /training/i.test(s)) }));
    const problems = validateRotation(planRotation(callers));
    assert.equal(problems.length, 0, `${key}: ${problems.join('; ')}`);
  }
});

test('matches the hand-built rotations on the positions that matter', () => {
  // Rachel's sheet contains one-off duty swaps ("PM Paymaster Duties") and a
  // couple of typos ("Strips/Verfiying"). Those are noise; what must match is
  // WHO IS CALLING in each section, since that is the load-bearing decision.
  let sections = 0, callerMatches = 0;
  const misses = [];
  for (const [key, rows] of Object.entries(REAL)) {
    const callers = rows.map(r => ({
      name: r.name, training: r.sections.some(s => /training/i.test(s)) }));
    const plan = planRotation(callers);
    for (let s = 0; s < 3; s++) {
      const actual = rows.find(r => /^calling$/i.test((r.sections[s]||'').trim()))?.name;
      const mine   = plan.find(p => p.sections[s] === CALLING)?.name;
      if (!actual) continue;              // section had no clean "Calling" cell
      sections++;
      if (actual === mine) callerMatches++;
      else misses.push(`${key} s${s+1}: hers=${actual} mine=${mine}`);
    }
  }
  const pct = Math.round(100 * callerMatches / sections);
  console.log(`      caller-position agreement: ${callerMatches}/${sections} (${pct}%)`);
  if (misses.length) console.log('      ' + misses.join('\n      '));
  assert.ok(pct >= 90, `expected >=90% agreement, got ${pct}%`);
});

test('trainees never call, and are not counted in the cycle', () => {
  const plan = planRotation([
    {name:'T', training:true},{name:'A'},{name:'B'},{name:'C'}]);
  assert.deepEqual(plan[0].sections, [TRAINING, TRAINING, TRAINING]);
  assert.equal(plan[1].sections[0], CALLING, 'first non-trainee still opens');
  assert.equal(validateRotation(plan).length, 0);
});

test('degrades safely with fewer callers than sections', () => {
  for (const n of [1, 2, 3]) {
    const callers = Array.from({length:n}, (_,i) => ({name:`C${i}`}));
    const plan = planRotation(callers);
    assert.equal(validateRotation(plan).length, 0, `${n} caller(s) should still give 1 caller per section`);
  }
});

test('overrides win over the pattern', () => {
  const plan = planRotation([{name:'Esther'},{name:'Nathan'},{name:'Tatiana'},{name:'Raman'}],
    { overrides: { Esther: { 2: 'PM Paymaster Duties' } } });
  assert.equal(plan[0].sections[2], 'PM Paymaster Duties');
  assert.equal(plan[0].sections[0], CALLING, 'override must not disturb other sections');
});

/* ---------------------------------------------------------------------------
   Handovers inside a section.

   Angela's RWC sheet writes the middle section as "Calling/Verifying": this
   person starts on the mic and finishes verifying, while somebody else comes
   the other way. Validated as one opaque string it reported "0 callers" for
   the middle section of every RWC night — a false alarm on a rotation that is
   exactly right.
--------------------------------------------------------------------------- */
test('a handover is read as a start duty and an end duty', () => {
  assert.deepEqual(rotParts('Calling → Verifying'), ['Calling', 'Verifying']);
  assert.deepEqual(rotParts('Calling'), ['Calling', 'Calling']);
  assert.deepEqual(rotParts(''), ['', '']);
  assert.deepEqual(rotParts(null), ['', '']);
  /* the cart's own label contains a slash and must survive intact */
  assert.deepEqual(rotParts('Strips/Support'), ['Strips/Support', 'Strips/Support']);
  assert.deepEqual(rotParts('Calling → Strips/Support'), ['Calling', 'Strips/Support']);
});

test("RWC's real middle section validates clean", () => {
  /* 11 August, exactly as the sheet has it. */
  const plan = [
    { name:'Cody',   sections:['Calling', 'Calling → Verifying', 'Verifying'] },
    { name:'Kaylyn', sections:['Strips/Support', 'Verifying → Calling', 'Calling'] },
    { name:'Paula',  sections:['Verifying', 'Strips/Support', 'Strips/Support'] },
  ];
  assert.deepEqual(validateRotation(plan), [],
    'a correct rotation with a mid-section handover must not raise problems');
});

test('a handover that leaves the mic empty is still caught', () => {
  const plan = [
    { name:'A', sections:['Calling', 'Calling → Verifying', 'Calling'] },
    { name:'B', sections:['Verifying', 'Verifying → Strips/Support', 'Verifying'] },
  ];
  const problems = validateRotation(plan);
  assert.ok(problems.some(p => /section 2 \(at the end\)/.test(p) && /0 callers/.test(p)),
    `nobody picks the mic up in the second half and it went unreported: ${problems}`);
  assert.ok(!problems.some(p => /section 2 \(at the start\)/.test(p)),
    'the first half is fine and must not be flagged');
});

test('an ordinary section is reported once, not once per half', () => {
  const plan = [
    { name:'A', sections:['Verifying', 'Calling', 'Calling'] },
    { name:'B', sections:['Verifying', 'Verifying', 'Verifying'] },
  ];
  const problems = validateRotation(plan);
  assert.equal(problems.filter(p => /^section 1.*callers/.test(p)).length, 1,
    `section 1 has no caller and should say so once, not once per half: ${problems}`);
  assert.doesNotMatch(problems.join(' '), /at the (start|end)/);
});

test('a trainee still may not call, even on the back half of a handover', () => {
  const plan = [{ name:'T', sections:['Training', 'Strips/Support → Calling', 'Verifying'] }];
  assert.ok(validateRotation(plan).some(p => /trainee assigned to call/.test(p)));
});
