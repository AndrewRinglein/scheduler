/* A picture of the demo break board, so a change to it can be looked at
   rather than argued about. Writes /tmp/demo-board.png. */
import { chromium } from 'playwright';
import { freshNaked } from './naked.mjs';
freshNaked();
const STUB = () => { window.supabase = { createClient: () => ({
  auth:{getSession:async()=>({data:{session:{user:{}}}}),onAuthStateChange(){},signInWithPassword:async()=>({})},
  from:()=>({select(){return this},order(){return this},eq(){return this},then(r){return r({data:[],error:null})}}),
  rpc:async()=>({data:null,error:null})})};};

const CREW = [
  ['Rachel','boss','dragon'], ['Shelly','boss','ducky'],  ['Brandon','hero','tusk'],
  ['Abel','hero','shade'],    ['Cameron','hero','totem'], ['Doris','hero','glaive'],
  ['Abygail','critter','cobbler'], ['Cindy','critter','suds'], ['Elena','critter','honeydew'],
  ['Alex','robot','tinny'],   ['Claudia','robot','beep'],  ['Emma','robot','hover'],
  ['Alonso','snack','spike'], ['Cody','snack','guac'],     ['Esteban','snack','sprinkles'],
  ['Amanda','monster','boo'], ['Dante','monster','gloop'], ['Esther','monster','jelly'],
  ['Andrea','cat','apricot'], ['Diana','cat','bandit'],
  ['Andy','dog','bandit-d'],  ['Donovan','dog','bear'],
].map(([name,pet_kind,pet],i) => ({ id:'s'+i, name, pet, pet_kind, active:true }));

const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport:{ width:1440, height:1000 }, deviceScaleFactor:2 });
p.on('pageerror', e => console.log('PAGEERROR', String(e).slice(0,200)));
await p.addInitScript(STUB);
await p.goto('file:///tmp/naked/manager.html');
await p.waitForTimeout(500);
await p.evaluate(crew => {
  D.staff = crew;
  D.roles = [{ id:'r1', name:'Flash Runners', fixed_count:null, min_on_floor:6, sort:6 },
             { id:'r2', name:'MOD', fixed_count:1, min_on_floor:0, sort:1 },
             { id:'r3', name:'Paymaster', fixed_count:1, min_on_floor:0, sort:2 }];
  D.caps=[]; D.needs=[]; D.avail=[]; D.calling={}; D.sessionRoles=[]; D.times=[];
  D.days=[{ hall_id:'sc', dow:5, part:'PM', active:true }];
  D.sessions=[{ id:'s1', hall_id:'sc', session_date:'2030-01-04', part:'PM', status:'deployed' }];
  D.periods=[{ id:'per1', starts_on:'2029-12-31', ends_on:'2030-01-13', status:'draft',
               is_current:true, sessions:1, filled:crew.length, slots:crew.length }];
  D.assigns = crew.map((s,i) => ({ id:'x'+i, session_id:'s1',
    role_id: i===0 ? 'r2' : i===1 ? 'r3' : 'r1', staff_id:s.id, slot_index:i,
    scheduled_start:'17:00', scheduled_end:'23:30', response:'yes' }));
  demo = demoInit('s1'); demo.tab = 'board';
  const open = demo.crew[0].startMin;
  for (const c of demo.crew) demo.punch[c.id] = { in: open, out: null, breaks: [] };
  /* two already away, so the break room is not empty in the picture */
  demo.punch[demo.crew[3].id].breaks = [{ kind:'meal', start: open+150, end:null }];
  demo.punch[demo.crew[7].id].breaks = [{ kind:'rest', start: open+172, end:null }];
  demo.t = open + 178;
  document.getElementById('main').innerHTML = viewDemo();
  demoSceneStart();
}, CREW);
/* One picture per simulate button, so a change to any of them can be looked
   at rather than argued about. */
for (const k of ['in10','in5','due','onbreak','lunch','noout','noin']) {
  await p.evaluate(kind => { demoSim(kind);
    document.getElementById('main').innerHTML = viewDemo(); demoSceneStart(); }, k);
  await p.waitForTimeout(2200);
  await p.locator('.tv').screenshot({ path: `/tmp/sim-${k}.png` });
}
await p.evaluate(() => { demoSim('onbreak');
  document.getElementById('main').innerHTML = viewDemo(); demoSceneStart(); });
/* Shot one: a break is due, so the card has the room. */
await p.waitForTimeout(2500);
await p.locator('.tv').screenshot({ path:'/tmp/demo-board-alert.png' });
/* Shot two: the card has handed the room back and the floor is alive again. */
await p.waitForTimeout(20000);
await p.locator('.tv').screenshot({ path:'/tmp/demo-board.png' });
console.log('wrote /tmp/demo-board.png and /tmp/demo-board-alert.png');
await b.close();
