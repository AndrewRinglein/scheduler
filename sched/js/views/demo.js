/* ---------------------------------------------------------------------------
   Demo.

   Everything the product does, walkable inside the manager app, off REAL
   scheduled sessions — so a walkthrough shows this hall's actual crew on an
   actual night rather than invented names that raise the question of whether
   any of it is real.

   Nothing here writes. The simulated night lives in memory and is thrown away
   on reload; the button says so. Where a screen has real logic behind it the
   demo calls that logic — planBreaks() for the board, attendanceAlerts() for
   the alerts, checkDay() for the hours — so the demo cannot show behaviour the
   product does not have. That is the failure mode of demo screens and the
   reason none of this is re-implemented.
--------------------------------------------------------------------------- */

const DEMO_TABS = [
  ['clock',  'Time clock'],
  ['board',  'Break board'],
  ['worker', 'Worker portal'],
  ['hours',  'My hours'],
];

/* One in-memory night. `t` is minutes from midnight, driven by the slider, so
   the whole thing is a pure function of (session, t, punches). */
let demo = null;
const demoSeen = new Map();

function demoInit(sessionId){
  const s = D.sessions.find(x => x.id === sessionId) || D.sessions[firstUpcomingIndex()];
  if (!s) return null;
  const dw = dowOf(s);
  const crew = D.assigns
    .filter(a => a.session_id === s.id && a.staff_id)
    .map(a => {
      const st = D.staff.find(p => p.id === a.staff_id);
      const role = D.roles.find(r => r.id === a.role_id);
      const start = a.scheduled_start || timeForRaw(a.role_id, dw, s.part, s.hall_id);
      const end   = a.scheduled_end   || endForRaw(a.role_id, dw, s.part, s.hall_id);
      /* These shifts end at 00:00, which is 0 minutes -- without the wrap every
         shift computes as negative length, so nobody is owed a meal and the
         board plans nothing. */
      const s0 = start ? hmMin(start) : null;
      let e0 = end ? hmMin(end) : null;
      if (s0 != null && e0 != null && e0 <= s0) e0 += 1440;
      return { id: a.staff_id, name: st ? st.name : '—', pet: st?.pet, pet_kind: st?.pet_kind,
               roleId: a.role_id, role: role ? role.name : '—', slot: a.slot_index,
               startMin: s0, endMin: e0 };
    })
    /* One row per person: somebody in two roles is one human clocking in once. */
    .filter((p, i, all) => all.findIndex(x => x.id === p.id) === i)
    .sort((a, b) => (a.startMin ?? 0) - (b.startMin ?? 0) || a.name.localeCompare(b.name));

  const open = Math.min(...crew.map(p => p.startMin ?? 1e9).filter(Number.isFinite));
  return { sessionId: s.id, tab: 'clock', t: open + 20, crew,
           punch: {},                 // staffId -> {in, out, breaks:[{kind,start,end}]}
           who: crew[0]?.id || null };
}

const hmMin = t => { const [h,m] = String(t).split(':').map(Number); return h*60 + (m||0); };
const dmin  = m => `${String(Math.floor(m/60)%24).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
const dclock = m => { const h = Math.floor(m/60)%24, x = h%12||12;
  return `${x}:${String(m%60).padStart(2,'0')}${h<12?'am':'pm'}`; };

function demoPeople(){
  return demo.crew.map(p => {
    const pu = demo.punch[p.id] || {};
    const openMeal = (pu.breaks||[]).find(b => b.kind === 'meal' && b.end == null);
    return { ...p, in: pu.in ?? null, out: pu.out ?? null, breaks: pu.breaks || [],
             openBreak: (pu.breaks||[]).find(b => b.end == null) || null, openMeal };
  });
}

/* ---- the shared alert rules, on the simulated night ---------------------- */
function demoAlerts(){
  const people = demoPeople().map(p => ({
    id: p.id, name: p.name, role: p.role, rostered: true,
    clockInMin: p.in, clockedOut: p.out != null,
    schedInMin: p.startMin, schedOutMin: p.endMin,
    openMeal: p.openMeal ? { startMin: p.openMeal.start } : null,
  }));
  /* nowMs advances with the slider so holds age the way they do in the hall. */
  return attendanceAlerts(people, demo.t, demo.t * 60000, demoSeen);
}

/* ---- the real planner, on the simulated night ---------------------------- */
function demoPlan(){
  const on = demoPeople().filter(p => p.in != null && p.out == null);
  if (!on.length) return { plan: [], conflicts: [], on };
  const floors = {}, coverGroups = {};
  for (const p of on) {
    const r = D.roles.find(x => x.id === p.roleId);
    floors[p.roleId] = r?.min_on_floor || 0;
    if (r?.cover_group) coverGroups[p.roleId] = r.cover_group;
  }
  const done = [];
  for (const p of on) for (const b of p.breaks)
    done.push({ personId: p.id, kind: b.kind, startMin: b.start, endMin: b.end ?? demo.t });
  const r = planBreaks(
    on.map(p => ({ id: p.id, name: p.name, roleId: p.roleId,
                   startMin: p.in, endMin: p.endMin ?? p.in + 480 })),
    floors, done, { nowMin: demo.t, coverGroups });
  return { ...r, on };
}

function demoBar(){
  const s = D.sessions.find(x => x.id === demo.sessionId);
  const lo = Math.min(...demo.crew.map(p => p.startMin ?? 1e9).filter(Number.isFinite)) - 30;
  const hi = Math.max(...demo.crew.map(p => p.endMin ?? 0)) + 60;
  return `<div class="panel periodbar wallbar" style="margin-bottom:12px">
    <select id="dsess" style="min-width:270px;font-weight:600">
      ${D.sessions.filter(x => D.assigns.some(a => a.session_id === x.id && a.staff_id))
        .map(x => `<option value="${x.id}" ${x.id===demo.sessionId?'selected':''}>${
          esc(label(x))} · ${esc(HALLNAME[x.hall_id])}</option>`).join('')}
    </select>
    <div class="bignum">${dclock(demo.t)}<span class="rtime"> on the demo clock</span></div>
    <input type="range" id="dtime" min="${lo}" max="${hi}" step="5" value="${demo.t}"
           style="flex:1 1 260px;min-width:200px">
    <button class="btn" id="dreset" title="Throw the simulated night away">Reset</button>
    <div class="rtime" style="flex-basis:100%">Drag the clock forward to make things happen.
      Nothing here is saved — this is ${esc(label(s))}'s real crew on a pretend night.</div>
  </div>
  <div class="panel" style="margin-bottom:12px;display:flex;gap:6px;flex-wrap:wrap">
    ${DEMO_TABS.map(([k,t]) => `<button class="btn ${demo.tab===k?'primary':''}"
      data-dtab="${k}">${t}</button>`).join('')}
  </div>`;
}

/* ---- 1. the tap-a-name time clock ---------------------------------------
   The tablet that sits below the display board. Ported from the real one
   (clock.html) rather than invented: the same dark tile grid, a character
   icon beside every name.

   Angela's spec, verbatim: "all of the names, preferably on one screen, with
   their little icon next to it, and then when they check in, it goes away."
   So the board holds ONLY the people still expected -- a name that has
   clocked in shrinks out of the grid (the .going animation buys the 240ms the
   eye needs to see it leave, in app.js). The crew already in moves to a strip
   of small chips along the bottom; tapping a chip opens that person's
   break/meal/clock-out actions, so the rest of the night is still drivable
   from the same screen.
------------------------------------------------------------------------- */
function demoClock(){
  const people = demoPeople();
  const waiting = people.filter(p => p.in == null);
  const on      = people.filter(p => p.in != null && p.out == null);
  const done    = people.filter(p => p.out != null);
  const open    = edits['ui|cact'];   // which chip's actions are open

  const tile = p => `
    <button class="ctile" data-dpunch="${p.id}|in">
      ${p.pet ? `<img src="${esc(petSrc(p.pet, p.pet_kind, 'sit'))}" alt="">` : ''}
      <span class="txt"><span class="n">${esc(p.name)}</span>
        <span class="s">${esc(roleOne(p.role))}${
          p.startMin != null ? ` · due ${dclock(p.startMin)}` : ''}</span></span>
    </button>`;

  const chip = (p, cls) => `
    <button class="cchip ${cls}${open === p.id ? ' sel' : ''}" data-cact="${p.id}">
      ${p.pet ? `<img src="${esc(petSrc(p.pet, p.pet_kind, 'sit'))}" alt="">` : ''}
      ${esc(p.name)}</button>`;

  const sel = people.find(p => p.id === open);
  const acts = sel && sel.out == null ? `
    <div class="cacts">
      <strong>${esc(sel.name)}</strong>
      ${sel.openBreak
        ? `<span class="rtime">on ${sel.openBreak.kind === 'meal' ? 'meal' : 'break'}</span>
           <button class="btn primary" data-dpunch="${sel.id}|back">Back on the floor</button>`
        : `<button class="btn" data-dpunch="${sel.id}|rest">Break</button>
           <button class="btn" data-dpunch="${sel.id}|meal">Meal</button>
           <button class="btn" data-dpunch="${sel.id}|out">Clock out</button>`}
    </div>` : '';

  return `<h2>Time clock <span class="rtime">the tablet below the display board</span></h2>
    <div class="ttab">
      <div class="tthead">
        <span>TAP YOUR NAME TO CLOCK IN</span>
        <span class="ttclock">${dclock(demo.t)}</span>
      </div>
      ${waiting.length
        ? `<div class="cgrid">${waiting.map(tile).join('')}</div>`
        : `<div class="callin">✓ Everybody is in</div>`}
      ${on.length || done.length ? `
      <div class="cstrip">
        <span class="rtime">On the floor — ${on.length}</span>
        ${on.map(p => chip(p, p.openBreak ? 'brk' : 'in')).join('')}
        ${done.map(p => chip(p, 'done')).join('')}
      </div>${acts}` : ''}
    </div>`;
}

/* ---- 2. the break board -------------------------------------------------
   Ported from the original prototype (Bingo Scheduler V2/break-board.html),
   read rather than remembered.

   The thing that makes it work is that a person IS a character — one element
   that persists all night and moves between states. Nobody is a rectangle
   containing a picture. Everyone is an icon with their name under it, and
   when their break comes up they walk off the floor and into the break room
   and sit down, then walk back. Three lanes, bottom to top:

     ON THE FLOOR  — wandering, at their own pace, with the prototype's
                     idle-grooming and the dog-chases-cat business
     UP NEXT       — a queue, soonest break first, amber at 12 minutes and
                     blinking red inside 5
     BREAK ROOM    — sitting, counting down; red once they are due back

   Timings are the prototype's: WARN_LEAD 5 minutes (the name also flashes
   across the whole screen for a minute), SOON 12 minutes, meals 30, rests 10.
------------------------------------------------------------------------- */
const WARN_LEAD_MIN = 5;    // red, and the name banner fires
const WARN_SHOW_MS  = 60000;
const SOON_MIN      = 12;   // amber
const BREAK_LEN     = { meal: 30, rest: 10 };

/* Lanes, as a fraction of the scene height — the y a character walks to. */
const LANE_Y = { break: 0.10, next: 0.42, floor: 0.755 };
/* A character is centred on its x, so a lane that starts at x=0 puts half the
   first name tag off the left edge. */
const X0 = 74;
/* A name tag is about 110px wide, so anything closer than this collides and
   two names become one unreadable smear. The prototype avoided that by
   walking the crew along a track WIDER than the screen -- only part of the
   floor is visible at any moment, which is what keeps the tags apart. */
const SLOT_W  = 172;
/* How long the floor is, in screen-widths. The prototype used a fixed 1.5
   because it always had the same eleven characters; here a Sunday morning has
   seven and a Friday night has eighteen. A fixed track hides half a small crew
   off-screen, and a track sized to the screen smears a big one. So it is the
   room the crew actually needs, never less than the screen. */
const trackX = (n, W) => Math.max(1, Math.min(2.2, (n * SLOT_W) / Math.max(320, W)));

/* One interaction every 20 seconds, on a clock -- Angela's cadence, and her
   roster: the robot disintegrating somebody, the chase-and-bite on a snack,
   a cat loving on something, and the dog chasing a cat. Bitten fruit and
   disintegrated crew come back after five minutes. */
const INTERACT_EVERY = 120;   // "one every 2 minutes" — Angela, revising her 20s
const BITE_REVERT_S  = 300;
const PUFF_REVERT_S  = 300;
const DEMO_PUFF = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44">'
  + '<g fill="#c9cdd6" opacity=".92"><circle cx="16" cy="28" r="10"/>'
  + '<circle cx="27" cy="24" r="12"/><circle cx="20" cy="17" r="8"/>'
  + '<circle cx="31" cy="32" r="7"/></g>'
  + '<g fill="#aab0bc"><circle cx="14" cy="33" r="4"/><circle cx="33" cy="21" r="4"/></g></svg>');

const demoCast = new Map();          // staffId -> the character that persists
let demoRaf = null, demoLastMs = 0, demoSceneT = 0, demoSceneSeeded = false;
let demoChase = null, demoNextAct = 10, demoWarn = { who: null, until: 0 };
const demoWarnFired = new Set();

const mins = n => {
  const a = Math.abs(Math.round(n));
  return `${Math.floor(a/60) ? Math.floor(a/60)+'h ' : ''}${a%60}m`;
};

function demoBoardModel(){
  const { plan, conflicts, on } = demoPlan();
  const cast = [];
  for (const p of on) {
    if (p.openBreak) {
      const len = BREAK_LEN[p.openBreak.kind] ?? 10;
      const rem = (p.openBreak.start + len) - demo.t;
      cast.push({ p, lane: 'break', kind: p.openBreak.kind, rem, over: rem < 0 });
      continue;
    }
    const next = plan.find(b => b.personId === p.id);
    /* UP NEXT is the queue, not the roster. Everybody has a next break
       somewhere in the night, so gating on "has one planned" put the whole
       crew in the queue and left the floor empty. Only people whose break is
       actually close stand in it; the rest are on the floor with the time
       written under their name. */
    const t = next ? next.startMin - demo.t : null;
    if (next && t < SOON_MIN) {
      cast.push({ p, lane: 'next', kind: next.kind, in: t,
                  due: t <= 0, warn: t > 0 && t <= WARN_LEAD_MIN, soon: t > 0 });
    } else {
      cast.push({ p, lane: 'floor', kind: next?.kind ?? null, in: t });
    }
  }
  /* Angela: "Has not clocked in should still show their emoji." So the crew
     who are rostered but not in yet stand on the floor as GHOSTS -- dimmed,
     still, their due time under the name. They are scenery, not participants:
     no walking, no grooming, no chases, and the floor count does not include
     them, because they are not on the floor. Clocked-out people still leave
     entirely; a finished shift has gone home. */
  for (const p of demoPeople()){
    if (p.in != null || p.out != null) continue;
    cast.push({ p, lane: 'floor', ghost: true, in: null });
  }
  cast.sort((a, b) =>
    (a.ghost ? 1 : 0) - (b.ghost ? 1 : 0)
    || (a.lane === 'break' ? (a.rem ?? 0) - (b.rem ?? 0) : (a.in ?? 0) - (b.in ?? 0))
    || a.p.name.localeCompare(b.p.name));
  return { cast, conflicts, plan, on,
           counts: { break: cast.filter(c => c.lane==='break').length,
                     next:  cast.filter(c => c.lane==='next').length,
                     floor: cast.filter(c => c.lane==='floor' && !c.ghost).length,
                     ghost: cast.filter(c => c.ghost).length } };
}


/* ---- the simulate buttons ------------------------------------------------
   Angela: "I need a series of test buttons to show what's going to happen
   when someone's within 10 minutes, when someone's within 5 minutes, when
   someone hasn't clocked in for their break, and when someone hasn't clocked
   out for their lunch. Who's on break? I need buttons to simulate all these
   things."

   Every one of these rigs the REAL state -- punches and the clock -- and then
   lets the planner and the alert rules do what they would do in the hall. None
   of them force a banner on screen directly. If a button shows you something,
   the product does that thing; if the product stops doing it, the button
   stops showing it. A demo that paints the outcome instead of causing it is
   worth nothing, because it goes on working after the feature breaks.
------------------------------------------------------------------------- */
const DEMO_SIMS = [
  ['in10',    'Break in 10 min',      'the queue goes amber'],
  ['in5',     'Break in 5 min',       'red, and the name across the screen'],
  ['due',     'Break due, not taken', 'the take-over card'],
  ['onbreak', "Who's on break",       'two people away, counting down'],
  ['lunch',   'Not back from lunch',  'overdue, and the alert fires'],
  ['noout',   'Never clocked out',    'end of night, shift left open'],
  ['noin',    'Never clocked in',     '15 minutes past their start'],
];

const demoOpenMin = () =>
  Math.min(...demo.crew.map(p => p.startMin ?? 1e9).filter(Number.isFinite));

/* Everybody in, on time, nothing taken yet — the state every scenario starts
   from so one button never leaves a mess behind for the next. */
function demoAllIn(){
  demo.punch = {};
  for (const c of demo.crew)
    if (c.startMin != null) demo.punch[c.id] = { in: c.startMin, out: null, breaks: [] };
  demoSeen.clear();
  demoWarnFired.clear();
  demoTakeoverWho = null; demoTakeoverUntil = 0;
}

/* Run the night, and stop at the first minute the board is in the state we
   want to show.

   Two earlier versions of this were wrong, and both failures are worth
   keeping written down.

   The first did arithmetic: "set the clock five minutes before somebody's next
   break". But the plan is computed FROM the clock, so moving the clock moved
   the plan, and with a full crew the break slid forward to meet the new now --
   the 5-minute button showed DUE NOW. A unit test on a six-person fixture
   passed while the twenty-two-person screenshot was wrong.

   The second scanned the clock forward looking for the state. Better, but it
   never found "ten minutes away", because in a hall where nobody ever takes a
   break every overdue break is re-proposed at now, forever. The soonest break
   was 0 minutes away at every single minute of the night.

   So this runs the night properly: as the clock advances, breaks that come due
   are taken and breaks that finish are closed, one at a time, the way a
   compliant crew behaves. The queue drains, and the quiet minutes where
   somebody is genuinely ten minutes out actually exist. */
const BREAK_MIN = { meal: 30, rest: 10 };

function demoCloseFinished(keepOpen){
  for (const c of demo.crew){
    if (c.id === keepOpen) continue;          // this one never comes back
    const pu = demo.punch[c.id];
    if (!pu) continue;
    for (const b of pu.breaks)
      if (b.end == null && demo.t >= b.start + (BREAK_MIN[b.kind] ?? 10))
        b.end = b.start + (BREAK_MIN[b.kind] ?? 10);
  }
}

/* One at a time. A break the planner has marked due is already coverage-
   approved, but a backlog of them all going at once is not — and a backlog is
   exactly what a night with nobody breaking accumulates. */
function demoTakeOneDue(model){
  const due = model.cast.find(c => c.lane === 'next' && c.due);
  if (!due) return false;
  const pu = demo.punch[due.p.id];
  if (!pu || pu.breaks.some(b => b.end == null)) return false;
  pu.breaks.push({ kind: due.kind, start: demo.t, end: null });
  return true;
}

function demoRunNight(pred, opts = {}){
  const { fromOffset = 100, keepOpen = null, restart = true } = opts;
  if (restart) demoAllIn();
  const last = Math.max(...demo.crew.map(p => p.endMin ?? 0));
  const t0 = demo.t;
  const from = restart ? demoOpenMin() + fromOffset : demo.t + 1;
  for (let t = from; t <= last; t++){
    demo.t = t;
    demoCloseFinished(keepOpen);
    const m = demoBoardModel();
    if (pred(m)) return true;
    demoTakeOneDue(m);
  }
  demo.t = t0;                 // nothing found: leave the clock where it was
  return false;
}

/* Nobody standing due, so the take-over card is not covering the thing the
   button was pressed to show. */
const noneDue = m => !m.cast.some(c => c.lane === 'next' && c.due);

const soonestInQueue = m =>
  m.cast.filter(c => c.lane === 'next').sort((a, b) => a.in - b.in)[0] || null;

function demoSim(kind){
  if (!demo) return;
  /* Bands, not exact minutes: the planner decides where breaks land, and this
     asks it for a minute that falls in the band rather than telling it. */
  /* ...and nobody due at the same moment, or the take-over card covers the
     very tag the button exists to show. Falls back to the band alone if the
     night contains no such quiet minute. */
  /* ...and nobody due at the same moment, or the take-over card covers the
     very tag the button exists to show. */
  const band = (lo, hi) => m => {
    const x = soonestInQueue(m);
    return x && x.in > lo && x.in <= hi
      && !m.cast.some(c => c.lane === 'next' && c.due);
  };
  if (kind === 'in10') return void demoRunNight(band(7, 11));
  if (kind === 'in5')  return void demoRunNight(band(2, 5));
  if (kind === 'due')  return void demoRunNight(m =>
    m.cast.some(c => c.lane === 'next' && c.due));

  /* Not rigged: run the night until people are genuinely away. */
  if (kind === 'onbreak') return void (demoRunNight(m => m.counts.break >= 2)
                                    || demoRunNight(m => m.counts.break >= 1));

  if (kind === 'lunch'){
    /* Somebody really goes to lunch, and then simply does not come back --
       the clock runs on and their punch stays open, which is exactly what the
       alert exists to catch. The night keeps running around them, so the
       board is not also buried under a take-over card for somebody else. */
    if (!demoRunNight(m => m.cast.some(c => c.lane === 'break' && c.kind === 'meal'))) return;
    const who = demo.crew.find(c => demo.punch[c.id]?.breaks.some(
      b => b.end == null && b.kind === 'meal'));
    if (!who) return;
    const meal = demo.punch[who.id].breaks.find(b => b.end == null && b.kind === 'meal');
    const overdueBy = 12;
    demoRunNight(m => demo.t >= meal.start + BREAK_MIN.meal + overdueBy && noneDue(m),
                 { keepOpen: who.id, restart: false });
    return;
  }

  if (kind === 'noout'){
    demoAllIn();
    const ends = demo.crew.map(c => c.endMin).filter(Number.isFinite);
    if (!ends.length) return;
    demo.t = Math.min(...ends) + 20;
    /* Everybody closes out at their scheduled end except one, or the board is
       a wall of identical alerts and the point is lost. */
    let first = true;
    for (const c of demo.crew){
      const pu = demo.punch[c.id];
      if (!pu || c.endMin == null) continue;
      if (first && c.endMin <= demo.t){ first = false; continue; }
      if (c.endMin <= demo.t) pu.out = c.endMin;
    }
    return;
  }

  if (kind === 'noin'){
    demoAllIn();
    demo.t = demoOpenMin() + LATE_IN_MIN + 5;
    const late = demo.crew.find(c => c.startMin === demoOpenMin());
    if (late) delete demo.punch[late.id];
    return;
  }
}

/* What the red bar says. The raw conflict list is one entry per break, so a
   short-staffed role produced twelve lines of "nobody can cover Abel" for what
   is a single fact about the roster. summariseConflicts() groups it; this puts
   the sentences on screen, worst first. */
function demoConflictNote(conflicts, plan){
  const roleName = id => D.roles.find(r => r.id === id)?.name || 'this role';
  const bad  = summariseConflicts(conflicts, roleName);
  const thin = summariseDips(plan || [], roleName);
  return (bad.length ? `<div class="note bad">
      <strong>${bad.length} break${bad.length===1?'':'s'} could not be fitted.</strong>
      ${bad.map(x => esc(x.text)).join(' ')}</div>` : '')
    /* Thin coverage is a note, not an alarm: everybody still gets their break,
       which is the rule. It is here so a manager can choose to roster one more
       person, not so the board can refuse anybody. */
    + (thin.length ? `<div class="note">${thin.map(x => esc(x.text)).join(' ')}</div>` : '');
}

/* The shell only. Everything inside #dcast is built and moved by the loop
   below, because re-rendering a scene forty times a minute would throw away
   where everybody was standing. */
function demoBoard(){
  const s = D.sessions.find(x => x.id === demo.sessionId);
  const m = demoBoardModel();
  return `<h2>Break board <span class="rtime">the full screen, as it hangs in the hall</span></h2>
    <div class="panel dsims">
      <span class="rtime">Show me what happens when…</span>
      ${DEMO_SIMS.map(([k, t, why]) => `<button class="btn" data-dsim="${k}"
        title="${esc(why)}">${esc(t)}</button>`).join('')}
    </div>
    ${demoConflictNote(m.conflicts, m.plan)}
    <div class="tv" id="dtv">
      <div class="tvhead">
        <span class="tvhall">FRONTIER BINGO · ${esc((HALLNAME[s?.hall_id]||'').toUpperCase())}</span>
        <span class="tvclock" id="dtvclock">${dclock(demo.t)}</span>
      </div>
      <div class="lane lbreak"><span class="zl" id="dlbl-break">BREAK ROOM</span>
        <span class="zempty" id="dmt-break">Nobody on break right now</span></div>
      <div class="lane lnext"><span class="zl" id="dlbl-next">UP NEXT</span>
        <span class="zempty" id="dmt-next">No break due in the next 12 minutes</span></div>
      <div class="lane lfloor"><span class="zl" id="dlbl-floor">ON THE FLOOR</span>
        <span class="zempty" id="dmt-floor">Nobody clocked in</span></div>
      <div class="tvstrip"></div>
      <div id="dcast"></div>
      <div class="tvalerts" id="dalerts"></div>
      <div class="dtake" id="dtake"><div class="dtcard"><div class="dtn"></div>
        <div class="dtw"></div><div class="dts">Tap the tablet to start — or postpone</div>
        <img class="dtimg" alt=""></div></div>
    </div>
    <div class="rtime" style="margin-top:8px">Everyone on this board is somebody really
      rostered on ${esc(label(s))}. Drag the clock and watch them walk to break.</div>`;
}

/* ---- the scene ---------------------------------------------------------- */
function demoSceneLive(){ return !!document.getElementById('dcast'); }

/* One element per person, made once and kept. */
function demoCharacter(p, boss){
  const el = document.createElement('div');
  el.className = 'pc' + (boss ? ' boss' : '');
  el.dataset.pcid = p.id;
  el.innerHTML = `<div class="body"><img alt=""></div>
    <div class="tag"><b></b><span class="sub"></span><span class="cd"></span></div>`;
  return { el, img: el.querySelector('img'), nm: el.querySelector('b'),
           sub: el.querySelector('.sub'), cd: el.querySelector('.cd'),
           x: 0, lane: null, laneUntil: 0, kind: p.pet_kind,
           speed: 0.7 + Math.random()*1.1, nextRoll: 15*Math.random(),
           groomingWith: null, groomUntil: 0, fleeing: false, chasing: false };
}

/* every 15s each character on the floor may change pace — sometimes to a stop */
function demoRollSpeeds(t){
  for (const c of demoCast.values()){
    if (c.lane !== 'floor' || t < c.nextRoll) continue;
    c.nextRoll = t + 15;
    if (Math.random() < 0.30){
      const r = Math.random();
      c.speed = r < 0.28 ? 0
              : r < 0.55 ? 0.5 + Math.random()*0.3
              : r < 0.85 ? 0.9 + Math.random()*0.5
              :            1.6 + Math.random()*0.6;
    }
  }
}

/* Keep the name tags apart. Everyone walks the same way at their own pace, so
   a faster character eventually catches a slower one and the two tags print on
   top of each other -- which is the one thing that makes the board unreadable.
   Rather than freeze anybody, the one behind eases off until the gap opens
   again. It looks like somebody slowing down behind a colleague, which is what
   actually happens on a floor. */
function demoSeparate(W){
  const floor = [...demoCast.values()]
    .filter(c => c.lane === 'floor' && !c.ghost && !c.groomingWith && !c.chasing && !c.fleeing)
    .sort((a, b) => a.x - b.x)
    .reverse();          // front of the queue first, so a cap propagates back
  for (let i = 1; i < floor.length; i++){
    const gap = floor[i-1].x - floor[i].x;   // leader is floor[i-1], behind is floor[i]
    if (gap >= SLOT_W) continue;
    /* The one in front is unaffected; the one behind is capped BELOW the
       leader's pace in proportion to how close it has got, so the gap opens
       instead of merely closing more slowly. Easing alone was not enough --
       a follower at 67% of full speed still caught a leader at 50%. */
    floor[i].cap = Math.min(floor[i].cap ?? Infinity,
                            (floor[i-1].cap ?? floor[i-1].speed) * (gap / SLOT_W));
  }
}

/* two stopped cats standing close together — one grooms the other */
function demoGrooming(t, W){
  const idle = [...demoCast.values()].filter(c =>
    c.lane === 'floor' && !c.ghost && c.kind !== 'dog' && c.speed === 0
    && !c.groomingWith && t > c.groomUntil && !c.fleeing);
  for (let i = 0; i < idle.length; i++) for (let j = i+1; j < idle.length; j++){
    if (Math.abs(idle[i].x - idle[j].x) >= W*0.09) continue;
    const [a, b] = idle[i].x < idle[j].x ? [idle[i], idle[j]] : [idle[j], idle[i]];
    b.x = a.x + W*0.07;
    a.groomingWith = b; b.groomingWith = a; b.isGroomer = true; a.isGroomer = false;
    a.groomUntil = b.groomUntil = t + 9 + Math.random()*5;
    b.el.classList.add('grooming'); b.el.classList.remove('walking');
    a.el.classList.remove('walking');
    const h = document.createElement('div');
    h.className = 'heart'; h.textContent = '💛';
    a.el.appendChild(h); a.heart = h;
    return;
  }
  for (const c of demoCast.values()){
    if (!c.groomingWith || t <= c.groomUntil) continue;
    c.groomingWith = null; c.isGroomer = false;
    c.el.classList.remove('grooming');
    if (c.heart){ c.heart.remove(); c.heart = null; }
    c.speed = 0.7 + Math.random()*0.9;
  }
}

/* The director. Every INTERACT_EVERY seconds exactly one thing happens,
   picked from whatever is possible right now. The alert take-over still
   suppresses everything -- the board's job outranks the show. */
function demoBubble(ch, text){
  if (ch.bub) ch.bub.remove();
  const b = document.createElement('div');
  b.className = 'bubble'; b.textContent = text;
  ch.el.appendChild(b); ch.bub = b;
  setTimeout(() => { if (ch.bub === b){ b.remove(); ch.bub = null; } }, 1800);
}

function demoBeginChase(chaser, target, t, mode){
  demoChase = { dog: chaser, cat: target,
    until: t + (mode === 'chase' ? 8 : 14), mode };
  chaser.chasing = true;
  chaser.el.classList.add('chasing');
  /* A snub target does not flee -- they have no idea they are being judged.
     That obliviousness is half the joke. */
  if (mode !== 'snub'){
    target.fleeing = true;
    target.el.classList.add('fleeing');
    demoBubble(target, '!');
  }
}
function demoEndChase(){
  if (!demoChase) return;
  const { dog, cat } = demoChase;
  dog.chasing = cat.fleeing = false;
  dog.el.classList.remove('chasing'); cat.el.classList.remove('fleeing');
  if (cat.bub){ cat.bub.remove(); cat.bub = null; }
  dog.speed = 0.7 + Math.random()*0.8; cat.speed = 0.7 + Math.random()*0.8;
  demoChase = null;
}

/* A cat loving on something: walks up beside it, both stop, hearts. Reuses
   the grooming machinery, so it ends by itself and excludes them from other
   interactions while it lasts. */
function demoLove(cat, other, t){
  other.x = cat.x + 44;
  cat.groomingWith = other; other.groomingWith = cat;
  cat.groomUntil = other.groomUntil = t + 8 + Math.random()*4;
  cat.el.classList.add('grooming');
  cat.el.classList.remove('walking'); other.el.classList.remove('walking');
  const h = document.createElement('div');
  h.className = 'heart'; h.textContent = '💛';
  other.el.appendChild(h); other.heart = h;
}

/* The robot disintegrates somebody. They do not leave: their sprite becomes
   an ash cloud that keeps drifting with their name under it, and they reform
   after PUFF_REVERT_S. From the VFX handoff, sized to this scene. */
function demoZap(robot, victim, t){
  robot.speed = 0;
  /* The beam: drawn robot-to-victim, fired before anything else happens so
     the cause is on screen before the effect. Positions come from the live
     elements rather than scene coordinates, so it lands wherever the two of
     them actually are mid-stride. */
  const layer = document.getElementById('dcast');
  if (layer){
    const L = layer.getBoundingClientRect();
    const r = robot.el.getBoundingClientRect(), v = victim.el.getBoundingClientRect();
    const x1 = r.left + r.width/2 - L.left, x2 = v.left + v.width/2 - L.left;
    const y  = (r.top + v.top)/2 + r.height*0.32 - L.top;
    const beam = document.createElement('div');
    beam.className = 'zapbeam' + (x2 < x1 ? ' rev' : '');
    beam.style.cssText = `left:${Math.min(x1,x2)}px;top:${y}px;width:${Math.abs(x2-x1)}px`;
    layer.appendChild(beam);
    setTimeout(() => beam.remove(), 520);
  }
  demoBubble(robot, '⚡');
  /* the strike lands when the beam arrives, not before */
  setTimeout(() => victim.el.classList.add('zapflash'), 180);
  setTimeout(() => {
    victim.el.classList.remove('zapflash');
    victim.puffed = true; victim.puffUntil = t + PUFF_REVERT_S;
    victim.speed = Math.max(0.35, victim.speed * 0.5);
  }, 480);
}

function demoBite(target, t){
  target.bitten = true; target.bittenUntil = t + BITE_REVERT_S;
  demoBubble(target, 'chomp!');
  demoEndChase();
}

/* THE SNUB. The cat has arrived. Both stop; the cat sits and considers the
   manager for a couple of seconds; then everyone walks on as if nothing
   happened, and the manager gets a '…' -- the only acknowledgement anyone
   makes. The pause rides the grooming machinery (which already stops the
   pair, sits the cat, and releases them on its own timer); the difference is
   no hearts, because nothing here is affection. */
let demoSnubDone = null;
function demoSnubArrive(cat, target, t){
  demoEndChase();
  cat.groomingWith = target; target.groomingWith = cat;
  cat.groomUntil = target.groomUntil = t + 2.4;
  cat.el.classList.remove('walking'); target.el.classList.remove('walking');
  demoSnubDone = { target, at: t + 2.5 };
}

/* THE CONGA. A follower falls in behind a leader and matches pace at a fixed
   gap; after ten seconds a third joins if anybody is close enough behind.
   Nothing else may interrupt the line while it lasts -- that is what makes it
   read as a bit rather than a coincidence. */
let demoConga = null;
function demoCongaStep(t){
  if (!demoConga) return;
  if (t > demoConga.until
      || demoConga.chain.some(c => c.lane !== 'floor' || c.puffed)){
    for (const c of demoConga.chain){ c.inConga = false; c.speed = 0.7 + Math.random(); }
    demoConga = null;
    return;
  }
  const chain = demoConga.chain;
  if (demoConga.growAt && t >= demoConga.growAt){
    demoConga.growAt = null;
    const tail = chain[chain.length - 1];
    const cand = [...demoCast.values()].find(c =>
      c.lane === 'floor' && !c.ghost && !c.inConga && !c.groomingWith && !c.puffed
      && !c.chasing && !c.fleeing && c.x < tail.x && tail.x - c.x < 500);
    if (cand){ cand.inConga = true; chain.push(cand); }
  }
  for (let i = 1; i < chain.length; i++){
    const want = chain[i-1].x - 62;
    chain[i].x += (want - chain[i].x) * 0.12;
    chain[i].speed = chain[0].speed;
    chain[i].el.classList.add('walking');
  }
}

function demoDirector(t, W, alertOn){
  if (demoChase){
    const { dog: ch, cat: tg, mode } = demoChase;
    if (alertOn || t > demoChase.until || ch.lane !== 'floor' || tg.lane !== 'floor')
      return demoEndChase();
    /* the track wraps; if the target ever ends up behind the chaser, the
       picture inverts, so the chase ends instead of running backwards */
    if (tg.x < ch.x - 40) return demoEndChase();
    if (mode === 'nibble'){
      /* the chaser is FASTER, so it catches up -- and then the bite */
      ch.speed = 3.6; tg.speed = 2.2;
      if (Math.abs(ch.x - tg.x) < 48) demoBite(tg, t);
    } else if (mode === 'snub'){
      /* the cat closes at a dignified pace on a target who suspects nothing */
      ch.speed = 2.9;
      if (Math.abs(ch.x - tg.x) < 46) demoSnubArrive(ch, tg, t);
    } else {
      /* dogs never catch cats; the cat is faster by design */
      tg.speed = 3.4; ch.speed = 2.8;
    }
    return;
  }
  demoCongaStep(t);
  if (demoSnubDone && t >= demoSnubDone.at){
    demoBubble(demoSnubDone.target, '…');
    demoSnubDone = null;
  }
  if (alertOn || t < demoNextAct) return;
  demoNextAct = t + INTERACT_EVERY;

  const floor = [...demoCast.values()].filter(c =>
    c.lane === 'floor' && !c.ghost && !c.groomingWith && !c.puffed
    && !c.chasing && !c.fleeing && !c.inConga);
  const kind = k => floor.filter(c => c.kind === k);
  const near = (a, b) => Math.abs(a.x - b.x) < W * 0.55;
  /* A chase target must be AHEAD of its chaser. Everyone walks rightward, so
     a "chaser" that starts in front is overtaken by its own fleeing target --
     which reads as the food chasing the animal, and did. Angela saw it. */
  const ahead = (a, b) => b.x > a.x + 30;
  const opts = [];
  for (const d of kind('dog'))   for (const c of kind('cat'))
    if (near(d, c) && ahead(d, c)) opts.push(['chase', d, c]);
  for (const a of floor) if (a.kind !== 'snack')
    for (const f of kind('snack'))
      if (near(a, f) && ahead(a, f) && !f.bitten) opts.push(['nibble', a, f]);
  for (const c of kind('cat'))   for (const o of floor) if (o !== c && near(c, o)) opts.push(['love', c, o]);
  for (const r of kind('robot')) for (const v of floor)
    if (v !== r && v.kind !== 'robot' && v.kind !== 'snack' && near(r, v)) opts.push(['zap', r, v]);
  /* the snub: a cat, a manager, and a payoff that never comes */
  for (const c of kind('cat')) for (const m of floor)
    if ((m.kind === 'boss' || m.kind === 'hero') && near(c, m) && ahead(c, m))
      opts.push(['snub', c, m]);
  /* the conga: only when no line is already going */
  if (!demoConga)
    for (const l of floor) for (const f of floor)
      if (f !== l && ahead(f, l) && near(f, l)) opts.push(['conga', l, f]);
  if (!opts.length) return;
  const [what, x, y] = opts[(Math.random() * opts.length) | 0];
  if (what === 'chase')  demoBeginChase(x, y, t, 'chase');
  if (what === 'nibble') demoBeginChase(x, y, t, 'nibble');
  if (what === 'snub')   demoBeginChase(x, y, t, 'snub');
  if (what === 'love')   demoLove(x, y, t);
  if (what === 'zap')    demoZap(x, y, t);
  if (what === 'conga'){ y.inConga = x.inConga = true;
    demoConga = { chain: [x, y], until: t + 30, growAt: t + 10 }; }
}

/* Everything above is behaviour. This is the frame: read the model, put every
   character where their state says they belong, and let CSS carry them there. */
function demoSceneFrame(ms){
  const layer = document.getElementById('dcast');
  if (!layer || !demo){ demoSceneStop(); return; }
  const dt = Math.min(0.1, Math.max(0, (ms - demoLastMs) / 1000));
  demoLastMs = ms; demoSceneT += dt;
  const t = demoSceneT;
  const W = Math.max(320, layer.clientWidth), H = Math.max(360, layer.clientHeight);

  const m = demoBoardModel();
  const seen = new Set();
  const lanes = { break: [], next: [], floor: [] };
  for (const c of m.cast) lanes[c.lane].push(c);

  for (const lane of ['break', 'next', 'floor']){
    lanes[lane].forEach((item, i) => {
      const p = item.p;
      seen.add(p.id);
      let ch = demoCast.get(p.id);
      if (!ch){
        ch = demoCharacter(p, isMorRole(p.roleId));
        /* On the first frame everybody is already at work, so spread them
           across the floor the way the prototype did. After that, somebody
           new has just clocked in -- they walk on from the left. */
        const span = W * trackX(lanes.floor.length, W);
        ch.x = demoSceneSeeded
          ? -110 - i*60
          : Math.round(X0 + i * (span - X0*2) / Math.max(1, lanes[lane].length - 1 || 1));
        layer.appendChild(ch.el);
        demoCast.set(p.id, ch);
      }
      if (ch.bitten && t >= ch.bittenUntil) ch.bitten = false;
      if (ch.puffed && t >= ch.puffUntil){ ch.puffed = false; ch.speed = 0.7 + Math.random(); }
      const pose = lane === 'floor' && !ch.groomingWith ? 'walk' : 'sit';
      const src = ch.puffed ? DEMO_PUFF
        : petSrc(ch.bitten ? p.pet + '-bit' : p.pet, p.pet_kind, pose);
      if (ch.img.getAttribute('src') !== src) ch.img.src = src;
      if (ch.nm.textContent !== p.name) ch.nm.textContent = p.name;

      /* the lane change is the whole point — glide, do not teleport */
      if (ch.lane !== lane){
        ch.lane = lane; ch.laneUntil = t + 1.1;
        ch.el.classList.add('travel');
        ch.el.classList.remove('grooming', 'fleeing', 'chasing');
        ch.groomingWith = null;
        if (ch.heart){ ch.heart.remove(); ch.heart = null; }
      } else if (ch.laneUntil && t > ch.laneUntil){
        ch.laneUntil = 0; ch.el.classList.remove('travel');
      }

      /* One person, so the role reads singular: Nancy is a Flash Runner, not
         a Flash Runners. */
      let sub = roleOne(p.role), cd = '', cls = '';   // cd = the line under the name
      if (lane === 'break'){
        sub = item.kind === 'meal' ? '30-min meal' : '10-min break';
        cd  = item.over ? `+${mins(item.rem)} over` : `${mins(item.rem)} left`;
        cls = item.over ? 'over' : item.kind;
        ch.x = X0 + i * SLOT_W;
      } else if (lane === 'next'){
        sub = (item.kind === 'meal' ? '🍽 meal' : '☕ break');
        cd  = item.due ? 'DUE NOW' : `in ${mins(item.in)}`;
        cls = item.due ? 'over' : item.warn ? 'warn' : item.soon ? 'soon' : '';
        ch.x = X0 + i * SLOT_W;
      } else if (item.ghost) {
        sub = roleOne(p.role);
        cd = p.startMin != null ? `due ${dclock(p.startMin)}` : 'not in yet';
        /* parked at a fixed slot along the track; walkers pass them by */
        if (ch.ghostX == null) ch.ghostX = X0 + i * SLOT_W;
        ch.x = ch.ghostX;
      } else {
        if (item.in != null) cd = `break in ${mins(item.in)}`;
        if (!ch.groomingWith && !demoTakeoverOn){
          const pace = Math.min(ch.speed, ch.cap ?? Infinity);
          ch.cap = undefined;
          ch.x += pace * dt * W * 0.022;
          if (ch.x > W * trackX(lanes.floor.length, W)) ch.x = -90;
        }
      }
      ch.ghost = !!item.ghost;
      ch.el.classList.toggle('ghost', ch.ghost);
      /* asleep at the station: everyone in the break room gets their z's */
      ch.el.classList.toggle('sleep', lane === 'break');
      ch.el.classList.toggle('walking',
        lane === 'floor' && !ch.ghost && ch.speed > 0
        && !ch.groomingWith && !ch.chasing && !ch.fleeing);
      if (ch.sub.textContent !== sub) ch.sub.textContent = sub;
      if (ch.cd.textContent !== cd) ch.cd.textContent = cd;
      if (ch.state !== cls){ ch.state = cls;
        ch.el.className = ch.el.className.replace(/\s(meal|rest|warn|soon|over)\b/g, '')
          + (cls ? ' ' + cls : ''); }
      /* the CSS `translate` property, not a transform function: the bob and
         groom animations own `transform` on .body, and this keeps the two
         from fighting over the same declaration. */
      /* A few pixels of vertical scatter on the floor: two characters that do
         pass each other then read as one in front of the other rather than as
         two name tags printed on top of each other. */
      const jitter = lane === 'floor' ? (ch.lift ??= (p.id.charCodeAt(0) % 5) * 7 - 14) : 0;
      ch.el.style.translate =
        `${Math.round(ch.x)}px ${Math.round(H * LANE_Y[lane] + jitter)}px`;
    });
  }

  /* whoever clocked out, or has not clocked in, leaves the scene */
  for (const [id, ch] of demoCast){
    if (seen.has(id)) continue;
    ch.el.remove(); demoCast.delete(id);
    if (demoChase && (demoChase.dog === ch || demoChase.cat === ch)) demoEndChase();
  }

  demoRollSpeeds(t); demoSeparate(W); demoGrooming(t, W);
  const due = lanes.next.find(x => x.due);
  demoTakeover(due, t);
  demoDirector(t, W, demoTakeoverOn);
  demoSceneLabels(m.counts);
  demoSceneAlerts();

  const clk = document.getElementById('dtvclock');
  if (clk) clk.textContent = dclock(demo.t);
  demoSceneSeeded = true;
  demoRaf = requestAnimationFrame(demoSceneFrame);
}

let demoTakeoverOn = false, demoTakeoverWho = null, demoTakeoverUntil = 0;
function demoTakeover(due, t){
  const tk = document.getElementById('dtake');
  if (!tk) return;
  if (!due) { demoTakeoverWho = null; }
  else if (demoTakeoverWho !== due.p.id){
    demoTakeoverWho = due.p.id; demoTakeoverUntil = t + TAKEOVER_HOLD_S;
  }
  const show = !!due && t < demoTakeoverUntil;
  demoTakeoverOn = show;
  tk.classList.toggle('show', show);
  for (const [id, ch] of demoCast) ch.el.classList.toggle('dim', show && id !== due.p.id);
  if (!show) return;
  tk.querySelector('.dtn').textContent = due.p.name.toUpperCase();
  tk.querySelector('.dtw').textContent = due.kind === 'meal' ? '30 MIN BREAK NOW' : '10 MIN BREAK NOW';
  const img = tk.querySelector('.dtimg'), src = petSrc(due.p.pet, due.p.pet_kind, 'sit');
  if (img.getAttribute('src') !== src) img.src = src;
}

function demoSceneLabels(counts){
  for (const k of ['break', 'next', 'floor']){
    const el = document.getElementById('dlbl-' + k);
    if (!el) continue;
    let txt = ({ break:'BREAK ROOM', next:'UP NEXT', floor:'ON THE FLOOR' })[k]
      + (counts[k] ? ` — ${counts[k]}` : '');
    if (k === 'floor' && counts.ghost) txt += ` · ${counts.ghost} NOT IN YET`;
    if (el.textContent !== txt) el.textContent = txt;
    /* An empty lane that says nothing reads as a bug. Say why it is empty. */
    const mt = document.getElementById('dmt-' + k);
    if (mt) mt.style.display = (counts[k] || (k === 'floor' && counts.ghost)) ? 'none' : '';
  }
}

/* The attendance alerts stack down the right, loudest first, exactly as they
   do on board.html — several at once, which is what was asked for. */
function demoSceneAlerts(){
  const box = document.getElementById('dalerts');
  if (!box) return;
  const alerts = demoAlerts();
  /* The character rides along on the alert card -- the board's whole language
     is "person = icon", and an alert without one reads as a different system
     interrupting rather than the same board talking. */
  const face = a => {
    const c = demo.crew.find(x => x.id === a.id);
    return c?.pet ? `<img class="aface" src="${esc(petSrc(c.pet, c.pet_kind, 'sit'))}" alt="">` : '';
  };
  const html = alerts.slice(0, 4).map(a => `<div class="dalert ${a.kind}${a.loud?' loud':''}">
      ${face(a)}<span><strong>${esc(a.name)}</strong> ${esc(ALERT_WHAT[a.kind])}
      <span class="rtime"> · ${a.over} min</span></span></div>`).join('')
    + (alerts.length > 4 ? `<div class="rtime">+${alerts.length-4} more</div>` : '');
  if (box.dataset.sig !== html){ box.dataset.sig = html; box.innerHTML = html; }
}

function demoSceneStop(){
  if (demoRaf) cancelAnimationFrame(demoRaf);
  demoRaf = null; demoCast.clear(); demoEndChase(); demoNextAct = 10;
  demoConga = null; demoSnubDone = null;
  demoTakeoverOn = false; demoTakeoverWho = null; demoTakeoverUntil = 0;
}
function demoSceneStart(){
  demoSceneStop();
  if (!demoSceneLive()) return;
  demoLastMs = performance.now(); demoWarnFired.clear(); demoSceneSeeded = false;
  demoRaf = requestAnimationFrame(demoSceneFrame);
}
/* Dragging the clock must not rebuild the board — the scene reads demo.t on
   its own next frame, and everybody keeps standing where they were. */
function demoSceneTime(){
  const el = document.getElementById('dtvclock');
  if (el) el.textContent = dclock(demo.t);
}

/* ---- 3. the worker's own page -------------------------------------------
   The portal EXISTS -- me.html is live, reached by the tokenised link, and
   this tab is a faithful picture of its screens driven off the same data.
   Angela: "I need a variety of screens... you've been assigned a shift,
   confirm your shift, hours, overtime, commission."

   So the phone has the portal's own tabs. Confirming a shift here records the
   answer in demo state only (demo.resp) -- pressing Got it in a demo must
   never write a response the worker never gave.
------------------------------------------------------------------------- */
const W_TABS = [['shifts','My shifts'],['hours','My hours'],['pet','My character']];

function demoWorker(){
  const p = demoPeople().find(x => x.id === demo.who) || demoPeople()[0];
  if (!p) return '<div class="panel">Nobody on this session.</div>';
  demo.wtab = demo.wtab || 'shifts';
  demo.resp = demo.resp || {};
  const body = { shifts: wShifts, hours: wHours, pet: wPet }[demo.wtab](p);
  return `<h2>Worker portal <span class="rtime">what they see on the link they are texted</span></h2>
    <div class="panel" style="margin-bottom:10px">
      <label class="rtime">Look as: </label>
      <select id="dwho">${demo.crew.map(c => `<option value="${c.id}" ${
        c.id===p.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select>
      <span class="rtime" style="margin-left:8px">No login — the link IS the credential.</span>
    </div>
    <div class="dphone">
      <div class="dph-top">${petChip(p.id)}<strong>Hi ${esc(p.name.split(' ')[0])}</strong></div>
      <div class="wnav">${W_TABS.map(([k,t]) => `<button class="wtab ${
        demo.wtab===k?'on':''}" data-wtab="${k}">${t}</button>`).join('')}</div>
      ${body}
    </div>`;
}

function wMine(p){
  const from = (typeof DEMO_TODAY === 'string') ? DEMO_TODAY
    : new Date().toISOString().slice(0,10);
  return D.assigns.filter(a => a.staff_id === p.id)
    .map(a => ({ a, s: D.sessions.find(x => x.id === a.session_id) }))
    .filter(x => x.s && x.s.session_date >= from)
    .sort((x,y) => x.s.session_date.localeCompare(y.s.session_date));
}

function wShifts(p){
  const mine = wMine(p).slice(0,6);
  /* The newest unanswered shift wears the banner: this is the screen the
     "you're on the schedule" text lands on. */
  let flagged = false;
  const card = ({a,s}) => {
    const ans = demo.resp[a.id] || (a.response === 'yes' ? 'yes' : null);
    const isNew = !ans && !flagged && (flagged = true);
    return `<div class="dph-card" ${isNew?'style="border-left:4px solid var(--deployed)"':''}>
      ${isNew?`<div class="wnew">NEW SHIFT — please confirm</div>`:''}
      <strong>${esc(label(s))}</strong>
      <div class="rtime">${esc(HALLNAME[s.hall_id])} · ${
        esc(roleOne(D.roles.find(r=>r.id===a.role_id)?.name||''))}${
        a.scheduled_start?` · from ${a.scheduled_start.slice(0,5)}`:''}${
        a.early_start?' · early for buy-ins':''}</div>
      ${ans === 'yes' ? `<div class="wok">✓ Confirmed — see you there</div>`
      : ans === 'no' ? `<div class="wno">✗ Declined — your manager has been told</div>`
      : `<div style="margin-top:6px"><button class="btn primary" data-dresp="${a.id}|yes">Got it</button>
         <button class="btn" data-dresp="${a.id}|no">Can't make it</button>
         <button class="btn">Hand over</button></div>`}
    </div>`;
  };
  return `<div class="dph-h">My shifts</div>
    ${mine.length ? mine.map(card).join('') : '<div class="rtime">Nothing published yet.</div>'}
    ${p.out == null && p.in != null && p.endMin != null && demo.t > p.endMin
      ? `<div class="dph-h">Your time needs fixing</div>
        <div class="dph-card" style="border-left:4px solid var(--warn)">
          <strong>You did not clock out</strong>
          <div class="rtime">It should have been about ${dclock(p.endMin)}.</div>
          <div style="margin-top:6px"><button class="btn primary">This is when my shift ended</button></div>
        </div>` : ''}`;
}

/* Hours, overtime, commission -- the same arithmetic the manager's payroll
   screens run, shown at phone size. Angela: "My hours need to show the hours
   that you already have inside of this pay period: regular hours, overtime
   hours." So the top of the screen is what has actually been WORKED this
   period, split regular/overtime, from the same time entries payroll reads --
   which includes anything a manager just added through Add hours. */
function wHours(p){
  const per = (D.periods || []).find(x => x.is_current) || (D.periods || [])[0];
  const inP = d => !per || (d >= per.starts_on && d <= per.ends_on);

  let clocked = 0, otH = 0, leave = 0, days = new Set();
  for (const t of (D.time || []).filter(t => t.staff_id === p.id && inP(t.work_date))){
    const h = Number(t.hours_worked || 0);
    if (!h) continue;
    if (t.is_worked_time === false){ leave += h; continue; }
    clocked += h; days.add(t.work_date);
    const o = dailyOvertime(h); otH += o.ot1_5 + o.ot2_0;
  }
  const reg = Math.max(0, clocked - otH);

  const mine = D.assigns.filter(a => a.staff_id === p.id)
    .map(a => ({ a, s: D.sessions.find(x => x.id === a.session_id) }))
    .filter(x => x.s && inP(x.s.session_date));
  let sched = 0;
  for (const {a} of mine){
    if (!a.scheduled_start) continue;
    sched += shiftHours(a.scheduled_start.slice(0,5), (a.scheduled_end||'00:00:00').slice(0,5)) || 0;
  }
  const tonight = p.in != null ? ((p.out ?? demo.t) - p.in
    - p.breaks.filter(b=>b.kind==='meal').reduce((n,b)=>n+((b.end??demo.t)-b.start),0)) / 60 : null;
  const paid = D.payouts.filter(x => x.staff_id === p.id)
    .reduce((n,x) => n + Number(x.payout_amount), 0);

  const row = (l, v, sub) => `<div class="dph-card"><div class="rtime">${esc(l)}</div>
    <div style="font-size:23px;font-weight:800">${v}</div>${
    sub?`<div class="rtime">${esc(sub)}</div>`:''}</div>`;
  return `<div class="dph-h">This pay period${per ? ` · ${esc(shortDate(per.starts_on))} – ${
      esc(shortDate(per.ends_on))}` : ''}</div>
    ${row('Regular hours', reg.toFixed(2)+'h', `${days.size} day${days.size===1?'':'s'} worked so far`)}
    ${row('Overtime hours', otH ? otH.toFixed(2)+'h' : '0.00h',
      'over 8h in a day pays 1.5×, over 12h pays 2×')}
    ${leave ? row('Paid leave', leave.toFixed(2)+'h', 'vacation, sick, holiday, PTO') : ''}
    ${tonight != null ? row('Tonight so far', tonight.toFixed(2)+'h',
      `${p.breaks.filter(b=>b.kind==='meal').length} meal · ${
        p.breaks.filter(b=>b.kind==='rest').length} rests — counts once the night closes`) : ''}
    ${row('Still scheduled this period', sched.toFixed(1)+'h', `${mine.length} shifts`)}
    ${row('Commission', paid ? '$'+paid.toFixed(2) : '—',
      paid ? 'posted from reconciled sessions' : 'posts here after each session is reconciled')}`;
}

/* The picker, as me.html offers it: anything nobody else has. Choosing here
   swaps the character locally so the whole demo -- board, wall chart, tablet
   -- follows along; a refresh puts it back. */
function wPet(p){
  const st = D.staff.find(x => x.id === p.id);
  const taken = new Map(D.staff.filter(x => x.pet).map(x => [x.pet, x.name]));
  const dirKind = { pets:'cat', monsters:'boss', chars:'critter' };
  const all = (typeof ART === 'object' && ART)
    ? Object.keys(ART).filter(k => k.endsWith('-sit')).map(k => {
        const [dir, file] = k.split('/');
        return { id: file.replace(/-sit$/,''), kind: dirKind[dir] || 'cat' };
      }) : [];
  const mine = all.find(x => x.id === st?.pet);
  const free = all.filter(x => !taken.has(x.id)).slice(0, 11);
  const tile = (x, cls, note) => `<button class="wpet ${cls}" data-dpet="${esc(x.id)}|${esc(x.kind)}">
      <img src="${esc(petSrc(x.id, x.kind, 'sit'))}" alt="">
      <span>${esc(petName(x.id))}</span>${note?`<span class="rtime">${esc(note)}</span>`:''}</button>`;
  return `<div class="dph-h">My character</div>
    <div class="rtime" style="margin-bottom:8px">This is you on the break board. Take any
      character nobody else has.</div>
    <div class="wpets">
      ${mine ? tile(mine, 'mine', 'yours') : ''}
      ${free.map(x => tile(x, '', '')).join('')}
    </div>`;
}

/* ---- 4. hours, through the real break-law checker ------------------------ */
function demoHours(){
  const rows = demoPeople().filter(p => p.in != null).map(p => {
    const end = p.out ?? demo.t;
    const meals = p.breaks.filter(b => b.kind === 'meal');
    const rests = p.breaks.filter(b => b.kind === 'rest');
    const mealMin = meals.reduce((n,b) => n + ((b.end ?? demo.t) - b.start), 0);
    const hours = (end - p.in - mealMin) / 60;
    /* checkDay takes BOOLEANS for the two meals, not a count -- passing a
       number made every shift read as no meal taken. */
    const mealsDone = meals.filter(b => b.end != null).length;
    const chk = checkDay({ hours,
      mealTaken: mealsDone >= 1, secondMealTaken: mealsDone >= 2,
      restsTaken: rests.filter(b => b.end != null).length });
    return `<tr class="${chk.ok?'':'rowbad'}">
      <td>${personLabel(p.id, p.name)}</td>
      <td class="rtime">${dclock(p.in)} – ${p.out!=null?dclock(p.out):'still on'}</td>
      <td><strong>${hours.toFixed(2)}</strong></td>
      <td class="rtime">${chk.mealsRequired} / ${mealsDone}</td>
      <td class="rtime">${chk.restsRequired} / ${rests.filter(b=>b.end!=null).length}</td>
      <td>${chk.ok ? '<span class="okmark">compliant</span>'
        : `<span class="short">${esc(chk.problems.join('; '))}</span>`}</td>
      <td>${chk.premiumHours ? `<span class="badnum">${chk.premiumHours}h</span>` : '—'}</td>
    </tr>`;
  }).join('');
  return `<h2>Hours <span class="rtime">the same break-law check that drives payroll</span></h2>
    <div class="panel" style="overflow-x:auto">${rows ? `<table>
      <thead><tr><th>Person</th><th>Clocked</th><th>Hours</th><th>Meals req/taken</th>
        <th>Rests req/taken</th><th>Compliance</th><th>Premium</th></tr></thead>
      <tbody>${rows}</tbody></table>` : '<span class="rtime">Clock somebody in first.</span>'}</div>
    <div class="rtime" style="margin-top:8px">Premium hours are what a missed meal or rest
      costs. This is ca-breaks.js — the same code the payroll export runs.</div>`;
}

function viewDemo(){
  if (!D.sessions.length) return '<div class="panel">No sessions to demonstrate yet.</div>';
  if (!demo) demo = demoInit(null);
  if (!demo) return '<div class="panel">No staffed session to demonstrate yet.</div>';
  const body = { clock: demoClock, board: demoBoard, worker: demoWorker, hours: demoHours }[demo.tab];
  return demoBar() + body();
}
