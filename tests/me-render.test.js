/**
 * me.html is the page a worker opens from their personal link. It is the only
 * page an employee ever sees, so a render fault here is not a broken admin
 * screen — it is 51 people unable to say they can't work a Saturday.
 * This executes the real page script against realistic worker_home payloads.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function page(payload) {
  const html = readFileSync(new URL('../sched/me.html', import.meta.url), 'utf8');
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1]
    .replace(/\nif\(!token\)[\s\S]*$/, '');          // don't auto-run on import

  const els = {};
  const mk = id => (els[id] ??= { id, textContent: '', innerHTML: '', value: '', hidden: false,
    disabled: false, dataset: {}, style: {}, classList: { add(){}, remove(){}, contains: () => false },
    addEventListener(){}, insertAdjacentHTML(_, h){ this.innerHTML = h + this.innerHTML; },
    closest: () => null });
  const document = { getElementById: mk, addEventListener(){}, querySelector: () => null };
  const supabase = { createClient: () => ({ rpc: async () => ({ data: null, error: null }) }) };
  const location = { search: '?t=' + 'x'.repeat(22) };

  let api;
  new Function('supabase', 'document', 'location', 'URLSearchParams', '__probe',
    script + `;__probe({ render, daysOff, syncFoot, weekOf, setHome(h){ home=h; note=h.request?.my_note||''; } });`
  )(supabase, document, location, URLSearchParams, x => { api = x; });

  api.setHome(payload);
  api.render();
  // syncFoot writes the summary as innerHTML and is skipped entirely when there
  // is no open request, so read through mk() rather than assuming the element
  // was ever touched.
  return { api, els, main: mk('main').innerHTML, foot: mk('foot'),
           summary: mk('summary').innerHTML, submit: mk('submit'),
           hi: mk('hi').innerHTML, period: mk('period').textContent };
}

/* A real fortnight: nine sessions a week, weekends running twice. */
function sessions(off = []) {
  const out = [];
  const offKey = new Set(off);
  for (let i = 0; i < 14; i++) {
    const d = new Date(Date.UTC(2026, 7, 24 + i));
    const iso = d.toISOString().slice(0, 10), dow = d.getUTCDay();
    const parts = (dow === 0 || dow === 6) ? ['AM', 'PM'] : ['PM'];
    for (const p of parts) out.push({ date: iso, part: p, hall: dow === 2 || dow === 3 || dow === 4 ? 'rwc' : 'sc',
                                      off: offKey.has(`${iso}|${p}`) });
  }
  return out;
}
const payload = (o = {}) => ({
  ok: true,
  me: { id: 'p1', name: 'Hector', first_name: 'Hector', pet: 'mochi', critical: false, ...(o.me || {}) },
  request: o.request === null ? null : { id: 'r1', start: '2026-08-24', end: '2026-09-06', cap: 2,
    note: null, replied_at: null, my_note: null, sessions: sessions(o.off || []), ...(o.request || {}) },
});

test('the form opens with everything available — the job is subtraction', () => {
  const r = page(payload());
  assert.equal(r.api.daysOff(), 0);
  assert.equal((r.main.match(/class="slot on"/g) || []).length, 18, 'all 18 sessions start available');
  assert.equal((r.main.match(/class="slot off"/g) || []).length, 0);
  assert.match(r.summary, /Available for <b>18<\/b> of 18/);
});

test('a floor runner gets no cap message and no limit', () => {
  const r = page(payload({ off: ['2026-08-25|PM', '2026-08-26|PM', '2026-08-27|PM', '2026-08-28|PM'] }));
  assert.equal(r.api.daysOff(), 4);
  assert.doesNotMatch(r.main, /critical staff/i, 'a floor runner must not be told they are critical');
  assert.equal(r.foot.hidden, false);
});

test('critical staff are told the rule and how much is left', () => {
  const r = page(payload({ me: { critical: true } }));
  assert.match(r.main, /You're critical staff/);
  assert.match(r.main, /2<\/span> still to use/);
});

test('turning off one half of a weekend spends one day, not two', () => {
  const r = page(payload({ me: { critical: true }, off: ['2026-08-29|PM'] }));   // Saturday evening
  assert.equal(r.api.daysOff(), 1, 'Saturday evening alone is one day');
  assert.match(r.main, /1<\/span> still to use/);
  // The Saturday afternoon must still be offered.
  assert.match(r.main, /data-d="2026-08-29" data-p="AM"/);
  assert.equal((r.main.match(/class="slot off"/g) || []).length, 1);
});

test('going over the cap is allowed, explained, and gated on a reason', () => {
  const over = ['2026-08-25|PM', '2026-08-26|PM', '2026-08-27|PM'];
  const r = page(payload({ me: { critical: true }, off: over }));
  assert.equal(r.api.daysOff(), 3);
  assert.match(r.main, /more than 2 days/i);
  assert.match(r.main, /Why do you need the extra days\? \(required\)/);
  assert.match(r.summary, /Add a reason to send/);
  assert.equal(r.submit.disabled, true, 'cannot send without saying why');
});

test('a reason already given unlocks the send', () => {
  const over = ['2026-08-25|PM', '2026-08-26|PM', '2026-08-27|PM'];
  const r = page(payload({ me: { critical: true }, off: over, request: { my_note: 'jury duty' } }));
  assert.equal(r.submit.disabled, false);
  assert.doesNotMatch(r.summary, /Add a reason/);
});

test('no open request says so instead of rendering an empty form', () => {
  const r = page(payload({ request: null }));
  // Wording sharpened once shifts appeared above it — "nothing to fill in"
  // read as though the whole page were empty.
  assert.match(r.main, /No availability to fill in right now/);
  assert.equal(r.foot.hidden, true, 'no submit bar when there is nothing to submit');
});

test('an answer already sent can still be changed', () => {
  const r = page(payload({ request: { replied_at: '2026-08-12T04:00:00Z' } }));
  assert.equal(r.submit.textContent, 'Update');
  assert.match(r.summary, /change it any time/);
});

test('dates are not shifted by a timezone', () => {
  const r = page(payload());
  // 2026-08-24 is a Monday and 2026-08-29 a Saturday. If these were parsed as
  // local Date objects they would slide a day west of UTC.
  assert.match(r.main, /Monday<\/span><span class="ddate">Aug 24/);
  assert.match(r.main, /Saturday<\/span><span class="ddate">Aug 29/);
});

test('the fortnight is split into two labelled weeks', () => {
  const r = page(payload());
  assert.equal(r.api.weekOf('2026-08-24', '2026-08-24'), 0);
  assert.equal(r.api.weekOf('2026-08-30', '2026-08-24'), 0, 'day 7 is still week one');
  assert.equal(r.api.weekOf('2026-08-31', '2026-08-24'), 1);
  assert.match(r.main, /first week/);
  assert.match(r.main, /Second week/);
});

test("the manager's note is shown when there is one", () => {
  const r = page(payload({ request: { note: 'Please reply by Friday.' } }));
  assert.match(r.main, /Please reply by Friday\./);
});

test('a name with markup in it cannot inject into the page', () => {
  const r = page(payload({ me: { first_name: '<img src=x onerror=alert(1)>' } }));
  // The character sprite is a legitimate <img>; what must not appear is the
  // one smuggled in through the name.
  // The character sprite is a legitimate <img>. What must not appear is an
  // UNESCAPED tag smuggled in through the name — the escaped text still
  // contains the word "onerror", harmlessly, so match on the angle bracket.
  assert.doesNotMatch(r.hi, /<img src=x/, 'the name must be escaped');
  assert.match(r.hi, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(r.hi, /<img class="pet"/, 'the real sprite still renders');
});

/* The characters. There are 40 cats, 20 dogs and 6 monsters in sched/art, and
 * a person's character is how they find themselves on the break board — so a
 * page that draws a paw emoji instead of the sprite is a page that has quietly
 * dropped the feature. */
function pageWithPicker(payload, mutate) {
  const html = readFileSync(new URL('../sched/me.html', import.meta.url), 'utf8');
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1]
    .replace(/\nif\(!token\)[\s\S]*$/, '');
  const els = {};
  const mk = id => (els[id] ??= { id, textContent:'', innerHTML:'', value:'', hidden:false,
    disabled:false, dataset:{}, style:{}, classList:{ add(){}, remove(){}, contains:()=>false },
    addEventListener(){}, insertAdjacentHTML(_,h){ this.innerHTML=h+this.innerHTML; }, closest:()=>null });
  const document = { getElementById: mk, addEventListener(){}, querySelector:()=>null };
  const supabase = { createClient: () => ({ rpc: async () => ({ data:null, error:null }) }) };
  let api;
  new Function('supabase','document','location','URLSearchParams','__probe',
    script + `;__probe({ render, petSrc, petName, myPetCard, renderPicker,
      setHome(h){ home=h; note=h.request?.my_note||''; },
      setPicking(v,c){ picking=v; cat=c; }, setTab(t){ ptab=t; } });`
  )(supabase, document, { search:'?t='+'x'.repeat(22) }, URLSearchParams, x => { api = x; });
  api.setHome(payload); if (mutate) mutate(api); api.render();
  return { api, main: mk('main').innerHTML, hi: mk('hi').innerHTML };
}

test('the sprite is the embedded picture, not a path that might not resolve', () => {
  const r = pageWithPicker(payload());
  // This is the whole point: a data URL cannot fail to resolve, and a relative
  // path repeatedly did.
  for (const [pet, kind] of [['mochi','cat'], ['rufus','dog'], ['ducky','boss']]) {
    assert.match(r.api.petSrc(pet, kind), /^data:image\/png;base64,/,
      `${pet} must come from the embedded art`);
  }
  // A character with no embedded copy still falls back to the file, and the
  // monsters still resolve to their own folder.
  assert.equal(r.api.petSrc('nosuchpet', 'cat'), 'art/pets/nosuchpet-sit.png');
  assert.equal(r.api.petSrc('nosuchpet', 'boss'), 'art/monsters/nosuchpet-sit.png');
});

test('the -d suffix is a filename detail and never shown to a person', () => {
  const r = pageWithPicker(payload());
  assert.equal(r.api.petName('biscuit-d'), 'biscuit');
  assert.equal(r.api.petName('biscuit'), 'biscuit');
  assert.equal(r.api.petName('waffle-d'), 'waffle');
});

test('the greeting shows the actual character, not an emoji', () => {
  const r = pageWithPicker(payload({ me: { pet:'mochi', pet_kind:'cat' } }));
  assert.match(r.hi, /src="data:image\/png;base64,/, 'the greeting draws the real picture');
  assert.doesNotMatch(r.hi, /🐾/, 'the paw emoji placeholder must be gone');
});

test('somebody with no character is offered one rather than shown nothing', () => {
  const r = pageWithPicker(payload({ me: { pet:null, pet_kind:null } }));
  assert.match(r.main, /No character yet/);
  assert.match(r.main, /id="pickbtn"/);
  assert.match(r.main, />Choose</);
});

test('somebody with a character can change it', () => {
  const r = pageWithPicker(payload({ me: { pet:'mochi', pet_kind:'cat' } }));
  assert.match(r.main, /src="data:image\/png;base64,/);
  assert.match(r.main, />Change</);
});

test('the picker greys out taken characters and names who has them', () => {
  const cat = { ok:true, tier:0, mine:'mochi', pets:[
    { id:'mochi', kind:'cat', tier:0, allowed:true, mine:true,  taken_by:null },
    { id:'basil', kind:'cat', tier:0, allowed:true, mine:false, taken_by:'Gina' },
    { id:'apricot', kind:'cat', tier:0, allowed:true, mine:false, taken_by:null },
  ]};
  const r = pageWithPicker(payload({ me:{ pet:'mochi', pet_kind:'cat' } }),
                           api => api.setPicking(true, cat));
  assert.match(r.main, /class="pcard mine"[\s\S]*?data-pet="mochi"/);
  assert.match(r.main, /class="pcard taken"[\s\S]*?data-pet="basil"/);
  assert.match(r.main, /Gina/, "the current owner's first name is shown");
  assert.match(r.main, /data-pet="apricot"/);
});

/* The rank gate came off in migration 042: a runner may take a hero, a robot,
 * a snack or a monster, and the page must not tell them otherwise. The only
 * rule left is that somebody else may already have it. */
test('NO RANK GATE: a runner is shown every kind, not just cats', () => {
  const cat = { ok:true, tier:0, mine:'mochi', pets:[
    { id:'mochi', kind:'cat',   tier:0, allowed:true, mine:true,  taken_by:null },
    { id:'rufus', kind:'dog',   tier:0, allowed:true, mine:false, taken_by:null },
    { id:'tusk',  kind:'hero',  tier:0, allowed:true, mine:false, taken_by:null },
    { id:'beep',  kind:'robot', tier:0, allowed:true, mine:false, taken_by:null },
    { id:'ducky', kind:'boss',  tier:0, allowed:true, mine:false, taken_by:null },
  ]};
  const r = pageWithPicker(payload({ me:{ pet:'mochi', pet_kind:'cat' } }),
                           api => api.setPicking(true, cat));
  for (const id of ['rufus', 'tusk', 'beep', 'ducky'])
    assert.match(r.main, new RegExp(`data-pet="${id}"`),
      `a runner must be offered ${id} now that rank is gone`);
  assert.match(r.main, /Take any character nobody else has/);
  assert.doesNotMatch(r.main, /Floor runners take a cat/,
    'the old rank copy must be gone, not just unenforced');
  assert.doesNotMatch(r.main, /Dogs unlock/);
});

test('every kind present gets its own tab', () => {
  const cat = { ok:true, tier:0, mine:'ducky', pets:[
    { id:'mochi', kind:'cat',    tier:0, allowed:true, mine:false, taken_by:null },
    { id:'rufus', kind:'dog',    tier:0, allowed:true, mine:false, taken_by:null },
    { id:'ducky', kind:'boss',   tier:0, allowed:true, mine:true,  taken_by:null },
    { id:'tusk',  kind:'hero',   tier:0, allowed:true, mine:false, taken_by:null },
    { id:'acorn', kind:'critter',tier:0, allowed:true, mine:false, taken_by:null },
    { id:'guac',  kind:'snack',  tier:0, allowed:true, mine:false, taken_by:null },
  ]};
  const r = pageWithPicker(payload({ me:{ pet:'ducky', pet_kind:'boss', critical:true } }),
                           api => api.setPicking(true, cat));
  for (const k of ['cat','dog','boss','hero','critter','snack'])
    assert.match(r.main, new RegExp(`data-ptab="${k}"`), `${k} needs a tab`);
  assert.match(r.main, /src="data:image\/png;base64,/, 'the art is embedded too');
});

/* The new library is reached through a third art folder. If PET_KIND_DIR ever
 * loses a kind, that kind silently falls back to pets/ and every one of those
 * characters is a broken image with nothing in the console to say why. */
test('every new kind resolves to embedded art, not a bare path', () => {
  const cat = { ok:true, tier:0, mine:null, pets:
    [['tusk','hero'],['acorn','critter'],['beep','robot'],['guac','snack'],['boo','monster']]
      .map(([id,kind]) => ({ id, kind, tier:0, allowed:true, mine:false, taken_by:null })) };
  const r = pageWithPicker(payload({ me:{ pet:null } }), api => api.setPicking(true, cat));
  const srcs = [...r.main.matchAll(/<img src="([^"]+)"/g)].map(m => m[1]);
  assert.equal(srcs.length, 5);
  for (const s of srcs)
    assert.ok(s.startsWith('data:image/png;base64,'),
      `character art fell back to a relative path (${s.slice(0,40)}) -- PET_KIND_DIR is missing a kind`);
});

test('a taken character cannot be tapped', () => {
  const cat = { ok:true, tier:0, mine:null, pets:[
    { id:'basil', kind:'cat', tier:0, allowed:true, mine:false, taken_by:'Gina' },
  ]};
  const r = pageWithPicker(payload({ me:{ pet:null } }), api => api.setPicking(true, cat));
  assert.match(r.main, /data-pet="basil"[^>]*disabled/, 'taken characters must be disabled');
});

/* ---------------------------------------------------------------------------
   My shifts. The rule Rachel stated: you are booked, you can hand it over, and
   you can decline but you are warned that declining without finding cover is
   not acceptable. The page has to say that in those terms.
--------------------------------------------------------------------------- */
function pageWithShifts(shiftList, opts = {}) {
  const html = readFileSync(new URL('../sched/me.html', import.meta.url), 'utf8');
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1]
    .replace(/\nif\(!token\)[\s\S]*$/, '');
  const els = {};
  const mk = id => (els[id] ??= { id, textContent:'', innerHTML:'', value:'', hidden:false,
    disabled:false, dataset:{}, style:{}, classList:{ add(){}, remove(){}, contains:()=>false },
    addEventListener(){}, insertAdjacentHTML(_,h){ this.innerHTML=h+this.innerHTML; }, closest:()=>null });
  const document = { getElementById: mk, addEventListener(){}, querySelector:()=>null };
  const supabase = { createClient: () => ({ rpc: async () => ({ data:null, error:null }) }) };
  let api;
  new Function('supabase','document','location','URLSearchParams','__probe',
    script + `;__probe({ render, setHome(h){ home=h; note=''; },
      setShifts(v){ shifts=v; }, setConfirming(v){ confirming=v; },
      setIncoming(v){ incoming=v; }, setHanding(a,c){ handing=a; candidates=c; },
      setHours(v,o){ hours=v; hoursOffset=o||0; } });`
  )(supabase, document, { search:'?t='+'x'.repeat(22) }, URLSearchParams, x => { api = x; });
  api.setHome(payload({ request: opts.request === undefined ? null : opts.request }));
  api.setShifts(shiftList);
  if (opts.confirming) api.setConfirming(opts.confirming);
  if (opts.incoming) api.setIncoming(opts.incoming);
  if (opts.handing) api.setHanding(opts.handing, opts.candidates ?? null);
  if (opts.hours !== undefined) api.setHours(opts.hours, opts.hoursOffset);
  api.render();
  return { api, main: mk('main').innerHTML };
}

const shift = (o = {}) => ({ assignment_id:'a1', session_id:'s1', date:'2026-08-28',
  part:'PM', hall:'sc', role:'Flash Runners', role_id:'r1', starts:'15:15', ends:'00:00',
  response:'pending', responded_at:null, handed_from:null, past:false, ...o });

test('a booked shift shows when, where and what, with both actions', () => {
  const r = pageWithShifts([shift()]);
  assert.match(r.main, /Friday/, '2026-08-28 is a Friday');
  assert.match(r.main, /Aug 28/);
  assert.match(r.main, /SC</);
  assert.match(r.main, /Flash Runners/);
  assert.match(r.main, /from 15:15/);
  assert.match(r.main, /data-sa="a1"/, 'an acknowledge button');
  assert.match(r.main, /data-sd="a1"/, 'a decline button');
});

test('nobody with no shifts sees an empty box', () => {
  const r = pageWithShifts([]);
  assert.match(r.main, /Nothing scheduled yet/);
  assert.doesNotMatch(r.main, /data-sa=/);
});

test('an acknowledged shift says so and drops the Got it button', () => {
  const r = pageWithShifts([shift({ response:'accepted' })]);
  assert.match(r.main, /You've said you've got this/);
  assert.doesNotMatch(r.main, /data-sa="a1"/, 'no point acknowledging twice');
  assert.match(r.main, /data-sd="a1"/, 'they can still say they cannot work it');
});

test('declining warns in the words the rule is actually stated in', () => {
  const r = pageWithShifts([shift()], { confirming:'a1' });
  assert.match(r.main, /You're expected to find someone to take it/);
  assert.match(r.main, /isn't normally allowed/);
  assert.match(r.main, /manager\s+will be told/);
  assert.match(r.main, /data-sdyes="a1"/, 'a second, deliberate confirmation');
  assert.match(r.main, /data-sdno/, 'and a way out');
});

test('the warning appears only for the shift being declined', () => {
  const r = pageWithShifts([shift(), shift({ assignment_id:'a2', date:'2026-08-29' })],
                           { confirming:'a1' });
  assert.equal((r.main.match(/warnbox/g) || []).length, 1);
});

test('a past shift is shown but cannot be acted on', () => {
  const r = pageWithShifts([shift({ past:true, date:'2026-08-01' })]);
  assert.match(r.main, /Just gone/);
  assert.doesNotMatch(r.main, /data-sa=/, 'you cannot accept a shift that already happened');
  assert.doesNotMatch(r.main, /data-sd=/, 'nor decline one');
});

test('a shift picked up from somebody says where it came from', () => {
  const r = pageWithShifts([shift({ handed_from:'Gina' })]);
  assert.match(r.main, /Picked up from Gina/);
});

test('shifts render even when there is no availability request open', () => {
  const r = pageWithShifts([shift()], { request: null });
  assert.match(r.main, /data-sa="a1"/);
  assert.match(r.main, /No availability to fill in right now/);
});

/* ---------------------------------------------------------------------------
   Handing a shift over. The rule: you get out of a booking by finding somebody
   qualified who has already agreed. The shift does not move until they say yes.
--------------------------------------------------------------------------- */

test('a shift offers to be handed over', () => {
  const r = pageWithShifts([shift()]);
  assert.match(r.main, /data-hand="a1"/);
});

test('picking who covers it shows characters and names, never contact details', () => {
  const cands = { ok:true, people:[
    { staff_id:'p2', name:'Wayne', pet:'vampire', pet_kind:'boss' },
    { staff_id:'p3', name:'Gina',  pet:'beans',   pet_kind:'cat'  },
  ]};
  const r = pageWithShifts([shift()], { handing:'a1', candidates:cands });
  assert.match(r.main, /Who has agreed to take it/);
  assert.match(r.main, /data-hto="p2"/);
  assert.match(r.main, /data-hto="p3"/);
  assert.match(r.main, /src="data:image\/png;base64,/, 'their characters are drawn');
  assert.doesNotMatch(r.main, /@/, 'no email may reach another worker');
});

test('nobody able to cover says so plainly rather than showing an empty grid', () => {
  const r = pageWithShifts([shift()], { handing:'a1', candidates:{ ok:true, people:[] } });
  assert.match(r.main, /Nobody else can cover this one/);
  assert.match(r.main, /Tell your manager/);
  assert.doesNotMatch(r.main, /data-hto=/);
});

test('a shift with a request out says who it is waiting on and offers to cancel', () => {
  const r = pageWithShifts([shift({ pending_handoff:{ id:'h1', name:'Wayne' } })]);
  assert.match(r.main, /Waiting on <b>Wayne<\/b>/);
  assert.match(r.main, /data-hcancel="h1"/);
  // Critically: while a request is out, they must not also be offered the
  // other actions, or they will ask two people at once.
  assert.doesNotMatch(r.main, /data-hand="a1"/);
  assert.doesNotMatch(r.main, /data-sd="a1"/);
});

test('a request waiting on me appears above my own shifts', () => {
  const r = pageWithShifts([shift()], { incoming:[
    { id:'h9', from_name:'Hector', date:'2026-08-28', part:'PM', hall:'sc',
      role:'Callers/Strip', starts:'15:15' }]});
  assert.match(r.main, /Hector has asked you to take a shift/);
  assert.match(r.main, /Callers\/Strip/);
  assert.match(r.main, /data-hyes="h9"/);
  assert.match(r.main, /data-hno="h9"/);
  assert.ok(r.main.indexOf('has asked you') < r.main.indexOf('My shifts'),
    'answering somebody is more urgent than reviewing your own roster');
});

test('no incoming requests renders nothing at all', () => {
  const r = pageWithShifts([shift()], { incoming: [] });
  assert.doesNotMatch(r.main, /has asked you to take/);
});

test('a past shift cannot be handed over', () => {
  const r = pageWithShifts([shift({ past:true })]);
  assert.doesNotMatch(r.main, /data-hand=/);
});

/* ---------------------------------------------------------------------------
   My hours. Pay periods are fourteen days from a Monday. Overtime is
   classified on the page by the same tested module the manager app uses —
   the database returns raw daily hours and nothing else, because a second
   implementation of California wage law would drift from the first.

   And no pay rate, ever. None is stored in this system.
--------------------------------------------------------------------------- */

const hoursPayload = (days, o = {}) => ({ ok:true, start:'2026-08-03', end:'2026-08-16',
  offset:0, days, commission:0, shifts:days.length, ...o });

test('the period is shown as a fortnight starting on a Monday', () => {
  const r = pageWithShifts([], { hours: hoursPayload([]) });
  assert.match(r.main, /Aug 3 – Aug 16/);
  assert.match(r.main, /this pay period/);
});

test('hours under forty in a week produce no overtime', () => {
  // Mon-Fri, 7 hours each = 35. No daily over 8, no weekly over 40.
  const days = ['2026-08-03','2026-08-04','2026-08-05','2026-08-06','2026-08-07']
    .map(date => ({ date, hours:7, worked:true }));
  const r = pageWithShifts([], { hours: hoursPayload(days) });
  assert.match(r.main, /35\.00<\/div><div class="l">hours worked/);
  assert.match(r.main, /0\.00<\/div><div class="l">overtime/);
});

test('a ten-hour day produces two hours of overtime', () => {
  const r = pageWithShifts([], { hours: hoursPayload(
    [{ date:'2026-08-03', hours:10, worked:true }]) });
  assert.match(r.main, /2\.00<\/div><div class="l">overtime/);
});

test('a FORTNIGHT is classified as two weeks, not one long one', () => {
  // 5 x 8h in week one and 5 x 8h in week two = 80 hours across the period.
  // Each week is exactly 40, so there is NO overtime. Classifying the fortnight
  // as a single block would apply the 40-hour rule once and invent 40 hours of
  // overtime that nobody earned.
  const w1 = ['2026-08-03','2026-08-04','2026-08-05','2026-08-06','2026-08-07'];
  const w2 = ['2026-08-10','2026-08-11','2026-08-12','2026-08-13','2026-08-14'];
  const days = [...w1, ...w2].map(date => ({ date, hours:8, worked:true }));
  const r = pageWithShifts([], { hours: hoursPayload(days) });
  assert.match(r.main, /80\.00<\/div><div class="l">hours worked/);
  assert.match(r.main, /0\.00<\/div><div class="l">overtime/,
    'two forty-hour weeks owe no overtime');
});

test('commission is shown as money earned', () => {
  const r = pageWithShifts([], { hours: hoursPayload([], { commission: 137.5 }) });
  assert.match(r.main, /\$137\.50/);
});

test('no pay rate appears anywhere on the page', () => {
  const r = pageWithShifts([shift()], { hours: hoursPayload(
    [{ date:'2026-08-03', hours:8, worked:true }], { commission: 100 }) });
  assert.doesNotMatch(r.main, /per hour|hourly|\/hr|rate/i,
    'no rate is stored in this system and none may be implied');
});

test('somebody who has worked nothing sees zeroes, not a blank', () => {
  const r = pageWithShifts([], { hours: hoursPayload([]) });
  assert.match(r.main, /0\.00<\/div><div class="l">hours worked/);
  assert.match(r.main, /hours worked/);
});

test('a previous period can be looked at, and returned from', () => {
  const now = pageWithShifts([], { hours: hoursPayload([]) });
  assert.match(now.main, /data-hoff="-1"/);
  assert.doesNotMatch(now.main, /data-hoff="0"/, 'no "this period" link while on it');

  const back = pageWithShifts([], { hours: hoursPayload([], { offset:-1 }), hoursOffset:-1 });
  assert.match(back.main, /data-hoff="0"/, 'a way back to the current one');
  assert.doesNotMatch(back.main, /this pay period/);
});

test('a malformed day does not blank the whole page', () => {
  const r = pageWithShifts([], { hours: hoursPayload([
    { date:'2026-08-03', hours:8, worked:true },
    { date:'not-a-date', hours:5, worked:true },
  ]) });
  assert.match(r.main, /hours worked/, 'the page still renders');
});
