/* Build sched/demo.html — the manager app with no sign-in and no network.
 *
 * Angela, mid-demo: "Make my local version not need a password."
 *
 * The obvious fix is to bake a login into the file. That is the wrong fix: RLS
 * grants any authenticated user full read AND WRITE across every table, so a
 * credential sitting in a file on a laptop is one forwarded email away from a
 * stranger editing the live schedule and reading every staff phone number.
 *
 * So this does the other thing: the demo carries its own copy of the data.
 * A snapshot of the current fortnight is embedded, a stub stands in for the
 * Supabase client, and the page never talks to anything. It opens by
 * double-clicking, works on a plane, and nobody watching the demo can damage
 * live data by clicking Save. Refresh puts it back exactly as it was.
 *
 * Regenerate the snapshot by re-running the query in tools/demo-snapshot.sql
 * and saving the result over sched/demo-data.json.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const page = readFileSync('sched/manager.html', 'utf8');
const today = new Date().toISOString().slice(0, 10);
const snap = JSON.parse(readFileSync('sched/demo-data.json', 'utf8'));

/* Periods come from an RPC that computes its own counts, so the stub has to
   compute them too or the Schedule tab offers "Start this fortnight" over a
   fortnight that is already full. That exact bug cost a day once. */
snap.periods = (snap.periods || []).map(p => {
  const inRange = d => d >= p.starts_on && d <= p.ends_on;
  const sessions = snap.sessions.filter(s => inRange(s.session_date));
  const ids = new Set(sessions.map(s => s.id));
  const mine = snap.assigns.filter(a => ids.has(a.session_id));
  return { ...p, sessions: sessions.length,
           filled: mine.filter(a => a.staff_id).length,
           slots: mine.length };
})
  /* A fortnight the snapshot does not cover is an empty screen with a button
     on it, which is the worst thing a demo can open onto. Only offer the ones
     that have something in them. */
  .filter(p => p.sessions > 0);

/* "Current" is the fortnight the snapshot is OF, not whichever one contains
   today. The picture is frozen; pointing it at a real-world date that has
   moved past it just opens the demo on nothing. */
const best = snap.periods.reduce((a, b) => (b.filled > (a?.filled ?? -1) ? b : a), null);
snap.periods = snap.periods.map(p => ({ ...p, is_current: p === best }));
if (!best) throw new Error('the snapshot contains no staffed fortnight to open onto');

const STUB = `
<script>
/* ---- OFFLINE DEMO --------------------------------------------------------
   Everything below stands in for Supabase. No network call is made and no
   credential exists to leak. Reads come from the embedded snapshot; writes
   report success and change nothing, so a refresh restores the demo.
-------------------------------------------------------------------------- */
(function () {
  const SNAP = ${JSON.stringify(snap)};
  /* The snapshot's fortnight is this demo's "now" -- views that filter on
     today (the portal preview) read this instead of the real clock. */
  window.DEMO_TODAY = ${JSON.stringify(snap.periods.find(p => p.is_current)?.starts_on ?? today)};
  /* The Needs You walkthrough: two people with open punches, the text each is
     sent (Angela's wording), and the portal screen they land on. Names and
     characters are real people from the snapshot so the pitch matches the rest
     of the app; the times are a worked example. */
  window.DEMO_ATTN = (() => {
    const by = n => SNAP.staff.find(s => s.name === n) || {};
    const d = by('Diana'), a = by('Andy');
    return [
      { name: 'Diana', pet: d.pet, pet_kind: d.pet_kind, role: 'Flash Runner',
        kind: 'lunch', sched: '3:15pm – 11:00pm', in: '3:12pm',
        lunchOut: '6:30pm', end: '11:00pm',
        problem: 'never clocked back from lunch',
        sms: "Hey, it looks like you didn't indicate when your lunch ended. " +
             "Please log in and show us when you ended your lunch.",
        portalTitle: 'When did your lunch end?',
        portalHint: 'You left at 6:30pm. A 30-minute lunch would put you back around 7:00pm.',
        suggest: '19:00', confirm: 'That is when my lunch ended' },
      { name: 'Andy', pet: a.pet, pet_kind: a.pet_kind, role: 'Flash Runner',
        kind: 'out', sched: '3:15pm – 11:00pm', in: '3:14pm',
        lunchOut: '6:00pm', lunchBack: '6:31pm', end: '11:00pm',
        problem: 'never clocked out',
        sms: "Hey, it looks like you didn't clock out. Please log into your " +
             "user portal and tell us when you ended your shift.",
        portalTitle: 'When did your shift end?',
        portalHint: 'Your shift was scheduled until 11:00pm.',
        suggest: '23:00', confirm: 'This is when my shift ended' },
    ];
  })();
  SNAP.time = SNAP.time || [];
  /* Everybody is fully available -- Angela's choice for the demo. A row per
     person per operating slot, available:true, because in this schema absence
     means "never asked" and shows as grey, not green. */
  SNAP.avail = [];
  {
    const slots = [...new Map((SNAP.days || []).filter(d => d.active)
      .map(d => [d.dow + '|' + d.part, d])).values()];
    for (const st of SNAP.staff.filter(s => s.active))
      for (const d of slots)
        SNAP.avail.push({ staff_id: st.id, dow: d.dow, part: d.part, available: true });
  }
  const T = {
    sched_staff_availability: SNAP.avail,
    sched_time_entries: SNAP.time,
    sched_roles: SNAP.roles, sched_hall_days: SNAP.days,
    sched_hall_role_needs: SNAP.needs, sched_hall_role_times: SNAP.times,
    sched_staff: SNAP.staff, sched_staff_role_capability: SNAP.caps,
    sched_sessions: SNAP.sessions, sched_assignments: SNAP.assigns,
    sched_caller_positions: SNAP.cpos, sched_periods: SNAP.periods,
  };
  const rows = t => T[t] || [];

  /* Writes to two tables APPLY to the snapshot: assignments (so building a
     schedule in the demo actually sticks -- picks hold, the shift counts
     climb, Clear empties) and staff (the character picker). Everything else
     still reports success and changes nothing. All of it lives in memory;
     refresh restores the shipped snapshot. */
  let demoRowSeq = 0;
  function applyWrite(table, op, payload, eqs){
    if (table === 'sched_assignments'){
      const list = rows(table);
      if (op === 'delete'){
        for (let i = list.length - 1; i >= 0; i--){
          const r = list[i];
          if (Object.entries(eqs).every(([k, v]) => String(r[k]) === String(v)))
            list.splice(i, 1);
        }
        return;
      }
      if (payload){
        const rowsIn = Array.isArray(payload) ? payload : [payload];
        for (const q of rowsIn){
          const hit = list.find(r => r.session_id === q.session_id
            && r.role_id === q.role_id && r.slot_index === +q.slot_index);
          const st = SNAP.staff.find(x => x.id === q.staff_id);
          const ses = SNAP.sessions.find(x => x.id === q.session_id);
          const full = { id: 'demo-a-' + (++demoRowSeq), early_start: false,
            is_training: false, scheduled_start: null, scheduled_end: null,
            ...hit, ...q,
            sched_staff: { name: st ? st.name : '' },
            sched_sessions: { hall_id: ses ? ses.hall_id : 'sc' } };
          if (hit) Object.assign(hit, full); else list.push(full);
        }
      }
      return;
    }
    if (table === 'sched_staff' && op === 'update' && payload && eqs.id){
      const st = SNAP.staff.find(x => x.id === eqs.id);
      if (st) Object.assign(st, payload);
    }
  }

  function builder(table, kind, one, payload, eqs) {
    eqs = eqs || {};
    const settle = () => {
      if (kind === 'select')
        return Promise.resolve({ data: one ? (rows(table)[0] ?? null) : rows(table),
          error: null, count: rows(table).length });
      applyWrite(table, kind, payload, eqs);
      return Promise.resolve({ data: null, error: null });
    };
    const api = {
      select: () => builder(table, kind === 'select' ? 'select' : kind, one, payload, eqs),
      insert: (p) => builder(table, 'insert', one, p, eqs),
      update: (p) => builder(table, 'update', one, p, eqs),
      upsert: (p) => builder(table, 'upsert', one, p, eqs),
      delete: () => builder(table, 'delete', one, payload, eqs),
      single: () => builder(table, kind, true, payload, eqs),
      maybeSingle: () => builder(table, kind, true, payload, eqs),
      eq: (k, v) => builder(table, kind, one, payload, { ...eqs, [k]: v }),
      then: (a, b) => settle().then(a, b),
      catch: f => settle().catch(f),
      finally: f => settle().finally(f),
    };
    /* remaining filters are no-ops: the snapshot is small and the app filters
       its own reads; only eq matters, because deletes and updates target rows
       with it */
    for (const m of ['order','neq','in','is','gt','gte','lt','lte','like',
                     'ilike','not','or','filter','limit','range','contains'])
      api[m] = () => api;
    return api;
  }

  /* The blast "sends" nothing, but the count is computed from the
     snapshot the same way the server computes it from the tables, so the
     number on screen is the number the real button would text. */
  const blast = (args) => {
    const per = SNAP.periods.find(p => p.id === (args?.p_period)) || SNAP.periods[0];
    const ids = new Set(SNAP.sessions
      .filter(s => s.session_date >= per.starts_on && s.session_date <= per.ends_on)
      .map(s => s.id));
    const byStaff = new Map();
    for (const a of SNAP.assigns) {
      if (!a.staff_id || !ids.has(a.session_id)) continue;
      const e = byStaff.get(a.staff_id) || { shifts: 0, yes: 0 };
      e.shifts++; if (a.response === 'yes') e.yes++;
      byStaff.set(a.staff_id, e);
    }
    let texted = 0; const noPhone = [];
    for (const [id, e] of byStaff) {
      if (args?.p_only_unconfirmed && e.yes >= e.shifts) continue;
      const st = SNAP.staff.find(p => p.id === id);
      if (st?.phone) texted++; else noPhone.push(st?.name || '?');
    }
    return { ok: true, texted, no_phone: noPhone,
             dates: per.starts_on.slice(5) + ' – ' + per.ends_on.slice(5) };
  };

  const RPC = {
    /* Writes into the snapshot, exactly as the live RPC writes into the
       table: the person's page reloads, the row is there, and the day's
       hours grow. Same-day adds SUM, mirroring the live on-conflict. */
    add_worked_hours: (args) => {
      const ex = SNAP.time.find(t => t.staff_id === args.p_staff
        && t.work_date === args.p_date && t.hall_id === args.p_hall && !t.assignment_id);
      if (ex){
        ex.hours_worked = Number(ex.hours_worked || 0) + Number(args.p_hours);
        ex.meal_taken = ex.hours_worked > 5;
        ex.second_meal_taken = ex.hours_worked > 10;
        ex.rest_breaks_taken = ex.hours_worked <= 3.5 ? 0 : ex.hours_worked <= 6 ? 1
          : ex.hours_worked <= 10 ? 2 : 3;
        return { ok: true, merged: true, total_hours: ex.hours_worked,
                 category: ex.category };
      }
      SNAP.time.push({ id: 'demo-' + SNAP.time.length, staff_id: args.p_staff,
        hall_id: args.p_hall, work_date: args.p_date,
        hours_worked: Number(args.p_hours),
        is_worked_time: (args.p_category || 'worked') === 'worked',
        category: args.p_category || 'worked',
        meal_taken: Number(args.p_hours) > 5,
        second_meal_taken: Number(args.p_hours) > 10,
        rest_breaks_taken: Number(args.p_hours) <= 3.5 ? 0
          : Number(args.p_hours) <= 6 ? 1 : Number(args.p_hours) <= 10 ? 2 : 3,
        assignment_id: null, note: args.p_note || null });
      return { ok: true, merged: false, total_hours: Number(args.p_hours),
               category: args.p_category || 'worked' };
    },
    schedule_blast: blast,
    /* Counts are recomputed on every call now that assignments actually
       mutate -- a pick in the new fortnight should move its "filled" number,
       not the number the build baked in. */
    schedule_periods: () => SNAP.periods.map(p => {
      const inR = d => d >= p.starts_on && d <= p.ends_on;
      const ses = SNAP.sessions.filter(s => inR(s.session_date));
      const ids = new Set(ses.map(s => s.id));
      const mine = SNAP.assigns.filter(a => ids.has(a.session_id));
      return { ...p, sessions: ses.length,
               filled: mine.filter(a => a.staff_id).length, slots: mine.length };
    }),
    /* The demo version of migration 047: create a fortnight on the exact day
       asked for, synthesize its empty sessions from the hall-day templates,
       and refuse an overlap with the same wording the live RPC uses. On
       stage, Create really creates. */
    schedule_period_start_on: (args) => {
      const start = args && args.p_start;
      if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(start || ''))
        return { ok: false, error: 'Pick a day first.' };
      const addD = (iso, n) => { const d = new Date(iso + 'T12:00:00');
        d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
      const end = addD(start, 13);
      let per = SNAP.periods.find(p => p.starts_on === start);
      if (!per) {
        const clash = SNAP.periods.find(p => start <= p.ends_on && end >= p.starts_on);
        if (clash) {
          const d = new Date(clash.starts_on + 'T12:00:00');
          return { ok: false, error: 'That overlaps the fortnight starting '
            + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + '.' };
        }
        per = { id: 'demo-per-' + (++demoRowSeq), starts_on: start, ends_on: end,
          label: null, status: 'draft', note: null, published_at: null,
          is_current: false };
        SNAP.periods.push(per);
      }
      /* Empty sessions for every active hall-day in the window, skipping any
         date+hall+part the snapshot already covers -- same as the live
         ensure_upcoming_sessions, minus the parts of it that need a clock. */
      const have = new Set(SNAP.sessions.map(s => s.hall_id + '|' + s.session_date + '|' + s.part));
      const tpl = (SNAP.days || []).filter(d => d.active);
      for (let i = 0; i < 14; i++) {
        const date = addD(start, i);
        const dow = new Date(date + 'T12:00:00').getDay();
        for (const t of tpl.filter(x => x.dow === dow)) {
          if (have.has(t.hall_id + '|' + date + '|' + t.part)) continue;
          SNAP.sessions.push({ id: 'demo-s-' + (++demoRowSeq), hall_id: t.hall_id,
            session_date: date, part: t.part, status: 'draft', comm_rate: 0.15,
            day_type: (dow === 0 || dow === 6) ? 'weekend' : 'weekday' });
        }
      }
      const n = SNAP.sessions.filter(s => s.session_date >= start && s.session_date <= end).length;
      return { ok: true, id: per.id, starts_on: start, ends_on: end, sessions: n };
    },
    ensure_upcoming_sessions: () => null,
    schedule_period_ensure: () => null,
    manager_attention: () => ({ items: [] }),
    manager_mark_seen: () => null,
    unclosed_shifts: () => [],
    availability_status: () => null,
    session_actuals: () => ({ found: false }),
  };

  window.supabase = { createClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: { user: { email: 'demo — offline copy' } } } }),
      signInWithPassword: async () => ({ error: null }),
      signOut: async () => ({}),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    from: t => builder(t, 'select', false),
    rpc: async (name, args) => ({ data: (RPC[name] || (() => null))(args), error: null }),
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel() {},
  })};
})();
</script>
`;

/* The stub must load AFTER the CDN tag so it wins, and BEFORE the app script
   so `sb` is built from it. The CDN tag is left in place and simply fails
   offline, which is harmless -- removing it would make this file diverge from
   manager.html for no benefit. */
const APP = '<script>\n/* @art-start */';
if (!page.includes(APP)) throw new Error('cannot find the app script to insert before');

let out = page.replace(APP, STUB + APP);

/* Say what this is, on screen, so nobody mistakes a demo for the real thing. */
const BANNER = `<div style="background:#3a2f18;color:#f0d9a8;border-bottom:1px solid #6b5524;
  padding:7px 16px;font-size:13px;font-weight:600">Offline demo — a snapshot of the
  ${snap.sessions.length} sessions in this fortnight. Nothing here is live and nothing
  you change is saved; refresh puts it back.</div>`;
out = out.replace('<div id="shell" hidden>', BANNER + '\n<div id="shell" hidden>');
out = out.replace('<title>', '<title>DEMO · ');

writeFileSync('sched/demo.html', out);
console.log(`sched/demo.html  ${(out.length / 1024 / 1024).toFixed(2)} MB`
  + `  (${snap.sessions.length} sessions, ${snap.assigns.length} assignments, ${snap.staff.length} staff)`);
