import { chromium } from 'playwright';
import { freshNaked } from './naked.mjs';
freshNaked();

const STUB = () => {
  window.supabase = { createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { user: {} } } }), onAuthStateChange(){},
            signInWithPassword: async () => ({}) },
    from: () => ({ select(){ return this; }, order(){ return this; }, eq(){ return this; },
                   then(r){ return r({ data: [], error: null }); } }),
    rpc: async () => ({ data: null, error: null }) }) };
};

const STAFF = [
  { id:'a', name:'Gina',   active:true, pet:'beans',   pet_kind:'cat'  },
  { id:'b', name:'Hector', active:true, pet:'mochi',   pet_kind:'cat'  },
  { id:'c', name:'Abel',   active:true, pet:'truffle', pet_kind:'cat'  },
  { id:'d', name:'Shelly', active:true, pet:'ducky',   pet_kind:'boss' },
  { id:'e', name:'Sagit',  active:true, pet:'witch',   pet_kind:'boss' },
  { id:'f', name:'Nopet',  active:true, pet:null,      pet_kind:null   },
];

async function probe(browser, file, setup, label){
  const p = await browser.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0,140)));
  await p.addInitScript(STUB);
  await p.goto(`file:///tmp/naked/${file}`);
  await p.waitForTimeout(400);
  await p.evaluate(setup, STAFF);
  await p.waitForTimeout(1500);
  const imgs = await p.evaluate(() =>
    [...document.querySelectorAll('img')]
      .filter(i => { const s = i.getAttribute('src') || ''; return /art\//.test(s) || s.startsWith('data:image'); })
      .map(i => ({ src:(i.getAttribute('src')||'').slice(0,42), w:i.naturalWidth,
                   lazy:i.getAttribute('loading') })));
  const broken = imgs.filter(i => i.w === 0);
  console.log(`\n${label} (${file})`);
  console.log(`   art images found: ${imgs.length}   loaded: ${imgs.length-broken.length}   BROKEN: ${broken.length}`);
  imgs.slice(0,6).forEach(i => console.log(`     ${i.w===0?'BROKEN':'ok    '} ${i.src} (${i.w}px)`));
  if (broken.length) console.log('   !! broken:', broken.map(b=>b.src).join(', '));
  if (imgs.some(i=>i.lazy)) console.log('   !! a lazy attribute survived');
  if (errs.length) console.log('   page errors:', errs.slice(0,3).join(' | '));
  await p.close();
  return { label, found: imgs.length, broken: broken.length, errs: errs.length };
}

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const results = [];

results.push(await probe(b, 'manager.html', staff => {
  D.staff = staff;
  D.roles = [{ id:'r1', name:'Flash Runners', fixed_count:null, min_on_floor:4, sort:6 }];
  D.caps=[]; D.assigns=[]; D.sessions=[]; D.days=[]; D.needs=[]; D.times=[]; D.avail=[];
  document.getElementById('main').innerHTML = viewStaff();
}, 'MANAGER — staff list'));

results.push(await probe(b, 'manager.html', staff => {
  D.staff = staff;
  D.roles = [{ id:'r1', name:'Flash Runners', fixed_count:null, min_on_floor:4, sort:6 }];
  D.caps=[]; D.declines=[]; D.sessionRoles=[]; D.avail=[];
  D.sessions = [{ id:'s1', hall_id:'sc', session_date:'2030-01-04', part:'PM', status:'draft' }];
  D.days  = [{ hall_id:'sc', dow:5, part:'PM', active:true }];
  D.needs = [{ hall_id:'sc', role_id:'r1', dow:5, part:'PM', needed:8 }];
  D.times = [{ hall_id:'sc', role_id:'r1', dow:5, part:'PM', start_time:'15:15:00', is_placeholder:false }];
  D.assigns = staff.map((p,i)=>({ id:'a'+i, session_id:'s1', role_id:'r1', staff_id:p.id,
                                  slot_index:i, early_start:false, is_training:false, response:'pending' }));
  D.periods = [{ id:'per1', starts_on:'2029-12-31', ends_on:'2030-01-13', label:null,
                 status:'draft', published_at:null, is_current:true }];
  periodId = 'per1';
  document.getElementById('main').innerHTML = viewRoster();
}, 'MANAGER — wall chart'));

results.push(await probe(b, 'manager.html', staff => {
  D.staff = staff;
  D.roles = [{ id:'r1', name:'Flash Runners', fixed_count:null, min_on_floor:4, sort:6 }];
  D.caps=[]; D.assigns=[]; D.needs=[]; D.times=[]; D.avail=[];
  D.days = [{ hall_id:'sc', dow:5, part:'PM', active:true }];
  D.sessions = [{ id:'s1', hall_id:'sc', session_date:'2030-01-04', part:'PM', status:'draft', comm_rate:0.15 }];
  D.sessionRoles=[]; D.calling={};
  /* A schedule is a fortnight; without a period there are no cards to draw. */
  D.periods=[{ id:'per1', starts_on:'2029-12-31', ends_on:'2030-01-13', label:null,
               status:'draft', note:null, published_at:null, is_current:true,
               sessions:1, filled:2, slots:3 }];
  D.needs=[{ hall_id:'sc', role_id:'r1', dow:5, part:'PM', needed:3 }];
  D.assigns=[
    { id:'x1', session_id:'s1', role_id:'r1', staff_id:'a', slot_index:0, response:'pending' },
    { id:'x2', session_id:'s1', role_id:'r1', staff_id:'d', slot_index:1, response:'pending' }];
  sel=0;
  document.getElementById('main').innerHTML = viewWeek();
}, 'MANAGER — schedule'));

results.push(await probe(b, 'manager.html', staff => {
  D.staff = staff;
  D.roles = [{ id:'r1', name:'Flash Runners', fixed_count:null, min_on_floor:4, sort:6 }];
  D.caps=[]; D.assigns=[]; D.needs=[]; D.times=[]; D.avail=[]; D.availStatus=null;
  D.days = [{ hall_id:'sc', dow:5, part:'PM', active:true }];
  document.getElementById('main').innerHTML = viewAvailability();
}, 'MANAGER — availability'));

results.push(await probe(b, 'clock.html', staff => {
  board = staff.map(s => ({ staff_id:s.id, staff_name:s.name, scheduled:true, entry_id:null,
    clocked_in:false, on_break:null, hours_so_far:0, pet:s.pet, pet_kind:s.pet_kind }));
  render();
}, 'TIME CLOCK — tap board'));

results.push(await probe(b, 'board.html', staff => {
  board = { now:'2026-08-12T04:00:00Z', decisions:[], people: staff.map(s => ({
    staff_id:s.id, name:s.name, pet:s.pet, pet_kind:s.pet_kind, role_id:'run', role:'Flash Runners',
    floor:0, cover_group:null, clock_in:'2026-08-12T01:00:00Z', clock_out:null,
    scheduled_end:'10:00', breaks:[] })) };
  compute(); render(); stepYard();
}, 'BREAK BOARD — tiles + floor'));

results.push(await probe(b, 'me.html', () => {
  home = { ok:true, me:{ id:'a', name:'Gina', first_name:'Gina', pet:'beans', pet_kind:'cat', critical:false },
           request:null };
  render();
}, 'WORKER PAGE — own character'));

results.push(await probe(b, 'me.html', () => {
  home = { ok:true, me:{ id:'a', name:'Gina', first_name:'Gina', pet:'beans', pet_kind:'cat', critical:false },
           request:null };
  picking = true;
  cat = { ok:true, tier:0, mine:'beans', pets:[
    { id:'beans', kind:'cat', tier:0, allowed:true, mine:true, taken_by:null },
    { id:'mochi', kind:'cat', tier:0, allowed:true, mine:false, taken_by:'Hector' },
    { id:'truffle', kind:'cat', tier:0, allowed:true, mine:false, taken_by:null } ] };
  render();
}, 'WORKER PAGE — the picker'));

/* ---------------------------------------------------------------------------
   The demo break board is not a page of markup, it is a scene: every person is
   one character element that persists and walks between lanes. Counting images
   is not enough here -- a board that renders a still picture of eighteen cats
   and never moves them is exactly the failure this check exists to catch. So
   this probe asserts three things: characters exist, they are the .pc element
   (not a tile with a picture in it), and at least one of them MOVED.
--------------------------------------------------------------------------- */
async function probeScene(browser){
  const label = 'DEMO — break board scene';
  const p = await browser.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0,140)));
  await p.addInitScript(STUB);
  await p.goto('file:///tmp/naked/manager.html');
  await p.waitForTimeout(400);
  await p.evaluate(staff => {
    D.staff = staff;
    D.roles = [{ id:'r1', name:'Flash Runners', fixed_count:null, min_on_floor:1, sort:6 },
               { id:'r2', name:'MOD', fixed_count:1, min_on_floor:0, sort:1 }];
    D.caps=[]; D.needs=[]; D.avail=[]; D.calling={}; D.sessionRoles=[];
    D.days = [{ hall_id:'sc', dow:5, part:'PM', active:true }];
    D.times = [];
    D.sessions = [{ id:'s1', hall_id:'sc', session_date:'2030-01-04', part:'PM', status:'deployed' }];
    D.periods = [{ id:'per1', starts_on:'2029-12-31', ends_on:'2030-01-13', status:'draft',
                   is_current:true, sessions:1, filled:5, slots:5 }];
    D.assigns = staff.slice(0,5).map((s,i) => ({
      id:'x'+i, session_id:'s1', role_id: i===0 ? 'r2' : 'r1', staff_id:s.id, slot_index:i,
      scheduled_start:'17:00', scheduled_end:'23:30', response:'yes' }));
    demo = demoInit('s1');
    demo.tab = 'board';
    /* clock everybody in so the planner has somebody to plan for */
    /* Clocked in recently, so the planner puts their breaks in the future
       and the crew is on the floor. A fixture where everybody is due at once
       parks a take-over card over the whole scene and proves nothing. */
    for (const c of demo.crew) demo.punch[c.id] = { in: c.startMin, out: null, breaks: [] };
    demo.t = demo.crew[0].startMin + 35;
    document.getElementById('main').innerHTML = viewDemo();
    demoSceneStart();
  }, STAFF);
  await p.waitForTimeout(900);
  const before = await p.evaluate(() =>
    [...document.querySelectorAll('#dcast .pc')].map(e => e.style.translate));
  await p.waitForTimeout(1600);
  const after = await p.evaluate(() =>
    [...document.querySelectorAll('#dcast .pc')].map(e => e.style.translate));
  const imgs = await p.evaluate(() =>
    [...document.querySelectorAll('#dcast .pc img')]
      .map(i => ({ src:(i.getAttribute('src')||'').slice(0,42), w:i.naturalWidth })));
  const named = await p.evaluate(() =>
    [...document.querySelectorAll('#dcast .pc .tag b')].filter(b => b.textContent.trim()).length);
  const moved = before.filter((v,i) => after[i] && after[i] !== v).length;
  const broken = imgs.filter(i => i.w === 0);
  console.log(`\n${label} (manager.html)`);
  console.log(`   characters: ${imgs.length}   named: ${named}   moved in 1.6s: ${moved}   BROKEN: ${broken.length}`);
  if (errs.length) console.log('   page errors:', errs.slice(0,3).join(' | '));
  await p.close();
  const ok = imgs.length >= 4 && broken.length === 0 && named === imgs.length && moved > 0;
  if (!ok && moved === 0) console.log('   !! NOBODY MOVED — the board is a still picture again');
  return { label, found: imgs.length, broken: ok ? 0 : (broken.length || 1), errs: errs.length };
}
try {
  results.push(await probeScene(b));
} catch (e) {
  console.log('\nDEMO — break board scene (manager.html)\n   THREW:', String(e).slice(0, 200));
  results.push({ label: 'DEMO — break board scene', found: 0, broken: 1, errs: 1 });
}

console.log('\n================ SUMMARY ================');
let bad = 0;
for (const r of results) {
  const ok = r.found > 0 && r.broken === 0;
  if (!ok) bad++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${r.label}  (${r.found} images, ${r.broken} broken)`);
}
console.log(bad === 0 ? '\nAll pages render their characters.' : `\n${bad} PAGE(S) STILL BROKEN`);
await b.close();
process.exit(bad === 0 ? 0 : 1);
