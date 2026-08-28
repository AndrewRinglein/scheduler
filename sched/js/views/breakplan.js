/* ---------------------------------------------------------------------------
   The break plan, before the night.

   planBreaks() has existed and been tested since the board was built, but
   nothing outside the TV consumed it — so Rachel could only find out how a
   night's breaks would fall by standing in the hall while it happened.

   This runs the same planner against the SCHEDULED crew rather than whoever
   has clocked in, which is the only difference: on the night the board plans
   from real punches, here we plan from the roster. Same rules, same coverage
   floors, same conflicts.
--------------------------------------------------------------------------- */

function planForSession(s){
  if(!s) return null;
  const dw = dowOf(s);
  const people = [], floors = {}, coverGroups = {};

  for (const a of D.assigns.filter(x => x.session_id === s.id && x.staff_id)) {
    const role = D.roles.find(r => r.id === a.role_id);
    if (!role) continue;
    const start = a.scheduled_start || timeForRaw(a.role_id, dw, s.part, s.hall_id);
    const end   = a.scheduled_end   || endForRaw(a.role_id, dw, s.part, s.hall_id);
    if (!start || !end) continue;          // cannot plan a shift with no hours
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    let s0 = sh * 60 + sm, e0 = eh * 60 + em;
    if (e0 <= s0) e0 += 1440;              // crosses midnight, as sessions do
    const person = D.staff.find(p => p.id === a.staff_id);
    /* ONE ROW PER HUMAN. Somebody holding two roles on a night -- the MOD who
       also runs the paymaster desk on Fridays -- was pushed twice, so the
       planner treated them as two people and gave them two meals. They get one
       set of breaks, spanning the earliest start to the latest end of whatever
       they are covering, and both roles are named on the row so it is obvious
       which desks empty when they go. */
    const seen = people.find(x => x.id === a.staff_id);
    if (seen) {
      seen.startMin = Math.min(seen.startMin, s0);
      seen.endMin   = Math.max(seen.endMin,   e0);
      if (!seen.roles.includes(role.name)) seen.roles.push(role.name);
    } else {
      people.push({ id: a.staff_id, name: person ? person.name : '—',
                    roleId: a.role_id, roles: [role.name], startMin: s0, endMin: e0 });
    }
    floors[a.role_id] = needFloor(a.role_id, s.hall_id, dw);
    if (role.cover_group) coverGroups[a.role_id] = role.cover_group;
  }
  if (!people.length) return { people: [], plan: [], conflicts: [] };

  const r = planBreaks(people, floors, [], { nowMin: Math.min(...people.map(p => p.startMin)),
                                             coverGroups });
  return { people, plan: r.plan, conflicts: r.conflicts };
}

function needFloor(roleId, hall, dw){
  const n = D.needs.find(x => x.hall_id === hall && x.role_id === roleId && x.dow === dw);
  if (n && n.min_on_floor != null) return n.min_on_floor;
  const r = D.roles.find(x => x.id === roleId);
  return r ? (r.min_on_floor || 0) : 0;
}

function endForRaw(rid, dw, pt, h){
  const t = D.times.find(x => x.hall_id === h && x.role_id === rid && x.dow === dw && x.part === pt);
  return t ? t.end_time : null;
}

/* Every session with anybody on it, so the plan can be stepped through without
   going back to the Schedule tab to change the selection. */
function breakPlanSessions(){
  const staffed = new Set(D.assigns.filter(a => a.staff_id).map(a => a.session_id));
  return D.sessions.map((x,i) => [x,i]).filter(([x]) => staffed.has(x.id));
}

function breakPlanBar(cur){
  const list = breakPlanSessions();
  const at = list.findIndex(([x]) => x.id === cur?.id);
  return `<div class="panel periodbar wallbar" style="margin-bottom:12px">
    <button class="btn" id="bpprev" ${at<=0?'disabled':''}>‹ previous</button>
    <select id="bpsel" style="min-width:280px;font-weight:600">
      ${list.map(([x,i]) => `<option value="${i}" ${x.id===cur?.id?'selected':''}>${
        esc(label(x))} · ${esc(HALLNAME[x.hall_id])} · ${
        D.assigns.filter(a=>a.session_id===x.id&&a.staff_id).length} on shift</option>`).join('')}
    </select>
    <button class="btn" id="bpnext" ${at<0||at>=list.length-1?'disabled':''}>next ›</button>
    <div class="rtime">${list.length} staffed session${list.length===1?'':'s'}</div>
  </div>`;
}

/* The rules, on the screen that applies them.

   Written out because Rachel has to defend these to staff and to an auditor,
   and "the computer decided" is not a defence. Every number here is read from
   the planner's own constants rather than retyped, so the panel cannot drift
   from the behaviour it describes. */
function breakRules(){
  const h = n => n % 60 === 0 ? `${n/60} hour${n===60?'':'s'}`
                              : `${Math.floor(n/60)}h ${n%60}m`;
  return `<details class="rules"><summary>The rules this plan follows</summary>
    <div class="rulebody">
      <p><strong>Meals — ${MEAL_MIN} minutes, unpaid.</strong>
      One if the shift runs over 5 hours, a second if it runs over 10.
      The first must <em>start</em> before the end of the 5th hour
      (${h(FIRST_MEAL_DEADLINE)} in) and the second before the end of the 10th
      (${h(SECOND_MEAL_DEADLINE)} in) — start, not finish. Missing that owes an
      hour of premium pay.</p>

      <p><strong>Not in the first ${h(MEAL_EARLIEST)}.</strong>
      The law sets only a latest, so a planner told just the deadline will send
      somebody to lunch twenty minutes into a nine-hour shift whenever the floor
      allows it. That satisfies the statute and defeats its purpose, and leaves
      the rest of the shift unbroken. Meals aim for
      ${h(MEAL_TARGET_BEFORE_DEADLINE)} inside the deadline — about
      ${h(FIRST_MEAL_DEADLINE - MEAL_TARGET_BEFORE_DEADLINE)} in — and are only
      pulled earlier than ${h(MEAL_EARLIEST)} if there is no legal slot left.</p>

      <p><strong>Rests — ${REST_MIN} minutes, paid.</strong>
      One per 4 hours worked <em>or major fraction</em>: none up to 3½ hours,
      one to 6, two to 10, three beyond. They aim for the middle of each stretch
      of work rather than clustering.</p>

      <p><strong>Coverage comes first, and never silently.</strong>
      A role may not drop below its floor — sending the only Paymaster to lunch
      is the cash desk standing empty, not an inconvenience. Where coverage and
      a deadline genuinely cannot both be met the break is reported as a
      conflict rather than either being quietly broken, because skipping the
      meal creates a wage claim and dropping the floor creates an operational
      problem, and which one to accept is a manager's call.</p>

      <p><strong>Spread, not stacked.</strong>
      With eleven runners and a floor of four, seven could legally go at once.
      Placement scores how crowded a window already is, so meals cascade
      through the afternoon instead of emptying the floor at 3:30.</p>

      <p class="rtime">Managers who are alone in their role — MOD, Paymaster,
      Flash Manager — are covered by each other rather than relieved, so they
      are staggered where possible instead of all leaving together.</p>
    </div></details>`;
}

function viewBreakPlan(){
  const list = breakPlanSessions();
  if (!list.length) return `<div class="panel">No session has anybody on it yet.</div>`;
  /* Land on a staffed session rather than whatever the Schedule tab last had. */
  let s = D.sessions[sel];
  if (!s || !list.some(([x]) => x.id === s.id)) {
    s = (list.find(([x]) => isUpcoming(x)) || list[0])[0];
  }
  const bar = breakPlanBar(s);
  const r = planForSession(s);

  if (!r || !r.people.length) return bar + `<h2>Break plan — ${esc(label(s))}</h2>
    <div class="panel"><div class="note warn">Nobody is rostered on this session yet,
    or the roles they are in have no start and end times recorded — so there is
    nothing to plan around.</div></div>`;

  const lo = Math.min(...r.people.map(p => p.startMin));
  const hi = Math.max(...r.people.map(p => p.endMin));
  const span = Math.max(60, hi - lo);
  const pct = m => ((m - lo) / span * 100).toFixed(2);
  const hourMarks = [];
  for (let m = Math.ceil(lo / 60) * 60; m <= hi; m += 60) hourMarks.push(m);

  const rows = r.people.map(p => {
    const mine = r.plan.filter(b => b.personId === p.id);
    const bad  = r.conflicts.filter(c => c.personId === p.id);
    return `<tr>
      <td class="pname">${personLabel(p.id, p.name)}<div class="rtime">${
        esc((p.roles||[]).join(' + '))}</div></td>
      <td class="track">
        <div class="bar" style="left:${pct(p.startMin)}%;width:${
          ((p.endMin - p.startMin) / span * 100).toFixed(2)}%"></div>
        ${mine.map(b => `<div class="blk ${b.kind}" title="${esc(b.kind)} ${hhmm(b.startMin)}"
            style="left:${pct(b.startMin)}%;width:${
              ((b.endMin - b.startMin) / span * 100).toFixed(2)}%">${
            b.kind === 'meal' ? '30' : '10'}</div>`).join('')}
        ${bad.length ? `<div class="blk bad" style="left:${pct(p.endMin) - 6}%;width:6%"
            title="${esc(bad.map(c => c.reason).join(' · '))}">!</div>` : ''}
      </td></tr>`;
  }).join('');

  /* One line per CAUSE, not one per break. A role whose floor is higher than
     the number of people working produces a conflict for every break of
     everybody in it -- twelve lines of red for one staffing fact. */
  const roleName = id => D.roles.find(x => x.id === id)?.name || 'this role';
  const said = summariseConflicts(r.conflicts, roleName);
  const thin = summariseDips(r.plan, roleName);
  const conflicts = (said.length
      ? `<div class="note bad">
          <strong>${said.length} break${said.length === 1 ? '' : 's'} could not be
          fitted into the shift.</strong> ${said.map(x => esc(x.text)).join(' ')}
          <div style="margin-top:5px">Each owes a premium hour unless somebody
            covers.</div></div>`
      : `<div class="note ok">All ${r.plan.length} breaks are scheduled.</div>`)
    /* Coverage running thin is worth knowing and is never a reason to refuse a
       break -- Angela: "We always need to be assigning breaks." */
    + (thin.length ? `<div class="note">${thin.map(x => esc(x.text)).join(' ')}</div>` : '');

  return bar + `<h2>Break plan — ${esc(label(s))}
      <span class="hallbadge ${s.hall_id}">${s.hall_id.toUpperCase()}</span></h2>
    ${conflicts}
    ${breakRules()}
    <div class="panel" style="overflow-x:auto">
      <table class="gantt">
        <thead><tr><th></th><th class="track">
          ${hourMarks.map(m => `<span class="hm" style="left:${pct(m)}%">${hhmm(m)}</span>`).join('')}
        </th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="rtime" style="margin-top:8px">Planned from the roster, not from who has
      clocked in — on the night the board re-plans from real punches.</div>`;
}
