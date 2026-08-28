/**
 * Break planner.
 *
 * Pure. Given who is on shift and what has already happened, produce the
 * remaining break plan. Re-run it whenever reality diverges — a skipped break,
 * a postponed one, someone clocking out early — and it re-plans what is left.
 * There is no separate "replan" path, because a plan that can only be built
 * once is a plan that is wrong by 8pm.
 *
 * HARD CONSTRAINTS, in priority order:
 *   1. A first meal must START before the end of the 5th hour of work.
 *      This is a legal deadline, not a preference; missing it owes a premium.
 *   2. A second meal must start before the end of the 10th hour.
 *   3. Coverage: a role may never drop below its floor. Sending the only
 *      Paymaster to lunch is not a scheduling inconvenience, it is the cash
 *      desk being unattended.
 *   4. Rest breaks: one per 4 hours or major fraction, spread through the shift.
 *
 * Where 1 and 3 conflict, the planner reports the conflict rather than quietly
 * breaking either. Silently skipping the meal creates a wage claim; silently
 * dropping coverage creates an operational problem. The manager must decide.
 */

const REST_MIN = 10;
const MEAL_MIN = 30;

/** Minutes from shift start by which a meal must have begun. */
const FIRST_MEAL_DEADLINE = 5 * 60;
const SECOND_MEAL_DEADLINE = 10 * 60;

/* How long somebody must be at work before a meal counts as a meal.
   
   The law sets a LATEST (end of the 5th hour) and no earliest, so a planner
   with only a deadline will happily send somebody to lunch twenty minutes into
   a nine-hour shift whenever that slot is uncrowded -- which is what started
   happening once placement began scoring by crowding. It satisfies the statute
   and defeats its purpose: the point of the break is to divide the shift, and a
   meal at 15:35 leaves eight unbroken hours behind it.
   
   Two hours in is the floor. It is relaxed only when the deadline cannot
   otherwise be met -- a short shift, or somebody who clocked in late -- and
   never at the cost of refusing the meal. */
const MEAL_EARLIEST = 2 * 60;

/* The ideal: 45 minutes inside the deadline, so about 4h15m into a full shift.
   Late enough to divide the day, early enough to leave room if coverage forces
   a slip. */
const MEAL_TARGET_BEFORE_DEADLINE = 45;

/**
 * @param {Array} people  [{id, name, roleId, startMin, endMin}] minutes from
 *                        an arbitrary origin; endMin > startMin.
 * @param {Object} floors  roleId -> minimum who must remain on the floor
 * @param {Array} done     [{personId, kind:'rest'|'meal', startMin, endMin}]
 *                         already taken or in progress
 * @param {Object} [opts]
 * @param {number} [opts.nowMin]   plan only from here onward
 * @param {Array}  [opts.skipped]  [{personId, kind}] deliberately skipped
 * @param {Object} [opts.coverGroups]  roleId -> group name. Roles sharing a
 *        group prefer not to be away at the same minute. A SOFT preference:
 *        it is dropped rather than refuse anybody a break.
 * @returns {{plan:Array, conflicts:Array, owed:Object}}
 */
export function planBreaks(people, floors, done = [], opts = {}) {
  const now = opts.nowMin ?? -Infinity;
  const skipped = opts.skipped ?? [];

  const takenBy = (id, kind) =>
    done.filter(d => d.personId === id && d.kind === kind).length +
    skipped.filter(s => s.personId === id && s.kind === kind).length;

  /* What each person still owes, from the hours they are actually working. */
  const need = [];
  for (const p of people) {
    const hours = (p.endMin - p.startMin) / 60;
    const meals = hours > 10 ? 2 : hours > 5 ? 1 : 0;
    const rests = hours <= 3.5 ? 0 : hours <= 6 ? 1 : hours <= 10 ? 2 : 3;

    for (let i = takenBy(p.id, 'meal'); i < meals; i++) {
      const deadline = p.startMin + (i === 0 ? FIRST_MEAL_DEADLINE : SECOND_MEAL_DEADLINE);
      /* notBefore is a real floor, not a preference: see MEAL_EARLIEST. */
      need.push({ person: p, kind: 'meal', index: i, deadline, mins: MEAL_MIN,
        notBefore: p.startMin + (i === 0 ? MEAL_EARLIEST : MEAL_EARLIEST + FIRST_MEAL_DEADLINE),
        target: Math.max(p.startMin + MEAL_EARLIEST,
                         deadline - MEAL_TARGET_BEFORE_DEADLINE) });
    }
    for (let i = takenBy(p.id, 'rest'); i < rests; i++) {
      /* Rests should fall in the middle of each work period where practicable,
         so aim for the midpoint of each quarter and treat it as soft. */
      const span = p.endMin - p.startMin;
      need.push({ person: p, kind: 'rest', index: i,
        deadline: p.startMin + Math.round(span * (i + 1) / (rests + 1)) + 90,
        target: p.startMin + Math.round(span * (i + 1) / (rests + 1)),
        mins: REST_MIN });
    }
  }

  /* Earliest deadline first: the thing that becomes illegal soonest goes first.
     Meals outrank rests at equal deadlines, since only meals carry a hard
     statutory start time. */
  need.sort((a, b) => a.deadline - b.deadline
    || (a.kind === b.kind ? 0 : a.kind === 'meal' ? -1 : 1));

  /* Occupancy: for each minute, how many of each role are away. Seeded with
     what has already happened so a re-plan respects breaks in progress. */
  const away = new Map();          // `${roleId}|${minute}` -> count
  /* A SOFT companion to the floor. Roles in the same cover group prefer not to
     be away at the same moment — the MOD, Opener, Paymaster and Flash Manager
     are each alone in their role, so no floor can separate them, and without
     this all four leave together the minute their targets coincide. It is a
     preference and nothing more: a break is never refused to keep somebody
     back, because a refused break costs a premium hour and an empty office
     costs nothing legally. */
  const groupOf = roleId => opts.coverGroups?.[roleId] ?? roleId;
  const busyGroup = new Map();     // `${group}|${minute}` -> count
  const bump = (roleId, from, to, delta) => {
    const g = groupOf(roleId);
    for (let m = from; m < to; m++) {
      away.set(`${roleId}|${m}`, (away.get(`${roleId}|${m}`) || 0) + delta);
      busyGroup.set(`${g}|${m}`, (busyGroup.get(`${g}|${m}`) || 0) + delta);
    }
  };
  const groupClear = (roleId, from, to) => {
    const g = groupOf(roleId);
    for (let m = from; m < to; m++) if (busyGroup.get(`${g}|${m}`)) return false;
    return true;
  };
  for (const d of done) {
    const p = people.find(x => x.id === d.personId);
    if (p && d.endMin != null) bump(p.roleId, d.startMin, d.endMin, 1);
  }

  const onShift = roleId => people.filter(p => p.roleId === roleId).length;

  /* THE FLOOR IS A PREFERENCE, NOT A VETO.
   *
   * Angela, on being shown twelve refused breaks: "We always need to be
   * assigning breaks. The number of flash runners could be higher or lower.
   * We always need breaks."
   *
   * She is right, and the law agrees: a missed meal costs a premium hour and
   * is a violation; a thin floor for thirty minutes is an operational
   * inconvenience. The floor was written as a hard constraint, so a role
   * rostered below its own floor -- three runners against a floor of four, a
   * lone Paymaster against a floor of one -- refused every break of everybody
   * in it, all night.
   *
   * So the floor now yields, one step at a time. `effFloor` is the floor the
   * role can actually honour: never more than one below headcount, because a
   * floor at or above headcount means literally nobody may ever leave. Then,
   * if even that finds no slot, the placement retries against a floor of zero
   * rather than refuse the break -- and the plan entry records how far below
   * the floor the hall will run, so the board can say so.
   */
  const effFloor = roleId =>
    Math.min(floors[roleId] ?? 0, Math.max(0, onShift(roleId) - 1));
  const canLeave = (roleId, from, to, floorOverride) => {
    const floor = floorOverride ?? effFloor(roleId);
    for (let m = from; m < to; m++) {
      const out = away.get(`${roleId}|${m}`) || 0;
      if (onShift(roleId) - (out + 1) < floor) return false;
    }
    return true;
  };
  /* How thin the floor actually gets while this break is out — reported, not
     used to refuse anything. */
  const dipBelow = (roleId, from, to) => {
    const floor = floors[roleId] ?? 0;
    let worst = 0;
    for (let m = from; m < to; m++) {
      const out = away.get(`${roleId}|${m}`) || 0;
      worst = Math.max(worst, floor - (onShift(roleId) - (out + 1)));
    }
    return worst;
  };

  const plan = [], conflicts = [];

  for (const item of need) {
    const p = item.person;
    const hardEarliest = Math.max(p.startMin, now);
    const latest = Math.min(item.deadline, p.endMin - item.mins);
    /* Hold the floor unless holding it would leave no legal slot at all. */
    const wanted = Math.max(hardEarliest, item.notBefore ?? 0);
    const earliest = wanted <= latest ? wanted : hardEarliest;
    let placed = null;

    /* Rests aim for their target and drift outward; meals go as early as
       coverage allows, because their deadline is the thing that bites. */
    /* Start at the preferred time and drift outward, so a break lands where it
       makes sense unless coverage says otherwise. Falls back to any legal slot. */
    const candidates = [];
    if (item.target != null) {
      for (let off = 0; off <= 300; off += 5) candidates.push(item.target - off, item.target + off);
    }
    for (let t = earliest; t <= latest; t += 5) candidates.push(t);

    /* How crowded a window already is for this role. Taking the FIRST legal
       slot was correct for one person and wrong for eleven: with a floor of 4
       out of 11 Flash Runners, seven of them are legally free to go at the same
       minute, so seven 30-minute meals all began together and the floor was
       bare the moment the eighth was due. Scoring by crowding spreads them --
       once a minute is occupied it is a worse choice for the next person, so
       meals cascade instead of stacking. */
    const crowding = (roleId, from, to) => {
      let n = 0;
      for (let m = from; m < to; m++) n += away.get(`${roleId}|${m}`) || 0;
      return n;
    };
    const groupCrowding = (roleId, from, to) => {
      const g = groupOf(roleId);
      let n = 0;
      for (let m = from; m < to; m++) n += busyGroup.get(`${g}|${m}`) || 0;
      return n;
    };
    /* Ties break toward the preferred time for a rest, and toward EARLY for a
       meal -- a meal's deadline is the thing that bites, so when two slots are
       equally uncrowded the earlier one is safer. */
    const anchor = item.target != null ? item.target : earliest;

    /* First pass holds the floor the role can honour. If that finds nothing,
       the second pass drops the floor entirely -- because the alternative is
       refusing somebody their break, and that is not on the table. */
    let best = null, relaxed = false;
    for (let pass = 0; pass < 2 && !best; pass++) {
    relaxed = pass === 1;
    const seen = new Set();
    for (const t of candidates) {
      if (t < earliest || t > latest || seen.has(t)) continue;
      seen.add(t);
      if (!canLeave(p.roleId, t, t + item.mins, relaxed ? 0 : undefined)) continue;
      const score = [ crowding(p.roleId, t, t + item.mins),
                      groupCrowding(p.roleId, t, t + item.mins),
                      Math.abs(t - anchor) ];
      if (!best || score[0] < best.score[0]
          || (score[0] === best.score[0] && score[1] < best.score[1])
          || (score[0] === best.score[0] && score[1] === best.score[1] && score[2] < best.score[2])) {
        best = { t, score };
      }
      /* An empty window at the preferred time cannot be beaten. */
      if (score[0] === 0 && score[1] === 0 && score[2] === 0) break;
    }
    }
    placed = best ? best.t : null;

    if (placed == null) {
      /* Two very different failures, and they used to read the same. Either
         the role is short-staffed to the point where NOBODY in it can ever be
         released -- a standing fact about the roster, true for every break of
         everyone in that role -- or the shift is simply too tight to fit this
         particular break. The caller needs to be able to tell them apart to
         say anything useful, so the cause is structured rather than prose. */
      /* Getting here now means the SHIFT has no room -- there is no minute
         between now and the deadline that is still inside the shift. Coverage
         can no longer cause this, because the floor yields. */
      conflicts.push({
        personId: p.id, name: p.name, kind: item.kind,
        roleId: p.roleId, working: onShift(p.roleId), floor: floors[p.roleId] ?? 0,
        cause: 'no-window',
        reason: `no time left before the ${
          item.kind === 'meal' ? 'meal deadline' : 'end of shift'}`,
        deadline: item.deadline,
      });
      continue;
    }

    const dip = dipBelow(p.roleId, placed, placed + item.mins);
    bump(p.roleId, placed, placed + item.mins, 1);
    plan.push({ personId: p.id, name: p.name, roleId: p.roleId, kind: item.kind,
                startMin: placed, endMin: placed + item.mins,
                late: placed > item.deadline,
                /* the hall runs this many under the role's floor while they
                   are out -- information for the board, never a refusal */
                dip: dip > 0 ? dip : 0 });
  }

  plan.sort((a, b) => a.startMin - b.startMin);

  /* Premium hours owed for anything that could not be placed, capped at one
     per category per person per day. */
  const owed = {};
  for (const c of conflicts) {
    owed[c.personId] = owed[c.personId] || { meal: 0, rest: 0 };
    owed[c.personId][c.kind] = 1;
  }

  return { plan, conflicts, owed };
}


/** "Abel, Amanda and Andrea" — an Oxford-free list a person can read aloud. */
function names(list) {
  if (list.length <= 1) return list[0] || '';
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/**
 * Turn the raw conflict list into sentences a manager can act on.
 *
 * The raw list is one entry per BREAK, so one person short of both a meal and
 * a rest is two entries. Grouped by person it is one line with one fix.
 *
 * A conflict now only ever means the shift itself has no room left -- coverage
 * cannot cause one, because the floor yields.
 */
export function summariseConflicts(conflicts, roleName = id => id) {
  const byPerson = new Map();
  for (const c of conflicts) {
    if (!byPerson.has(c.personId)) byPerson.set(c.personId, { name: c.name, kinds: [] });
    byPerson.get(c.personId).kinds.push(c.kind === 'meal' ? 'meal' : 'rest break');
  }
  return [...byPerson.values()].map(p => ({
    kind: 'no-window',
    people: [p.name],
    text: `${p.name}'s ${names([...new Set(p.kinds)])} cannot be fitted into what is `
      + `left of the shift.`,
  }));
}

/**
 * The other half of the story: breaks that WERE given, at the cost of running
 * under the role's floor for a while.
 *
 * Angela's rule is that breaks always happen -- "We always need to be
 * assigning breaks" -- so a thin floor is never a reason to refuse one. It is
 * still worth saying out loud, because it is the thing a manager might want to
 * fix by rostering one more person.
 *
 * @param plan     the `plan` array from planBreaks
 * @param roleName roleId -> display name
 */
export function summariseDips(plan, roleName = id => id) {
  const byRole = new Map();
  for (const b of plan) {
    if (!b.dip) continue;
    if (!byRole.has(b.roleId)) byRole.set(b.roleId, { worst: 0, people: [] });
    const g = byRole.get(b.roleId);
    g.worst = Math.max(g.worst, b.dip);
    if (!g.people.includes(b.name)) g.people.push(b.name);
  }
  return [...byRole.entries()].map(([roleId, g]) => ({
    roleId, people: g.people, under: g.worst,
    text: `${roleName(roleId)} runs ${g.worst} under its floor while `
      + `${names(g.people)} ${g.people.length === 1 ? 'is' : 'are'} on break. `
      + `Everyone still gets their breaks — roster one more to avoid the dip.`,
  }));
}

/** Format minutes-from-midnight as HH:MM, wrapping past midnight. */
export function hhmm(min) {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
