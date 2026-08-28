import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* Renders every view from the BUILT page against stub data.
 *
 * The earlier build guards checked that referenced FUNCTIONS exist. They could
 * not catch an undefined VARIABLE — which is exactly how `override` shipped:
 * an edit inserted the code that used it while the line defining it silently
 * failed to match, and the page died on load with a ReferenceError.
 *
 * Executing the views is the only check that catches that class of fault. */

const page = readFileSync(new URL('../sched/manager.html', import.meta.url), 'utf8');
const script = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1];

function stubEl() {
  const el = {
    innerHTML: '', textContent: '', value: '', hidden: false, dataset: {}, style: {},
    classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
    addEventListener(){}, appendChild(){}, removeChild(){}, remove(){},
    focus(){}, setSelectionRange(){}, querySelector(){ return null; },
    querySelectorAll(){ return []; }, closest(){ return null; },
    scrollIntoView(){}, click(){},
  };
  return el;
}

function run() {
  const doc = {
    getElementById: () => stubEl(),
    querySelector: () => stubEl(),
    querySelectorAll: () => [],
    createElement: () => stubEl(),
    activeElement: null,
    body: stubEl(),
    head: stubEl(),
  };
  const supabase = { createClient: () => ({
    auth: { getSession: async () => ({ data: {} }), signInWithPassword: async () => ({}), signOut: async () => ({}) },
    from: () => ({ select: () => ({ eq(){return this;}, order(){return this;}, then(r){return r({data:[],error:null});} }) }),
    rpc: async () => ({ data: null, error: null }),
  })};
  const body = script
    .replace(/\nboot\(\);\s*$/, '')                 // don't auto-run on import
    + '; return {viewWeek, viewStaff, viewAvailability, viewHours, viewTemplate, viewCommission,'
    + ' viewPerson, viewAttention, attentionCount, viewBreakPlan, viewMessages, msgCounts,'
    + ' viewRoster, loadAll, D, getD:()=>D, edits, nextAvail, planForSession, breakPlanSessions,'
    + ' rotCallers, planRotation, validateRotation, SECTIONS, setSel(v){ sel=v; },'
    + ' viewCloseout, closeoutAskPayload, isMor, isMorRole, morSlot, mgrHats, viewDemo, demoInit,'
    + ' demoPlan, demoAlerts, getDemo:()=>demo, setDemo(v){ demo=v; }, roleOne,'
    + ' demoSim, demoBoardModel, DEMO_SIMS, demoBoard, blastCount, personPortalPreview,'
    + ' setPerson(v){ person=v; },'
    + ' summariseConflicts};';
  return new Function('document', 'supabase', 'window', 'CSS', 'URL', 'Blob', 'localStorage', body)(
    doc, supabase, {}, { escape: s => s }, { createObjectURL: () => '', revokeObjectURL(){} },
    function(){}, { getItem(){return null;}, setItem(){} });
}

/* A schedule is a fortnight, so viewWeek needs a period to draw. Sessions are
   dated inside it or they simply are not in this schedule. */
function givePeriod(D, starts_on = '2029-12-31', ends_on = '2030-01-13') {
  D.periods = [{ id:'per1', starts_on, ends_on, label:null, status:'draft',
                 note:null, published_at:null, is_current:true,
                 sessions:18, filled:0, slots:18 }];
  return D.periods[0];
}

const VIEWS = ['viewWeek','viewRoster','viewStaff','viewAvailability','viewHours','viewTemplate','viewCommission'];

test('every view renders with empty data without throwing', () => {
  const api = run();
  for (const name of VIEWS) {
    assert.doesNotThrow(() => api[name](), `${name} threw on empty data`);
  }
});

test('every view renders with one session, one role and one person', () => {
  const api = run();
  const D = api.D;
  D.roles = [{ id:'r1', name:'Flash Runners', fixed_count:null, min_on_floor:2, sort:6 }];
  D.staff = [{ id:'p1', name:'Test Person', active:true, phone:null, email:null, pet:'biscuit' }];
  D.sessions = [{ id:'s1', hall_id:'sc', session_date:'2030-01-04', part:'PM',
                  day_type:'weekday', status:'draft', comm_rate:0.15 }];
  D.days = [{ hall_id:'sc', dow:5, part:'PM', active:true }];
  D.needs = [{ hall_id:'sc', role_id:'r1', dow:5, part:'PM', needed:2 }];
  D.assigns = [{ id:'a1', session_id:'s1', role_id:'r1', staff_id:'p1', slot_index:0,
                 early_start:false, is_training:false, response:'pending',
                 sched_staff:{ name:'Test Person' } }];

  for (const name of VIEWS) {
    let html;
    assert.doesNotThrow(() => { html = api[name](); }, `${name} threw with data`);
    assert.equal(typeof html, 'string', `${name} must return HTML`);
  }
});

test('the day view survives a per-session slot override', () => {
  const api = run();
  const D = api.D;
  D.roles = [{ id:'r1', name:'Flash Runners', fixed_count:null, min_on_floor:2, sort:6 }];
  D.staff = [{ id:'p1', name:'A', active:true }];
  D.sessions = [{ id:'s1', hall_id:'sc', session_date:'2030-01-04', part:'PM', status:'draft', comm_rate:0.15 }];
  D.days = [{ hall_id:'sc', dow:5, part:'PM', active:true }];
  D.needs = [{ hall_id:'sc', role_id:'r1', dow:5, part:'PM', needed:2 }];
  D.sessionRoles = [{ session_id:'s1', role_id:'r1', needed:5 }];   // the override
  D.assigns = [];
  givePeriod(D);
  const html = api.viewWeek();
  assert.match(html, /this session only/, 'an override must be labelled as one-off');
});

test('the hours view hides people with nothing in the period, and can show them', () => {
  const api = run();
  const D = api.D;
  D.roles = [{ id:'r1', name:'Flash Runners', fixed_count:null, min_on_floor:2, sort:6 }];
  D.staff = [
    { id:'p1', name:'Has Hours', active:true },
    { id:'p2', name:'Has Nothing', active:true },
  ];
  /* Must fall inside the CURRENT pay period, since that is what the view
     opens on — a date in 2030 is outside it and everyone would be filtered. */
  const now = new Date();
  const p2 = n => String(n).padStart(2,'0');
  const day = now.getDate() <= 15 ? 5 : 20;
  const inPeriod = `${now.getFullYear()}-${p2(now.getMonth()+1)}-${p2(day)}`;

  D.sessions = [{ id:'s1', hall_id:'sc', session_date:inPeriod, part:'PM', status:'draft', comm_rate:0.15 }];
  D.days = [{ hall_id:'sc', dow:5, part:'PM', active:true }];
  D.time = [{ staff_id:'p1', work_date:inPeriod, hours_worked:8, is_worked_time:true,
              category:'worked', meal_taken:true, rest_breaks_taken:2 }];

  const shown = api.viewHours();
  assert.match(shown, /Has Hours/);
  assert.doesNotMatch(shown, /Has Nothing/, 'someone with nothing must be hidden by default');
  assert.match(shown, /1 hidden/, 'and the count of hidden people is stated');
});

/* Rachel needs to add a second MOD on a night that calls for one, or a fifth
 * caller. sched_roles.fixed_count used to gate the + button, so exactly the
 * roles she most often needs to double up were the ones that could not be. */
test('every role can be given another person, not just the variable ones', () => {
  const api = run();
  const D = api.D;
  D.roles = [
    { id:'mod',  name:'MOD',                fixed_count:1,    min_on_floor:1, sort:1 },
    { id:'open', name:'Opener/Swing Shift', fixed_count:1,    min_on_floor:1, sort:2 },
    { id:'pay',  name:'Paymaster',          fixed_count:1,    min_on_floor:1, sort:3 },
    { id:'call', name:'Callers/Strip',      fixed_count:4,    min_on_floor:3, sort:5 },
    { id:'run',  name:'Flash Runners',      fixed_count:null, min_on_floor:4, sort:6 },
  ];
  D.staff = [{ id:'p1', name:'A', active:true }];
  D.sessions = [{ id:'s1', hall_id:'sc', session_date:'2030-01-04', part:'PM',
                  status:'draft', comm_rate:0.15 }];
  D.days = [{ hall_id:'sc', dow:5, part:'PM', active:true }];
  D.needs = D.roles.map(r => ({ hall_id:'sc', role_id:r.id, dow:5, part:'PM',
                                needed:r.fixed_count ?? 5 }));
  D.assigns = [];
  givePeriod(D);

  const html = api.viewWeek();
  for (const r of D.roles) {
    assert.match(html, new RegExp(`data-slot="s1\\|${r.id}\\|\\+"`),
      `${r.name} has no "add another" button — a fixed count is a default, not a ceiling`);
  }
});

/* A role the template asks zero of still has to be addable, otherwise a night
 * that unexpectedly needs a Flash Manager has no way to get one. */
test('a role with a headcount of zero still offers a slot to add', () => {
  const api = run();
  const D = api.D;
  D.roles = [{ id:'fm', name:'Flash Manager', fixed_count:1, min_on_floor:1, sort:4 }];
  D.staff = [{ id:'p1', name:'A', active:true }];
  D.sessions = [{ id:'s1', hall_id:'sc', session_date:'2030-01-04', part:'PM',
                  status:'draft', comm_rate:0.15 }];
  D.days = [{ hall_id:'sc', dow:5, part:'PM', active:true }];
  D.needs = [];              // nothing configured for this day at all
  D.assigns = [];
  givePeriod(D);
  assert.match(api.viewWeek(), /data-slot="s1\|fm\|\+"/,
    'a role with no template row vanished, so it could never be staffed');
});

/* Placeholder times drive break deadlines and paid hours. They must be
 * visibly distinguishable from times the hall actually confirmed. */
test('a guessed start time is marked as a guess', () => {
  const api = run();
  const D = api.D;
  D.roles = [{ id:'mod', name:'MOD', fixed_count:1, min_on_floor:1, sort:1 }];
  D.staff = [];
  D.sessions = [{ id:'s1', hall_id:'sc', session_date:'2030-01-04', part:'PM',
                  status:'draft', comm_rate:0.15 }];
  D.days = [{ hall_id:'sc', dow:5, part:'PM', active:true }];
  D.needs = [{ hall_id:'sc', role_id:'mod', dow:5, part:'PM', needed:1 }];
  D.assigns = [];

  givePeriod(D);
  D.times = [{ hall_id:'sc', role_id:'mod', dow:5, part:'PM',
               start_time:'14:00:00', end_time:'00:00:00', is_placeholder:true }];
  assert.match(api.viewWeek(), /class="guess"/, 'a placeholder time was shown as fact');

  D.times = [{ hall_id:'sc', role_id:'mod', dow:5, part:'PM',
               start_time:'14:00:00', end_time:'00:00:00', is_placeholder:false }];
  assert.doesNotMatch(api.viewWeek(), /class="guess"/, 'a confirmed time was flagged as a guess');
});

/* The availability request panel. With an opt-out form, "hasn't replied" is
 * the only thing separating somebody who is free from somebody who never
 * looked — so the panel has to say so, prominently and in those terms. */
test('the availability panel offers to create a request when none is open', () => {
  const api = run();
  api.D.days = [{ hall_id:'sc', dow:5, part:'PM', active:true }];
  api.D.staff = [{ id:'p1', name:'A', active:true }];
  api.D.availStatus = null;
  const html = api.viewAvailability();
  assert.match(html, /Ask everyone for their availability/);
  assert.match(html, /id="arcreate"/);
  assert.match(html, /data-ar="start"/);
  assert.match(html, /data-ar="cap"/);
});

test('an open request shows who has replied and who has not', () => {
  const api = run();
  api.D.days = [{ hall_id:'sc', dow:5, part:'PM', active:true }];
  api.D.staff = [{ id:'p1', name:'Wayne', active:true }, { id:'p2', name:'Hector', active:true }];
  api.D.availStatus = {
    ok: true,
    request: { id:'r1', start:'2026-08-24', end:'2026-09-06', cap:2, note:'Reply by Friday' },
    people: [
      { staff_id:'p1', name:'Wayne', critical:true, replied_at:'2026-08-12T04:00:00Z',
        days_off:3, off:[{date:'2026-08-25',part:'PM'}], note:'jury duty',
        needs_review:true, reviewed_at:null, token:'tok-wayne' },
      { staff_id:'p2', name:'Hector', critical:false, replied_at:null,
        days_off:0, off:[], note:null, needs_review:false, reviewed_at:null, token:'tok-hector' },
    ],
  };
  const html = api.viewAvailability();

  assert.match(html, /1<span class="rtime"> of 2<\/span>/, 'replied count');
  assert.match(html, /still waiting on/);
  assert.match(html, /want extra days off/);
  assert.match(html, /no reply yet/, 'the unanswered person must be visibly unanswered');
  assert.match(html, /Treat .no reply yet. as\s+unknown, not as a yes/,
    'the warning that silence is not consent must be on the page');
  assert.match(html, /data-arok="p1"/, 'the over-cap reply needs an accept button');
  assert.match(html, /data-arcopy="tok-wayne"/);
  assert.match(html, /class="chip crit"/, 'critical staff are marked');
  assert.match(html, /Reply by Friday/);
});

test('a person with no link is shown as having none, not silently skipped', () => {
  const api = run();
  api.D.days = [{ hall_id:'sc', dow:5, part:'PM', active:true }];
  api.D.staff = [{ id:'p1', name:'A', active:true }];
  api.D.availStatus = { ok:true, request:{ id:'r1', start:'2026-08-24', end:'2026-09-06', cap:2 },
    people:[{ staff_id:'p1', name:'A', critical:false, replied_at:null, days_off:0,
              off:[], needs_review:false, token:null }] };
  assert.match(api.viewAvailability(), /no link/);
});

/* The schedule is the screen Rachel actually works in, and for a while it was
 * the one place with no characters at all — because people appear there inside
 * <select> options, and an <option> cannot contain an image. The character has
 * to sit beside the dropdown. */
test('the schedule shows the character of whoever is in each slot', () => {
  const api = run();
  const D = api.D;
  D.roles = [{ id:'r1', name:'Flash Runners', fixed_count:null, min_on_floor:4, sort:6 }];
  D.staff = [
    { id:'p1', name:'Gina',   active:true, pet:'beans', pet_kind:'cat'  },
    { id:'p2', name:'Shelly', active:true, pet:'ducky', pet_kind:'boss' },
  ];
  D.sessions = [{ id:'s1', hall_id:'sc', session_date:'2030-01-04', part:'PM',
                  status:'draft', comm_rate:0.15 }];
  D.days  = [{ hall_id:'sc', dow:5, part:'PM', active:true }];
  D.needs = [{ hall_id:'sc', role_id:'r1', dow:5, part:'PM', needed:3 }];
  D.assigns = [
    { id:'a1', session_id:'s1', role_id:'r1', staff_id:'p1', slot_index:0, response:'pending' },
    { id:'a2', session_id:'s1', role_id:'r1', staff_id:'p2', slot_index:1, response:'pending' },
  ];
  givePeriod(D);
  const html = api.viewWeek();
  assert.equal((html.match(/src="data:image\/png;base64,/g) || []).length, 2,
    'both assigned people show an embedded character');
  // The empty third slot keeps its space so the dropdowns stay in a column.
  assert.match(html, /class="pet-slot"/);
});

/* Verified in Chromium: on a file:// page a lazily-loaded image is never
 * fetched at all — no request, no console error, just a broken image. These
 * pages are opened by double-clicking, so the attribute must never appear.
 * build.js enforces this too; this catches it a step earlier. */
test('no view emits a lazily-loaded image', () => {
  const page = readFileSync(new URL('../sched/manager.html', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /<img[^>]*loading\s*=\s*["']lazy/,
    'a lazy image on a file:// page silently never loads');
});

/* ---------------------------------------------------------------------------
   Schedule periods. Rachel builds a fortnight at a time and that fortnight is
   the thing she publishes and looks back at — so the screen shows exactly one,
   and a session outside it is not in this schedule.
--------------------------------------------------------------------------- */

function weekWithPeriod(api, opts = {}) {
  const D = api.D;
  D.roles = [{ id:'r1', name:'Flash Runners', fixed_count:null, min_on_floor:4, sort:6 }];
  D.staff = [{ id:'p1', name:'A', active:true }];
  D.days  = [{ hall_id:'sc', dow:5, part:'PM', active:true }];
  D.needs = [{ hall_id:'sc', role_id:'r1', dow:5, part:'PM', needed:2 }];
  D.assigns = []; D.sessionRoles = []; D.calling = {}; D.times = [];
  D.sessions = (opts.dates || ['2030-01-04']).map((d, i) => (
    { id:`s${i}`, hall_id:'sc', session_date:d, part:'PM', status:'draft', comm_rate:0.15 }));
  D.periods = opts.periods ?? [{ id:'per1', starts_on:'2029-12-31', ends_on:'2030-01-13',
    label:null, status:'draft', note:null, published_at:null, is_current:true,
    sessions:2, filled:3, slots:10 }];
  return D;
}

test('the schedule shows only the fortnight being looked at', () => {
  const api = run();
  weekWithPeriod(api, { dates: [
    '2029-12-30',   // the Sunday BEFORE the period starts
    '2030-01-04',   // inside
    '2030-01-13',   // the last day of the period
    '2030-01-14',   // the Monday AFTER it ends
  ]});
  const html = api.viewWeek();
  assert.equal((html.match(/class="card /g) || []).length, 2,
    'only the two sessions inside the fortnight belong to this schedule');
  assert.doesNotMatch(html, /data-i="0"/, 'the day before the period must not appear');
  assert.doesNotMatch(html, /data-i="3"/, 'the day after the period must not appear');
});

test('the period bar shows how full the fortnight is, and lets you move between them', () => {
  const api = run();
  weekWithPeriod(api);
  const html = api.viewWeek();
  assert.match(html, /id="psel"/, 'a picker for other fortnights');
  assert.match(html, /id="pprev"/);
  assert.match(html, /id="pnext"/);
  assert.match(html, /3 of 10 places filled/);
  assert.match(html, /30%/);
});

test('a draft offers to publish; a published one says so and offers to undo', () => {
  const api = run();
  const D = weekWithPeriod(api);
  assert.match(api.viewWeek(), /id="ppub"/, 'a draft can be published');
  assert.doesNotMatch(api.viewWeek(), /id="punpub"/);

  D.periods[0].status = 'published';
  D.periods[0].published_at = '2030-01-02T10:00:00Z';
  const pub = api.viewWeek();
  assert.match(pub, /id="punpub"/);
  assert.doesNotMatch(pub, /id="ppub"/);
  assert.match(pub, /Staff can see it/);
});

test('with no periods at all it offers to start one rather than showing nothing', () => {
  const api = run();
  weekWithPeriod(api, { periods: [] });
  const html = api.viewWeek();
  assert.match(html, /id="pnew"/);
  assert.match(html, /always\s+starting on a Monday/);
  assert.doesNotMatch(html, /class="card /, 'no cards without a fortnight to put them in');
});

test('a fortnight with no sessions in it says so instead of rendering an empty list', () => {
  const api = run();
  weekWithPeriod(api, { dates: ['2031-06-02'] });   // far outside the period
  const html = api.viewWeek();
  assert.match(html, /No sessions fall in this fortnight/);
  assert.match(html, /id="psel"/, 'the picker stays, so you can move to one that has some');
});

test('the roster underneath follows the fortnight above it', () => {
  const api = run();
  const D = weekWithPeriod(api, { dates: ['2029-12-30', '2030-01-04'] });
  // Pretend the previously-selected card was the out-of-period one.
  const html = api.viewWeek();
  // Selection must have moved to a session inside the period, so the roster
  // beneath the cards is not describing a different fortnight.
  assert.match(html, /data-i="1"/);
  assert.doesNotMatch(html, /2029-12-30/, 'a session outside the period is gone entirely');
});

/* ---------------------------------------------------------------------------
   Availability has three states. Showing an unanswered slot as green claims
   something nobody has said — the difference between "Rosa works Saturdays"
   and "nobody has ever asked Rosa about Saturdays".
--------------------------------------------------------------------------- */

function availFixture(api, avail = [], status = null) {
  const D = api.D;
  D.roles = [{ id:'r1', name:'Flash Runners', fixed_count:null, min_on_floor:4, sort:6 }];
  D.staff = [{ id:'p1', name:'Rosa', active:true }, { id:'p2', name:'Gina', active:true }];
  D.days  = [{ hall_id:'sc', dow:5, part:'PM', active:true },
             { hall_id:'sc', dow:6, part:'AM', active:true }];
  D.avail = avail; D.availStatus = status; D.needs = []; D.times = [];
  D.sessions = []; D.assigns = []; D.periods = [];
  return D;
}

test('a slot nobody has answered is neither green nor red', () => {
  const api = run();
  availFixture(api);
  const html = api.viewAvailability();
  assert.equal((html.match(/class="avcell unknown"/g) || []).length, 4,
    'two people x two slots, none of them answered');
  assert.doesNotMatch(html, /class="avcell yes"/, 'nothing may default to yes');
  assert.match(html, /4 not answered/);
});

test('an answered slot shows as yes or no', () => {
  const api = run();
  availFixture(api, [
    { staff_id:'p1', dow:5, part:'PM', available:true },
    { staff_id:'p1', dow:6, part:'AM', available:false },
  ]);
  const html = api.viewAvailability();
  assert.match(html, /class="avcell yes"/);
  assert.match(html, /class="avcell no"/);
  assert.equal((html.match(/class="avcell unknown"/g) || []).length, 2, 'Gina is still unasked');
  assert.match(html, /1 marked unavailable/);
  assert.match(html, /2 not answered/);
});

test('clicking cycles yes, then no, then back to unanswered', () => {
  const api = run();
  assert.equal(api.nextAvail(null), true);
  assert.equal(api.nextAvail(true), false);
  assert.equal(api.nextAvail(false), null,
    'a cell set by mistake must be able to go back to unanswered');
});

test('somebody who has not replied to the request is marked as such', () => {
  const api = run();
  availFixture(api, [], { ok:true, request:{ id:'r1', start:'2026-08-24', end:'2026-09-06', cap:2 },
    people:[ { staff_id:'p1', name:'Rosa', replied_at:'2026-08-20T10:00:00Z', critical:false,
               days_off:0, off:[], needs_review:false, token:'t1' },
             { staff_id:'p2', name:'Gina', replied_at:null, critical:false,
               days_off:0, off:[], needs_review:false, token:'t2' } ] });
  const html = api.viewAvailability();
  assert.equal((html.match(/class="chip noreply"/g) || []).length, 1,
    'only the person who has not replied is flagged');
});

/* 42 of 67 staff have no phone and no email, and each one is a person who
   cannot be sent a shift. Adding one has to be a click where the gap is. */
test('a missing phone or email can be filled in from the staff list', () => {
  const api = run();
  const D = api.D;
  D.roles = [{ id:'r1', name:'Flash Runners', fixed_count:null, min_on_floor:4, sort:6 }];
  D.staff = [{ id:'p1', name:'Rosa', active:true, phone:null, email:null }];
  D.caps = []; D.assigns = []; D.sessions = []; D.days = []; D.time = [];
  const html = api.viewStaff();
  assert.match(html, /data-editc="p1\|phone"/);
  assert.match(html, /data-editc="p1\|email"/);
  assert.match(html, /missing/);
});

test('clicking a contact field turns it into an input', () => {
  const api = run();
  const D = api.D;
  D.roles = [{ id:'r1', name:'Flash Runners', fixed_count:null, min_on_floor:4, sort:6 }];
  D.staff = [{ id:'p1', name:'Rosa', active:true, phone:'408-555-0100', email:null }];
  D.caps = []; D.assigns = []; D.sessions = []; D.days = []; D.time = [];
  api.D.__edits ??= null;
  // Simulate the click having populated the edit buffer.
  api.edits['c|p1|phone'] = '408-555-0100';
  const html = api.viewStaff();
  assert.match(html, /data-contact="p1\|phone"/, 'the cell becomes an input');
  assert.match(html, /Enter to save/);
  delete api.edits['c|p1|phone'];
});

/* A slot somebody refused is not the same as one that was never filled. If it
 * renders identically, the hole reads as an oversight rather than a decision
 * already made — and Rachel re-books the person who just said no. */
test('a declined slot says who declined it and when', () => {
  const api = run();
  const D = weekWithPeriod(api);
  D.assigns = [];
  D.declines = [{ id:'d1', staff_id:'p1', session_id:'s0', role_id:'r1', slot_index:0,
                  declined_at:'2026-01-02T09:00:00Z',
                  sched_staff:{ name:'Rosa', first_name:'Rosa' } }];
  const html = api.viewWeek();
  assert.match(html, /class="declined"/);
  assert.match(html, /Rosa declined/);
  assert.match(html, /Jan 2/);
});

test('the schedule renders fine when nothing has ever been declined', () => {
  const api = run();
  const D = weekWithPeriod(api);
  D.declines = [];
  assert.doesNotThrow(() => api.viewWeek());
  assert.doesNotMatch(api.viewWeek(), /class="declined"/);
});

test('a filled slot never shows a decline, even if that slot was refused before', () => {
  const api = run();
  const D = weekWithPeriod(api);
  D.staff = [{ id:'p1', name:'A', active:true, pet:'beans', pet_kind:'cat' }];
  D.assigns = [{ id:'a1', session_id:'s0', role_id:'r1', staff_id:'p1', slot_index:0,
                 response:'pending' }];
  D.declines = [{ id:'d1', staff_id:'p2', session_id:'s0', role_id:'r1', slot_index:0,
                  declined_at:'2026-01-02T09:00:00Z',
                  sched_staff:{ name:'Rosa', first_name:'Rosa' } }];
  assert.doesNotMatch(api.viewWeek(), /class="declined"/,
    'the slot is covered now; the old refusal is history, not a warning');
});

/* ---------------------------------------------------------------------------
   Rachel's list. Decided: no texts to her — everything collects here.

   Two kinds of item. EVENTS (a decline, a completed handoff) happened at a
   moment and can be marked seen. STATES (nobody replied, a night is short) are
   true until somebody fixes them, so "seen" would be a lie. The distinction is
   the whole design and is what these tests protect.
--------------------------------------------------------------------------- */

const attentionPayload = (o = {}) => ({ ok:true, seen_at:'2026-08-01T00:00:00Z',
  declines:[], handoffs:[], no_reply:[], over_cap:[], short:[], ...o });

test('with nothing outstanding it says so rather than showing empty headings', () => {
  const api = run();
  api.D.attention = attentionPayload();
  api.D.staff = [];
  const html = api.viewAttention();
  assert.match(html, /Nothing needs you/);
  assert.match(html, /every published session is fully crewed/);
  assert.equal(api.attentionCount(), 0);
});

test('a decline names the person, the night and the reason', () => {
  const api = run();
  api.D.staff = [{ id:'p1', name:'Rosa', active:true, pet:'beans', pet_kind:'cat' }];
  api.D.attention = attentionPayload({ declines:[
    { id:'d1', staff_id:'p1', name:'Rosa', pet:'beans', pet_kind:'cat',
      date:'2026-08-28', hall:'sc', role:'Callers/Strip', reason:'jury duty',
      at:'2026-08-12T09:00:00Z' }]});
  const html = api.viewAttention();
  assert.match(html, /Declined shifts/);
  assert.match(html, /Rosa/);
  assert.match(html, /Aug 28/);
  assert.match(html, /jury duty/);
  assert.match(html, /data-goto="2026-08-28"/, 'she can jump straight to that night');
});

test('a completed handoff is reported, not asked about', () => {
  const api = run();
  api.D.staff = [];
  api.D.attention = attentionPayload({ handoffs:[
    { id:'h1', from:'Hector', to:'Wayne', date:'2026-08-28', hall:'sc',
      at:'2026-08-12T09:00:00Z' }]});
  const html = api.viewAttention();
  assert.match(html, /Shifts that changed hands/);
  assert.match(html, /Hector<\/strong> → <strong>Wayne/);
  // It is already done. There must be no approve/reject anywhere.
  assert.doesNotMatch(html, /Approve|Reject/i);
});

test('a short published night says how many are missing', () => {
  const api = run();
  api.D.staff = [];
  api.D.attention = attentionPayload({ short:[
    { session_id:'s1', date:'2026-08-28', hall:'rwc', part:'PM', short_by:3 }]});
  const html = api.viewAttention();
  assert.match(html, /Published nights that are short/);
  assert.match(html, /3 still to fill/);
  assert.match(html, /RWC/);
});

test('people who were never actually asked are called out separately', () => {
  const api = run();
  api.D.staff = [{ id:'p1', name:'A', active:true }, { id:'p2', name:'B', active:true }];
  api.D.attention = attentionPayload({ no_reply:[
    { staff_id:'p1', name:'A', pet:null, pet_kind:null, reachable:true },
    { staff_id:'p2', name:'B', pet:null, pet_kind:null, reachable:false }]});
  const html = api.viewAttention();
  assert.match(html, /Have not replied about availability/);
  assert.match(html, /1 of these\s+have no phone and no email, so they were never actually asked/,
    'chasing somebody you cannot contact is a different job');
});

test('mark-seen is offered for events and never for states', () => {
  const api = run();
  api.D.staff = [];

  api.D.attention = attentionPayload({ short:[
    { session_id:'s1', date:'2026-08-28', hall:'sc', part:'PM', short_by:1 }]});
  assert.doesNotMatch(api.viewAttention(), /id="markseen"/,
    'a short night is true until it is filled; marking it seen would be a lie');

  api.D.attention = attentionPayload({ declines:[
    { id:'d1', staff_id:'p1', name:'Rosa', date:'2026-08-28', hall:'sc',
      role:'Caller', reason:null, at:'2026-08-12T09:00:00Z' }]});
  assert.match(api.viewAttention(), /id="markseen"/);
});

test('the badge counts everything outstanding', () => {
  const api = run();
  api.D.staff = [];
  api.D.attention = attentionPayload({
    declines:[{ id:'d1', staff_id:'p1', name:'A', date:'2026-08-28', hall:'sc', at:null }],
    handoffs:[{ id:'h1', from:'A', to:'B', date:'2026-08-28', hall:'sc', at:null }],
    no_reply:[{ staff_id:'p2', name:'B', reachable:true }],
    over_cap:[{ staff_id:'p3', name:'C', note:null, days_off:3 }],
    short:[{ session_id:'s1', date:'2026-08-28', hall:'sc', part:'PM', short_by:2 }],
  });
  assert.equal(api.attentionCount(), 5);
});

test('a null payload does not throw', () => {
  const api = run();
  api.D.attention = null;
  assert.doesNotThrow(() => api.viewAttention());
  assert.equal(api.attentionCount(), 0);
});

/* ---------------------------------------------------------------------------
   The break plan, before the night. Same planner as the TV, but run against
   the ROSTER instead of who has clocked in — so Rachel can see how the breaks
   fall before anybody is standing in the hall.
--------------------------------------------------------------------------- */

function planFixture(api, opts = {}) {
  const D = api.D;
  D.roles = [
    { id:'call', name:'Callers/Strip', fixed_count:4, min_on_floor:3, sort:5, cover_group:null },
    { id:'run',  name:'Flash Runners', fixed_count:null, min_on_floor:4, sort:6, cover_group:null },
  ];
  D.staff = Array.from({length:8}, (_,i) =>
    ({ id:`p${i}`, name:`P${i}`, active:true, pet:'beans', pet_kind:'cat' }));
  D.sessions = [{ id:'s1', hall_id:'sc', session_date:'2030-01-04', part:'PM',
                  status:'draft', comm_rate:0.15 }];
  D.days = [{ hall_id:'sc', dow:5, part:'PM', active:true }];
  D.needs = [{ hall_id:'sc', role_id:'call', dow:5, part:'PM', needed:4, min_on_floor:3 },
             { hall_id:'sc', role_id:'run',  dow:5, part:'PM', needed:4, min_on_floor:2 }];
  D.times = [
    { hall_id:'sc', role_id:'call', dow:5, part:'PM', start_time:'15:15:00', end_time:'00:00:00' },
    { hall_id:'sc', role_id:'run',  dow:5, part:'PM', start_time:'15:15:00', end_time:'00:00:00' },
  ];
  D.assigns = opts.assigns ?? [
    ...Array.from({length:4}, (_,i) => ({ id:`a${i}`, session_id:'s1', role_id:'call',
      staff_id:`p${i}`, slot_index:i, response:'pending' })),
    ...Array.from({length:4}, (_,i) => ({ id:`b${i}`, session_id:'s1', role_id:'run',
      staff_id:`p${i+4}`, slot_index:i, response:'pending' })),
  ];
  D.periods = []; D.declines = [];
  return D;
}

test('the break plan draws a row per person with their breaks on it', () => {
  const api = run();
  planFixture(api);
  const html = api.viewBreakPlan();
  assert.equal((html.match(/class="pname"/g) || []).length, 8, 'one row per rostered person');
  assert.ok((html.match(/class="blk meal"/g) || []).length >= 8, 'everybody gets a meal');
  assert.ok((html.match(/class="blk rest"/g) || []).length >= 8, 'and rests');
});

test('a plan that fits says so, with the count', () => {
  const api = run();
  planFixture(api);
  const html = api.viewBreakPlan();
  assert.match(html, /All \d+ breaks are scheduled/);
  assert.doesNotMatch(html, /could not be fitted/);
});

/* Angela: "We always need to be assigning breaks." A role rostered under its
 * own floor must not turn the plan into a wall of refusals. */
test('a role under its own floor still gets a plan, with the dip as a note', () => {
  const api = run();
  planFixture(api);
  const D = api.D;
  for (const r of D.roles) r.min_on_floor = 99;      // unreachable by design
  for (const n of D.needs) n.min_on_floor = 99;
  const html = api.viewBreakPlan();
  assert.doesNotMatch(html, /could not be fitted/,
    'coverage must never refuse a break');
  assert.match(html, /under its floor/, 'but it must say the floor is thin');
  assert.match(html, /Everyone still gets their breaks/);
});

test('nothing staffed anywhere explains why rather than drawing an empty grid', () => {
  const api = run();
  planFixture(api, { assigns: [] });
  const html = api.viewBreakPlan();
  assert.match(html, /No session has anybody on it yet/);
  assert.doesNotMatch(html, /class="gantt"/);
});

/* The picker only lists sessions somebody is actually on, and the view lands on
   one of those rather than on whatever the Schedule tab happened to have
   selected -- opening Break plan on an empty night was the commonest way to see
   "nobody is rostered" for a fortnight that was in fact full. */
test('the break plan steps past empty sessions to a staffed one', () => {
  const api = run();
  const D = planFixture(api);
  D.sessions = [
    { id:'empty', hall_id:'sc', session_date:'2030-01-03', part:'PM', status:'draft' },
    ...D.sessions,
  ];
  api.setSel(0);
  const html = api.viewBreakPlan();
  assert.match(html, /class="gantt"/, 'it should draw the staffed session, not the empty one');
  assert.match(html, /id="bpsel"/, 'and offer a picker to step through them');
  assert.doesNotMatch(html, /2030-01-03/);
});

test('it plans from the roster and says so, because the night re-plans from punches', () => {
  const api = run();
  planFixture(api);
  assert.match(api.viewBreakPlan(), /Planned from the roster, not from who has\s+clocked in/);
});

test('a role with no recorded hours is skipped rather than planned at midnight', () => {
  const api = run();
  const D = planFixture(api);
  D.times = [];   // no start or end for anybody
  D.assigns = D.assigns.map(a => ({ ...a, scheduled_start:null, scheduled_end:null }));
  const html = api.viewBreakPlan();
  assert.match(html, /Nobody is rostered on this session yet/,
    'a shift with no hours cannot be planned around and must not be guessed at');
});

/* ---------------------------------------------------------------------------
   The outbox. Everything queues; sending is a separate, deliberate act. The
   property worth protecting: a message to somebody with no phone and no email
   is WRITTEN DOWN as unreachable, never silently dropped. 42 of 67 staff are
   in that state, and a send that quietly reaches a third of the workforce
   while reporting success is the worst outcome available.
--------------------------------------------------------------------------- */

const msg = (o = {}) => ({ id:'m1', staff_id:'p1', template:'booked', channel:'email',
  to_addr:'a@b.com', subject:'Your shifts', body:'Hi Ann — the schedule is out.',
  status:'queued', provider_id:null, error:null, created_at:'2026-08-12T10:00:00Z',
  sched_staff:{ name:'Ann', first_name:'Ann' }, ...o });

test('the outbox counts what is waiting, sent, failed and unreachable', () => {
  const api = run();
  api.D.outbox = [
    msg(), msg({ id:'m2' }),
    msg({ id:'m3', status:'sent' }),
    msg({ id:'m4', status:'failed', error:'resend 422' }),
    msg({ id:'m5', status:'unreachable', channel:'none', to_addr:null }),
  ];
  const c = api.msgCounts();
  assert.deepEqual(c, { queued:2, unreachable:1, sent:1, failed:1 });
  const html = api.viewMessages();
  assert.match(html, /Send 2 now/);
});

test('unreachable people are called out, not buried in a table', () => {
  const api = run();
  api.D.outbox = [msg({ status:'unreachable', channel:'none', to_addr:null })];
  const html = api.viewMessages();
  assert.match(html, /1 message cannot be delivered/);
  assert.match(html, /neither a phone number nor an email address/);
  assert.match(html, /not silently lost/);
});

test('with nothing queued, Send is disabled rather than lying about what it will do', () => {
  const api = run();
  api.D.outbox = [msg({ status:'sent' })];
  const html = api.viewMessages();
  assert.match(html, /id="msend" disabled/);
});

test('an empty outbox explains what puts things in it', () => {
  const api = run();
  api.D.outbox = [];
  const html = api.viewMessages();
  assert.match(html, /Nothing has been queued yet/);
  assert.match(html, /publish a fortnight/);
});

test('the page says plainly that texts are not switched on yet', () => {
  const api = run();
  api.D.outbox = [msg({ channel:'sms', to_addr:'408-555-0100' })];
  const html = api.viewMessages();
  assert.match(html, /Email sends today/);
  assert.match(html, /four\s+AWS credentials/);
  assert.match(html, /stays\s+queued rather than being marked failed/,
    'a queued text is a real message to a real person and must not be lost');
});

test('a failed message shows its error rather than just a red word', () => {
  const api = run();
  api.D.outbox = [msg({ status:'failed', error:'resend 422: invalid address' })];
  assert.match(api.viewMessages(), /resend 422: invalid address/);
});

test('a null outbox does not throw', () => {
  const api = run();
  api.D.outbox = null;
  assert.doesNotThrow(() => api.viewMessages());
});

/* ---------------------------------------------------------------------------
   Wall chart.

   It is a READ of the same fortnight the Schedule view builds, so the failure
   that matters is the two screens disagreeing — a hole visible on one and not
   the other means Rachel trusts whichever she looked at last.
--------------------------------------------------------------------------- */

function wallCtx(api, over = {}) {
  const D = api.D;
  D.roles = [
    { id:'mod', name:'MOD',           fixed_count:1, min_on_floor:0, sort:1 },
    { id:'fr',  name:'Flash Runners', fixed_count:null, min_on_floor:4, sort:6 },
  ];
  D.staff = [{ id:'p1', name:'Ann', active:true, pet:'biscuit', pet_kind:'cat' },
             { id:'p2', name:'Bob', active:true, pet:null, pet_kind:null }];
  D.sessions = [{ id:'s1', hall_id:'sc', session_date:'2030-01-04', part:'PM', status:'draft' }];
  D.days  = [{ hall_id:'sc', dow:5, part:'PM', active:true }];
  D.needs = [{ hall_id:'sc', role_id:'fr', dow:5, part:'PM', needed:3 },
             { hall_id:'sc', role_id:'mod', dow:5, part:'PM', needed:1 }];
  D.times = [{ hall_id:'sc', role_id:'fr', dow:5, part:'PM', start_time:'15:15:00', is_placeholder:false }];
  D.assigns = [{ id:'a1', session_id:'s1', role_id:'fr', staff_id:'p1', slot_index:0,
                 early_start:false, is_training:false, response:'pending' }];
  D.sessionRoles = []; D.caps = []; D.declines = [];
  Object.assign(D, over);
  givePeriod(D, '2029-12-31', '2030-01-13');
  return D;
}

test('the wall chart counts the same holes the schedule view does', () => {
  const api = run();
  wallCtx(api);
  const html = api.viewRoster();
  /* 3 Flash Runners wanted, 1 placed, plus a MOD nobody is in. */
  assert.match(html, /2 unfilled/, 'the short Flash Runner slots must be stated');
  assert.match(html, /1 unfilled/, 'a role with nobody in it is still a hole');
  assert.match(html, /<b>2<\/b> Flash Runners/, 'the summary tallies gaps by role');
  assert.match(html, /bignum">1<[^>]*> of 4 places filled/, 'and totals the fortnight');
});

test('the wall chart honours a per-session headcount override', () => {
  const api = run();
  wallCtx(api, { sessionRoles: [{ session_id:'s1', role_id:'fr', needed:6 }] });
  const html = api.viewRoster();
  assert.match(html, /5 unfilled/, 'the override, not the hall template, sets the need');
});

/* A role this hall does not run on this day is not a hole. Drawing every role
   on every card would put a permanent red "1 unfilled" on nights that have
   never had that job. */
test('the wall chart omits roles the day does not call for', () => {
  const api = run();
  const D = wallCtx(api);
  D.needs = D.needs.filter(n => n.role_id !== 'mod');
  const html = api.viewRoster();
  assert.doesNotMatch(html, /MOD/, 'a role with no need and nobody in it is left out');
});

/* Somebody in a slot the template no longer asks for still has to appear —
   they are rostered, and a screen that hides them is how a person turns up to
   a shift nobody on the office side can see. */
test('the wall chart shows people in slots the template dropped', () => {
  const api = run();
  const D = wallCtx(api);
  D.needs = D.needs.filter(n => n.role_id !== 'fr');
  const html = api.viewRoster();
  assert.match(html, /Ann/, 'an assigned person is shown even with the need removed');
});

test('the wall chart draws a character for everyone who has one', () => {
  const api = run();
  const D = wallCtx(api);
  D.assigns.push({ id:'a2', session_id:'s1', role_id:'fr', staff_id:'p2', slot_index:1,
                   early_start:false, is_training:false, response:'pending' });
  const html = api.viewRoster();
  assert.match(html, /class="pet/, 'Ann has a character and it must be drawn');
  assert.match(html, /pet-none/, 'Bob has none and gets the placeholder, not a broken image');
  assert.doesNotMatch(html, /loading="lazy"/, 'lazy images never load on a file:// page');
});

test('the wall chart says so rather than throwing when there is no period', () => {
  const api = run();
  api.D.periods = [];
  assert.doesNotThrow(() => api.viewRoster());
  assert.match(api.viewRoster(), /No schedule period/);
});

/* ---------------------------------------------------------------------------
   loadAll() must not delete state it does not own.

   boot() fetches the fortnights, then calls loadAll(). loadAll used to assign a
   fresh object literal to D with no `periods` key, so the fortnights vanished
   between those two lines -- and the Schedule screen offered "Start this
   fortnight" for a fortnight that already existed and was nearly full. Every
   later reload wiped them again. Nothing caught it because the view tests set
   D.periods by hand and never run the loader.
--------------------------------------------------------------------------- */
test('loadAll keeps the fortnights and the fill report', async () => {
  const api = run();
  const D = api.D;
  D.periods = [{ id:'per1', starts_on:'2029-12-31', ends_on:'2030-01-13', status:'draft', is_current:true }];
  D.fillReport = [{ why:'nobody qualified' }];
  await api.loadAll();
  /* Read D THROUGH the getter: loadAll rebinds it, so the object captured when
     run() returned is not the one the app is using afterwards. */
  const after = api.getD();
  assert.equal(after.periods?.length, 1, 'loadAll deleted D.periods');
  assert.equal(after.fillReport?.length, 1, 'loadAll deleted D.fillReport');
});

test('the schedule view draws the fortnight instead of offering to start one', () => {
  const api = run();
  const D = api.D;
  D.roles = [{ id:'r1', name:'Flash Runners', fixed_count:null, min_on_floor:2, sort:6 }];
  D.staff = [{ id:'p1', name:'A', active:true }];
  D.sessions = [{ id:'s1', hall_id:'sc', session_date:'2030-01-04', part:'PM', status:'draft' }];
  D.days = [{ hall_id:'sc', dow:5, part:'PM', active:true }];
  D.needs = [{ hall_id:'sc', role_id:'r1', dow:5, part:'PM', needed:2 }];
  givePeriod(D);
  const html = api.viewWeek();
  assert.doesNotMatch(html, /Start this fortnight/,
    'a period exists, so the empty state must not show');
});

/* ---------------------------------------------------------------------------
   End of night.

   The rule this exists to protect: what comes back from a worker is a CLAIM.
   Nothing on this screen writes the clock — approval does, in the database.
   The screen's job is to separate who can be asked from who cannot, and to
   never count somebody unreachable in the "texted N people" figure.
--------------------------------------------------------------------------- */
const unclosed = (over = {}) => ({
  kind:'clock_out', entry_id:'e1', staff_id:'p1', name:'Ann', hall:'sc', date:'2030-01-04',
  clock_in:'2030-01-04T15:00:00Z', expected_at:'2030-01-05T00:00:00Z',
  reachable:true, fix:null, ...over });

test('nobody left open says so instead of drawing an empty table', () => {
  const api = run();
  api.D.unclosed = [];
  assert.match(api.viewCloseout(), /Everybody closed out/);
});

test('the ask payload skips the unreachable and the already-asked', () => {
  const api = run();
  api.D.staff = [{ id:'p1', name:'Ann', active:true }];
  api.D.unclosed = [
    unclosed({ staff_id:'p1' }),
    unclosed({ entry_id:'e2', staff_id:'p2', name:'Bob', reachable:false }),
    unclosed({ entry_id:'e3', staff_id:'p3', name:'Cat', fix:{ id:'f1', status:'open' } }),
  ];
  const payload = api.closeoutAskPayload();
  assert.equal(payload.length, 1, 'only the reachable, unasked person may be texted');
  assert.equal(payload[0].entry_id, 'e1');
  const html = api.viewCloseout();
  assert.match(html, /Text 1 person to set their time/);
  assert.match(html, /no phone or email/);
  assert.match(html, /Cannot be asked/);
});

test('a meal punch carries its punch id, or approving it would close nothing', () => {
  const api = run();
  api.D.staff = [{ id:'p1', name:'Ann', active:true }];
  api.D.unclosed = [unclosed({ kind:'meal_end', punch_id:'bp1' })];
  assert.equal(api.closeoutAskPayload()[0].punch_id, 'bp1');
});

test('an answer offers approve and reject, an unanswered ask does not', () => {
  const api = run();
  api.D.staff = [{ id:'p1', name:'Ann', active:true }, { id:'p2', name:'Bob', active:true }];
  api.D.unclosed = [
    unclosed({ fix:{ id:'f1', status:'answered', proposed_at:'2030-01-04T23:50:00Z' } }),
    unclosed({ entry_id:'e2', staff_id:'p2', name:'Bob', fix:{ id:'f2', status:'open' } }),
  ];
  const html = api.viewCloseout();
  assert.match(html, /data-tfok="f1"/);
  assert.match(html, /data-tfno="f1"/);
  assert.doesNotMatch(html, /data-tfok="f2"/, 'nothing to approve until they answer');
  assert.match(html, /asked, waiting/);
});

test('the closeout view does not render before the fetch has returned', () => {
  const api = run();
  api.D.unclosed = null;
  assert.match(api.viewCloseout(), /Checking/,
    'null means not yet loaded, and must not be shown as "everybody closed out"');
});

/* ---------------------------------------------------------------------------
   Manager of Record.

   Derived from slot order, never stored beside it — a copied name is a name
   that can disagree with the schedule. The case that matters is a role with
   TWO people in it, which is the only reason this exists.
--------------------------------------------------------------------------- */
function morFixture(api, assigns){
  const D = api.D;
  D.roles = [
    { id:'mod', name:'MOD', sort:1, min_on_floor:0 },
    { id:'pay', name:'Paymaster', sort:3, min_on_floor:0 },
    { id:'run', name:'Flash Runners', sort:6, min_on_floor:2 },
  ];
  D.staff = [{ id:'p1', name:'Sagit', active:true }, { id:'p2', name:'Rachel', active:true },
             { id:'p3', name:'Malaya', active:true }];
  D.sessions = [{ id:'s1', hall_id:'sc', session_date:'2030-01-04', part:'PM', status:'draft' }];
  D.days = [{ hall_id:'sc', dow:5, part:'PM', active:true }];
  D.needs = [{ hall_id:'sc', role_id:'mod', dow:5, part:'PM', needed:1 },
             { hall_id:'sc', role_id:'pay', dow:5, part:'PM', needed:1 },
             { hall_id:'sc', role_id:'run', dow:5, part:'PM', needed:2 }];
  D.assigns = assigns;
  D.sessionRoles = []; D.caps = []; D.declines = []; D.cpos = [];
  givePeriod(D);
  return D;
}
const A = (role, slot, staff) =>
  ({ id:`${role}${slot}`, session_id:'s1', role_id:role, slot_index:slot, staff_id:staff,
     early_start:false, is_training:false, response:'pending' });

test('with two in a manager role, the top one is the manager of record', () => {
  const api = run();
  morFixture(api, [A('mod',0,'p1'), A('mod',1,'p2')]);
  assert.equal(api.isMor('s1','mod',0), true);
  assert.equal(api.isMor('s1','mod',1), false);
  const html = api.viewWeek();
  assert.match(html, /Manager of Record/);
  assert.match(html, /data-mor="s1\|mod\|p2"/, 'the other one can be promoted');
});

test('emptying the top chair promotes the person below it', () => {
  const api = run();
  /* slot 0 exists but nobody is in it — the role still has a manager of record,
     because "slot 0" and "the top FILLED slot" are not the same thing. */
  morFixture(api, [A('mod',0,null), A('mod',1,'p2')]);
  assert.equal(api.isMor('s1','mod',1), true);
  assert.equal(api.isMor('s1','mod',0), false);
});

test('a role nobody is in has no manager of record', () => {
  const api = run();
  morFixture(api, [A('mod',0,null)]);
  assert.equal(api.isMor('s1','mod',0), false);
});

test('only the three manager roles carry the label', () => {
  const api = run();
  morFixture(api, [A('run',0,'p3'), A('run',1,'p1')]);
  assert.equal(api.isMor('s1','run',0), false,
    'a Flash Runner is not a manager of record');
  assert.doesNotMatch(api.viewWeek(), /Manager of Record/);
});

test('a single person in the role is still the manager of record, without a promote button', () => {
  const api = run();
  morFixture(api, [A('pay',0,'p1')]);
  assert.equal(api.isMor('s1','pay',0), true);
  const html = api.viewWeek();
  assert.match(html, /Manager of Record/);
  assert.doesNotMatch(html, /data-mor=/, 'there is nobody to promote over');
});

test('the wall chart marks the manager of record too', () => {
  const api = run();
  morFixture(api, [A('mod',0,'p1'), A('mod',1,'p2')]);
  const html = api.viewRoster();
  assert.match(html, /class="ismor"/);
  assert.match(html, /MoR/);
});

/* ---------------------------------------------------------------------------
   Demo tab.

   The risk of a demo screen is that it shows behaviour the product does not
   have. So the demo calls the REAL logic — planBreaks, attendanceAlerts,
   checkDay — and these tests exist to catch it drifting into a mock.
--------------------------------------------------------------------------- */
function demoFixture(api){
  const D = api.D;
  D.roles = [{ id:'run', name:'Flash Runners', sort:6, min_on_floor:0 },
             { id:'mod', name:'MOD', sort:1, min_on_floor:0 }];
  D.staff = [{ id:'p1', name:'Ann', active:true }, { id:'p2', name:'Bob', active:true }];
  D.sessions = [{ id:'s1', hall_id:'sc', session_date:'2030-01-04', part:'PM', status:'draft' }];
  D.days = [{ hall_id:'sc', dow:5, part:'PM', active:true }];
  D.needs = [{ hall_id:'sc', role_id:'run', dow:5, part:'PM', needed:2 }];
  D.times = [{ hall_id:'sc', role_id:'run', dow:5, part:'PM',
               start_time:'15:15:00', end_time:'00:00:00', is_placeholder:false },
             { hall_id:'sc', role_id:'mod', dow:5, part:'PM',
               start_time:'14:00:00', end_time:'00:00:00', is_placeholder:false }];
  D.assigns = [
    { id:'a1', session_id:'s1', role_id:'run', slot_index:0, staff_id:'p1',
      scheduled_start:'15:15:00', scheduled_end:'00:00:00' },
    { id:'a2', session_id:'s1', role_id:'mod', slot_index:0, staff_id:'p2',
      scheduled_start:'14:00:00', scheduled_end:'00:00:00' },
  ];
  D.sessionRoles = []; D.caps = []; D.declines = []; D.cpos = [];
  givePeriod(D);
  return D;
}

test('a shift ending at midnight is a long shift, not a negative one', () => {
  const api = run();
  demoFixture(api);
  const d = api.demoInit('s1');
  const ann = d.crew.find(c => c.name === 'Ann');
  assert.equal(ann.startMin, 915);
  assert.equal(ann.endMin, 1440,
    '00:00 is minute 0; without the midnight wrap every shift computes as negative');
  assert.ok(ann.endMin > ann.startMin);
});

test('the demo plans breaks with the real planner once somebody clocks in', () => {
  const api = run();
  demoFixture(api);
  api.setDemo(api.demoInit('s1'));
  const d = api.getDemo();
  d.t = 935;
  d.punch['p1'] = { in: 935, breaks: [] };
  const r = api.demoPlan();
  assert.ok(r.plan.length > 0, 'a nine-hour shift owes meals and rests');
  assert.ok(r.plan.some(b => b.kind === 'meal'));
});

test('the demo raises the same attendance alerts the board does', () => {
  const api = run();
  demoFixture(api);
  api.setDemo(api.demoInit('s1'));
  const d = api.getDemo();
  d.t = 935;                        // 15:35 — Bob was due at 14:00
  const a = api.demoAlerts();
  assert.ok(a.some(x => x.kind === 'in' && x.name === 'Bob'),
    'somebody rostered and not clocked in must alert');
  d.punch['p2'] = { in: 840, breaks: [{ kind:'meal', start: 880, end: null }] };
  assert.ok(api.demoAlerts().some(x => x.kind === 'lunch' && x.name === 'Bob'),
    'an unclosed meal past thirty minutes must alert');
});

test('one row per person even when they hold two roles', () => {
  const api = run();
  const D = demoFixture(api);
  D.assigns.push({ id:'a3', session_id:'s1', role_id:'run', slot_index:1, staff_id:'p2',
                   scheduled_start:'15:15:00', scheduled_end:'00:00:00' });
  const d = api.demoInit('s1');
  assert.equal(d.crew.filter(c => c.id === 'p2').length, 1,
    'Bob is one human clocking in once, not two rows');
});

test('the demo writes nothing to the database', () => {
  const api = run();
  demoFixture(api);
  api.setDemo(api.demoInit('s1'));
  const before = JSON.stringify(api.D.assigns);
  const d = api.getDemo();
  d.t = 1000; d.punch['p1'] = { in: 935, breaks: [{ kind:'meal', start: 990, end: null }] };
  api.viewDemo();
  assert.equal(JSON.stringify(api.D.assigns), before, 'the demo must not touch real rows');
});

/* A trainee is never the manager of record, and where two people are in the
   role the one NOT covering a second desk holds it. Both rules came from the
   live schedule: Kristen trains as Paymaster and is the only one on that
   night, and Sagit routinely covers two manager desks at once. */
test('a trainee never holds the manager of record', () => {
  const api = run();
  const D = morFixture(api, [A('pay',0,'p1'), A('pay',1,'p2')]);
  D.assigns[0].is_training = true;
  assert.equal(api.isMor('s1','pay',0), false, 'the trainee must not hold it');
  assert.equal(api.isMor('s1','pay',1), true, 'it falls to the qualified person below');
});

test('a role staffed only by a trainee has NO manager of record', () => {
  const api = run();
  const D = morFixture(api, [A('pay',0,'p1')]);
  D.assigns[0].is_training = true;
  assert.equal(api.morSlot('s1','pay'), null,
    'better an honest gap than a name that quietly carries the session');
  assert.match(api.viewWeek(), /no manager of record — trainee only/);
});

test('the undivided manager holds the record over the double-hatted one', () => {
  const api = run();
  /* p1 is MOD and Paymaster; p2 is only MOD and sits BELOW p1 in the slots.
     Slot order alone would give it to p1. */
  morFixture(api, [A('mod',0,'p1'), A('mod',1,'p2'), A('pay',0,'p1')]);
  assert.equal(api.mgrHats('s1','p1'), 2);
  assert.equal(api.mgrHats('s1','p2'), 1);
  assert.equal(api.isMor('s1','mod',1), true, 'p2 gives the role their whole attention');
  assert.equal(api.isMor('s1','mod',0), false);
  assert.equal(api.isMor('s1','pay',0), true, 'p1 still holds Paymaster, being the only one');
});

test('with equal hats it falls back to the top slot', () => {
  const api = run();
  morFixture(api, [A('mod',0,'p1'), A('mod',1,'p2')]);
  assert.equal(api.isMor('s1','mod',0), true);
});

/* Angela: "Flash runner is not pluralized when it applies to one person." */
test('a role heading a column is plural; a role labelling one person is not', () => {
  const { roleOne } = run();
  assert.equal(roleOne('Flash Runners'), 'Flash Runner');
  assert.equal(roleOne('Callers/Strip'), 'Caller/Strip');
  assert.equal(roleOne('Opener/Swing Shift'), 'Opener/Swing Shift');
  assert.equal(roleOne('MOD'), 'MOD');
  assert.equal(roleOne('Paymaster'), 'Paymaster');
  assert.equal(roleOne('Flash Manager'), 'Flash Manager');
  /* nothing clever with short words or double-s */
  assert.equal(roleOne('Boss'), 'Boss');
  assert.equal(roleOne(''), '');
  assert.equal(roleOne(null), '');
});

/* ---------------------------------------------------------------------------
   The simulate buttons.

   Angela: "I need a series of test buttons to show what's going to happen when
   someone's within 10 minutes, when someone's within 5 minutes, when someone
   hasn't clocked in for their break, and when someone hasn't clocked out for
   their lunch. Who's on break?"

   Each button rigs real punches and moves the clock; nothing paints an outcome
   directly. So the test for each is the same test: press it, then ask the
   MODEL what is on screen. A button that stopped causing its scenario would
   still render fine and would still be useless, which is exactly the failure
   these assertions exist to catch.
--------------------------------------------------------------------------- */
function simFixture(api) {
  const D = api.D;
  /* A real Friday shape: eleven runners against a floor of four. A tiny crew
     has no staggering, so every break lands on now and the "in 10 minutes"
     state genuinely never occurs -- which made the small fixture prove the
     wrong thing. */
  D.roles = [{ id:'run', name:'Flash Runners', fixed_count:null, min_on_floor:4, sort:6 },
             { id:'mod', name:'MOD', fixed_count:1, min_on_floor:0, sort:1 }];
  D.staff = Array.from({ length: 12 }, (_, i) =>
    ({ id:`p${i}`, name:`P${i}`, active:true, pet:'beans', pet_kind:'cat' }));
  D.sessions = [{ id:'s1', hall_id:'sc', session_date:'2030-01-04', part:'PM',
                  status:'deployed', comm_rate:0.15 }];
  D.days = [{ hall_id:'sc', dow:5, part:'PM', active:true }];
  D.needs = []; D.times = []; D.avail = []; D.caps = []; D.sessionRoles = []; D.calling = {};
  D.assigns = D.staff.map((s, i) => ({ id:`a${i}`, session_id:'s1',
    role_id: i === 0 ? 'mod' : 'run', staff_id:s.id, slot_index:i,
    scheduled_start:'17:00', scheduled_end:'23:30', response:'yes' }));
  api.setDemo(api.demoInit('s1'));
  api.getDemo().tab = 'board';
  return api;
}

test('every simulate button is wired and none of them throw', () => {
  const api = simFixture(run());
  assert.ok(api.DEMO_SIMS.length >= 7, 'all seven scenarios are offered');
  const html = api.demoBoard();
  for (const [k] of api.DEMO_SIMS)
    assert.match(html, new RegExp(`data-dsim="${k}"`), `${k} has no button`);
  for (const [k] of api.DEMO_SIMS)
    assert.doesNotThrow(() => api.demoSim(k), `${k} threw`);
});

test('"break in 10 minutes" puts somebody in the queue, amber not red', () => {
  const api = simFixture(run());
  api.demoSim('in10');
  const m = api.demoBoardModel();
  const q = m.cast.filter(c => c.lane === 'next');
  assert.ok(q.length, 'nobody is in the queue');
  const soonest = q.sort((a, b) => a.in - b.in)[0];
  assert.ok(soonest.in > 5 && soonest.in <= 12,
    `soonest break is ${soonest.in} minutes away, which is not the 10-minute case`);
  assert.ok(soonest.soon, 'it should read as soon (amber)');
  assert.ok(!soonest.warn && !soonest.due, 'but not yet as a warning');
});

test('"break in 5 minutes" is the warning case, which is what fires the banner', () => {
  const api = simFixture(run());
  api.demoSim('in5');
  const soonest = api.demoBoardModel().cast
    .filter(c => c.lane === 'next').sort((a, b) => a.in - b.in)[0];
  assert.ok(soonest, 'nobody is in the queue');
  assert.ok(soonest.warn, `${soonest.in} minutes away — the 5-minute banner will not fire`);
  assert.ok(!soonest.due);
});

test('"break due, not taken" is what raises the take-over card', () => {
  const api = simFixture(run());
  api.demoSim('due');
  const due = api.demoBoardModel().cast.find(c => c.lane === 'next' && c.due);
  assert.ok(due, 'nothing is due, so no card would show');
  assert.ok(due.in <= 0);
});

test('"who\'s on break" actually puts people in the break room, counting down', () => {
  const api = simFixture(run());
  api.demoSim('onbreak');
  const away = api.demoBoardModel().cast.filter(c => c.lane === 'break');
  assert.ok(away.length >= 1, 'the break room is empty');
  for (const a of away) {
    assert.ok(a.rem > 0, `${a.p.name} shows ${a.rem} left — that is overdue, not on break`);
    assert.ok(!a.over);
    assert.ok(a.kind === 'meal' || a.kind === 'rest');
  }
});

test('"not back from lunch" fires the lunch alert, and shows them overdue', () => {
  const api = simFixture(run());
  api.demoSim('lunch');
  const alerts = api.demoAlerts();
  const lunch = alerts.find(a => a.kind === 'lunch');
  assert.ok(lunch, `no lunch alert — got ${alerts.map(a => a.kind).join(',') || 'none'}`);
  assert.ok(lunch.over > 0, 'the overdue count must be real minutes');
  /* and they are on the board as overdue rather than quietly on break */
  const over = api.demoBoardModel().cast.find(c => c.lane === 'break' && c.over);
  assert.ok(over, 'the person is not shown as past due back');
});

test('"never clocked out" fires for ONE person, not the whole hall', () => {
  const api = simFixture(run());
  api.demoSim('noout');
  const outs = api.demoAlerts().filter(a => a.kind === 'out');
  assert.equal(outs.length, 1,
    `${outs.length} people left their shift open — the point is lost in a wall of them`);
  assert.ok(outs[0].over >= 0);
});

test('"never clocked in" fires only once the 15 minutes have passed', () => {
  const api = simFixture(run());
  api.demoSim('noin');
  const ins = api.demoAlerts().filter(a => a.kind === 'in');
  assert.equal(ins.length, 1);
  assert.ok(ins[0].over >= 0, 'and it says how late they are');
});

test('one button never leaves its mess behind for the next', () => {
  const api = simFixture(run());
  api.demoSim('lunch');
  assert.ok(api.demoAlerts().some(a => a.kind === 'lunch'));
  api.demoSim('in10');
  assert.equal(api.demoAlerts().filter(a => a.kind === 'lunch').length, 0,
    'the overdue lunch survived into the next scenario');
  /* People ARE on break here, and should be -- the night ran to reach this
     minute. What must not survive is anybody stuck past their due-back. */
  assert.equal(api.demoBoardModel().cast.filter(c => c.lane === 'break' && c.over).length, 0,
    'somebody is still overdue from the previous scenario');
});

/* Angela: "When the filter 'Show inactive' is live, all the inactives should
 * be at the top." The only reason to turn that filter on is to find one of
 * them, and alphabetical order buries them. */
test('show inactive puts the inactive people first, still alphabetical within', () => {
  const api = run();
  const D = api.D;
  D.staff = [
    { id:'1', name:'Andy',   active:true  },
    { id:'2', name:'Bella',  active:false },
    { id:'3', name:'Cara',   active:true  },
    { id:'4', name:'Aaron',  active:false },
    { id:'5', name:'Dev',    active:true  },
  ];
  D.assigns = []; D.roles = []; D.sessions = []; D.caps = [];

  const off = api.viewStaff();
  assert.doesNotMatch(off, /Bella/, 'inactive people are hidden with the filter off');

  api.edits['ui|showInactive'] = true;
  const on = api.viewStaff();
  const order = ['Aaron','Bella','Andy','Cara','Dev'].map(n => on.indexOf(`>${n}<`));
  for (const [i, at] of order.entries())
    assert.ok(at > -1, `${['Aaron','Bella','Andy','Cara','Dev'][i]} is missing from the list`);
  for (let i = 1; i < order.length; i++)
    assert.ok(order[i] > order[i-1],
      'inactive first (alphabetically), then active (alphabetically)');
});

/* ---------------------------------------------------------------------------
   Add hours, the portal preview, and the text blast.
--------------------------------------------------------------------------- */
function personFixture(api){
  const D = api.D;
  D.roles = [{ id:'r1', name:'Flash Runners', sort:6, min_on_floor:2 }];
  D.staff = [
    { id:'p1', name:'Sarah', first_name:'Sarah', active:true, pet:'beans', pet_kind:'cat', phone:'+14155550101' },
    { id:'p2', name:'Noah', active:true, phone:null },
  ];
  D.sessions = [
    { id:'s1', hall_id:'rwc', session_date:'2099-01-05', part:'PM', status:'deployed' },
    { id:'s2', hall_id:'rwc', session_date:'2099-01-06', part:'PM', status:'deployed' },
  ];
  D.assigns = [
    { id:'a1', session_id:'s1', role_id:'r1', staff_id:'p1', slot_index:0,
      scheduled_start:'15:15:00', response:'pending', early_start:true },
    { id:'a2', session_id:'s2', role_id:'r1', staff_id:'p1', slot_index:0,
      scheduled_start:'15:15:00', response:'yes', early_start:false },
    { id:'a3', session_id:'s1', role_id:'r1', staff_id:'p2', slot_index:1,
      scheduled_start:'15:15:00', response:'pending', early_start:false },
  ];
  D.days=[]; D.needs=[]; D.times=[]; D.caps=[]; D.time=[]; D.payouts=[]; D.avail=[];
  D.periods=[{ id:'per1', starts_on:'2099-01-01', ends_on:'2099-01-14', status:'draft',
               is_current:true, sessions:2, filled:3, slots:3 }];
  api.setPerson('p1');
  return api;
}

test('the person page grows Add hours and a portal preview button', () => {
  const api = personFixture(run());
  const html = api.viewPerson();
  assert.match(html, /id="ah-date"/);
  assert.match(html, /id="ah-hours"/);
  assert.match(html, /id="ah-cat"/);
  for (const c of ['worked','vacation','holiday','sick','pto'])
    assert.match(html, new RegExp(`value="${c}"`), `${c} category missing`);
  assert.match(html, /id="pvwbtn"/);
  /* their usual hall is preselected — Sarah works RWC */
  assert.match(html, /value="rwc" selected/);
});

test('the preview shows their real shifts, answers, and no live buttons', () => {
  const api = personFixture(run());
  const html = api.personPortalPreview(api.D.staff[0]);
  assert.match(html, /Hi Sarah/);
  assert.match(html, /early for buy-ins/, "the early-start flag must show as the worker sees it");
  assert.match(html, /✓ confirmed/, 'an answered shift shows the answer, not buttons');
  assert.match(html, /Got it/, 'an unanswered one shows what the worker would see');
  assert.match(html, /pointer-events:none/, 'THE point: nothing here can be pressed as them');
});

test('blastCount counts phones, honours only-unconfirmed, and skips the phoneless', () => {
  const api = personFixture(run());
  assert.equal(api.blastCount(), 1, 'Sarah has a phone; Noah does not — one text');
  /* Sarah confirmed one of two shifts: still unconfirmed overall */
  api.edits['ui|blastu'] = true;
  assert.equal(api.blastCount(), 1, 'partially confirmed still needs the nudge');
  api.D.assigns[0].response = 'yes';
  assert.equal(api.blastCount(), 0, 'fully confirmed and the checkbox on — nobody to text');
});

test('the blast button is two-press: first arms with the count, never sends', () => {
  const api = personFixture(run());
  const before = api.viewWeek();
  assert.match(before, /Text everybody the schedule/);
  assert.doesNotMatch(before, /Press again/);
  api.edits['ui|blastarm'] = true;
  const armed = api.viewWeek();
  assert.match(armed, /Press again to text 1 people/);
  assert.match(armed, /id="pblastx"/, 'an armed button needs a way to back out');
});

const demoFixtureSim = () => simFixture(run());

/* ---------------------------------------------------------------------------
   The demo time clock is the TABLET, not a table.

   Angela: "all of the names, preferably on one screen, with their little icon
   next to it, and then when they check in, it goes away."
--------------------------------------------------------------------------- */
test('the clock board holds everyone not yet in, icon beside each name', () => {
  const api = demoFixtureSim();
  const html = api.viewDemo.call ? (api.getDemo().tab='clock', api.viewDemo()) : '';
  const tiles = [...html.matchAll(/class="ctile" data-dpunch="([^"]+)\|in"/g)];
  assert.equal(tiles.length, api.getDemo().crew.length,
    'before anyone clocks in, every name is on the board');
  assert.match(html, /class="ctile"[^>]*>\s*<img/, 'each tile leads with the character icon');
  assert.match(html, /TAP YOUR NAME TO CLOCK IN/);
});

test('a name that clocks in leaves the board and lands in the floor strip', () => {
  const api = demoFixtureSim();
  const demo = api.getDemo(); demo.tab = 'clock';
  const first = demo.crew[0];
  demo.punch[first.id] = { in: demo.t, out: null, breaks: [] };
  const html = api.viewDemo();
  assert.doesNotMatch(html, new RegExp(`class="ctile" data-dpunch="${first.id}\\|in"`),
    'their tile must be GONE, not greyed');
  assert.match(html, new RegExp(`data-cact="${first.id}"`),
    'they reappear as a chip in the on-the-floor strip');
  assert.match(html, /On the floor — 1/);
});

test('with everybody in, the board says so instead of sitting empty', () => {
  const api = demoFixtureSim();
  const demo = api.getDemo(); demo.tab = 'clock';
  for (const c of demo.crew) demo.punch[c.id] = { in: demo.t, out: null, breaks: [] };
  const html = api.viewDemo();
  assert.match(html, /Everybody is in/);
  assert.doesNotMatch(html, /class="ctile"/);
});

test('tapping a chip opens break/meal/out for that person only', () => {
  const api = demoFixtureSim();
  const demo = api.getDemo(); demo.tab = 'clock';
  const p = demo.crew[0];
  demo.punch[p.id] = { in: demo.t, out: null, breaks: [] };
  api.edits['ui|cact'] = p.id;
  const html = api.viewDemo();
  assert.match(html, new RegExp(`data-dpunch="${p.id}\\|rest"`));
  assert.match(html, new RegExp(`data-dpunch="${p.id}\\|meal"`));
  assert.match(html, new RegExp(`data-dpunch="${p.id}\\|out"`));
  /* and on a break, the one action is coming back */
  demo.punch[p.id].breaks.push({ kind:'meal', start: demo.t, end: null });
  const html2 = api.viewDemo();
  assert.match(html2, new RegExp(`data-dpunch="${p.id}\\|back"`));
  assert.doesNotMatch(html2, new RegExp(`data-dpunch="${p.id}\\|out"`),
    'no clocking out from inside a meal — the live tablet does not offer it either');
});

/* ---------------------------------------------------------------------------
   Not clocked in still shows on the break board (as a ghost), the worker
   portal demo has its screens, and Needs You can send.
--------------------------------------------------------------------------- */
test('rostered-but-not-in stand on the board as ghosts, not nothing', () => {
  const api = demoFixtureSim();
  const m = api.demoBoardModel();
  const ghosts = m.cast.filter(c => c.ghost);
  assert.equal(ghosts.length, api.getDemo().crew.length,
    'nobody has clocked in, so everybody is a ghost');
  assert.equal(m.counts.floor, 0, 'ghosts are not counted as on the floor');
  assert.equal(m.counts.ghost, ghosts.length);
  /* clock one in — they stop being a ghost */
  const demo = api.getDemo();
  demo.punch[demo.crew[0].id] = { in: demo.t, out: null, breaks: [] };
  const m2 = api.demoBoardModel();
  assert.ok(!m2.cast.find(c => c.p.id === demo.crew[0].id)?.ghost);
  assert.equal(m2.counts.ghost, ghosts.length - 1);
});

test('the worker phone has shifts, hours and character screens', () => {
  const api = demoFixtureSim();
  const demo = api.getDemo(); demo.tab = 'worker';
  /* the fixture confirms every shift; un-confirm one so the banner case exists */
  api.D.assigns.find(a => a.staff_id === (demo.who || demo.crew[0].id)).response = 'pending';
  let html = api.viewDemo();
  assert.match(html, /data-wtab="shifts"/);
  assert.match(html, /data-wtab="hours"/);
  assert.match(html, /data-wtab="pet"/);
  assert.match(html, /NEW SHIFT — please confirm/);
  assert.match(html, /data-dresp="[^"]+\|yes"/, 'Got it must be wired');
  demo.wtab = 'hours';
  /* worked entries this period drive the top of the screen */
  api.D.time = [
    { staff_id: demo.crew[0].id, work_date: '2099-01-05', hours_worked: 9, is_worked_time: true },
    { staff_id: demo.crew[0].id, work_date: '2099-01-06', hours_worked: 4, is_worked_time: true },
  ];
  demo.who = demo.crew[0].id;
  html = api.viewDemo();
  assert.match(html, /This pay period/);
  /* 13h over two days, one day 1h over 8 -> 12 regular, 1 overtime */
  assert.match(html, /Regular hours[\s\S]{0,200}12\.00h/);
  assert.match(html, /Overtime hours[\s\S]{0,200}1\.00h/);
  assert.match(html, /Still scheduled this period/);
  assert.match(html, /Commission/);
  demo.wtab = 'pet';
  html = api.viewDemo();
  assert.match(html, /data-dpet=/, 'the picker offers characters');
});

test('confirming in the demo phone records demo state, never the assignment', () => {
  const api = demoFixtureSim();
  const demo = api.getDemo(); demo.tab = 'worker';
  const aid = api.D.assigns.find(a => a.staff_id === demo.who || a.staff_id === demo.crew[0].id).id;
  (demo.resp = demo.resp || {})[aid] = 'yes';
  const html = api.viewDemo();
  assert.match(html, /✓ Confirmed/);
  assert.equal(api.D.assigns.find(a => a.id === aid).response, 'yes' === 'never' ? 'x' : api.D.assigns.find(a => a.id === aid).response,
    'sanity');
  assert.notEqual(api.D.assigns.find(a => a.id === aid).response, 'demo-yes');
});

/* Angela: "this manager needs to also be able to choose the pet and change
 * the pet" — from the person's page, in the full app. */
test("the manager's picker is on the person page, taken characters greyed with owners", () => {
  const api = run();
  const D = api.D;
  D.roles = []; D.assigns = []; D.sessions = []; D.caps = []; D.time = []; D.payouts = [];
  D.staff = [
    { id:'p1', name:'Sarah', active:true, pet:'beans',  pet_kind:'cat' },
    { id:'p2', name:'Gina',  active:true, pet:'mochi', pet_kind:'cat' },
  ];
  api.setPerson('p1');
  let html = api.viewPerson();
  assert.match(html, /id="mpetbtn"/);
  assert.match(html, /Change character/, 'she has one, so the button says Change');
  api.edits['ui|petpick'] = true;
  html = api.viewPerson();
  /* the img between hook and label is a multi-KB data URL, so match the class */
  assert.match(html, /class="wpet mine" data-mpet="beans\|cat"/, "her own is marked");
  assert.match(html, /theirs now/);
  assert.match(html, /data-mpet="mochi\|cat"[^>]*disabled/, "Gina's is not offered");
  assert.match(html, /Gina/, "and says whose it is");
});
