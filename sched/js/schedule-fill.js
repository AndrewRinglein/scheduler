/* ---------------------------------------------------------------------------
   Building a fortnight faster.

   310 slots filled by hand, every fortnight. These three shortcuts are the
   most repetitive hour Rachel spends.

   THE RULE UNDERNEATH ALL THREE, and the reason they are safe to use:
   never place somebody who said no, and never treat "hasn't answered" as a
   yes. Availability has three states now, and the difference between declined
   and never-asked is exactly what stops these from quietly rostering people
   who are away.

   Pure functions. They return proposed placements and a report of what they
   could not do; they never write. Rachel saves.
--------------------------------------------------------------------------- */

/** Everyone already in a chair on a session — nobody can be in two at once. */
function busyOn(sessionId, assigns){
  return new Set(assigns.filter(a => a.session_id === sessionId && a.staff_id)
                        .map(a => a.staff_id));
}

/**
 * @param {object} ctx  { sessions, assigns, staff, roles, avail, needs }
 *                      plus canDo(staffId, roleId) and dowOf(session)
 * @returns {{place:Array, skipped:Array}}
 */
function proposeCopy(ctx, fromSessions, toSessions){
  const place = [], skipped = [];
  /* Match a source night to a target night by day of week and part, so a
     Friday's crew lands on the next Friday rather than on whatever session
     happens to be nth in the list. */
  const key = s => `${ctx.dowOf(s)}|${s.part}|${s.hall_id}`;
  const src = new Map();
  for (const s of fromSessions) if (!src.has(key(s))) src.set(key(s), s);

  for (const target of toSessions) {
    const from = src.get(key(target));
    if (!from) { skipped.push({ session: target, why: 'no matching night to copy from' }); continue; }
    const taken = busyOn(target.id, ctx.assigns);
    const already = new Set(ctx.assigns
      .filter(a => a.session_id === target.id && a.staff_id)
      .map(a => `${a.role_id}|${a.slot_index}`));

    for (const a of ctx.assigns.filter(x => x.session_id === from.id && x.staff_id)) {
      const slot = `${a.role_id}|${a.slot_index}`;
      if (already.has(slot)) continue;                        // do not overwrite
      const person = ctx.staff.find(p => p.id === a.staff_id);
      const name = person ? person.name : 'Someone';

      if (!person || !person.active) {
        skipped.push({ session: target, name, why: 'no longer active' }); continue;
      }
      if (!ctx.canDo(person.id, a.role_id)) {
        skipped.push({ session: target, name, why: 'no longer qualified for that role' }); continue;
      }
      if (ctx.isAvailable(person.id, ctx.dowOf(target), target.part) === false) {
        skipped.push({ session: target, name, why: 'has said they cannot work that day' }); continue;
      }
      if (taken.has(person.id)) {
        skipped.push({ session: target, name, why: 'already on that session' }); continue;
      }
      taken.add(person.id);
      place.push({ session_id: target.id, role_id: a.role_id,
                   slot_index: a.slot_index, staff_id: person.id });
    }
  }
  return { place, skipped };
}

/**
 * Suggestions for empty slots. Only people who ANSWERED YES — an unanswered
 * slot is not consent and must never be filled from.
 */
function proposeFill(ctx, sessions, emptySlots){
  const place = [], skipped = [];
  const takenBySession = new Map();
  for (const s of sessions) takenBySession.set(s.id, busyOn(s.id, ctx.assigns));

  for (const slot of emptySlots) {
    const session = sessions.find(s => s.id === slot.session_id);
    if (!session) continue;
    const dw = ctx.dowOf(session);
    const taken = takenBySession.get(session.id);

    const pool = ctx.staff.filter(p =>
      p.active &&
      ctx.canDo(p.id, slot.role_id) &&
      !taken.has(p.id) &&
      ctx.isAvailable(p.id, dw, session.part) === true);   // strictly yes

    if (!pool.length) {
      skipped.push({ session, role_id: slot.role_id,
                     why: 'nobody qualified has said they can work it' });
      continue;
    }
    /* Fewest shifts already in this fortnight first, so the work spreads
       rather than landing on whoever sorts first alphabetically. */
    pool.sort((a, b) => (ctx.load[a.id] || 0) - (ctx.load[b.id] || 0)
                     || a.name.localeCompare(b.name));
    const pick = pool[0];
    taken.add(pick.id);
    ctx.load[pick.id] = (ctx.load[pick.id] || 0) + 1;
    place.push({ session_id: session.id, role_id: slot.role_id,
                 slot_index: slot.slot_index, staff_id: pick.id });
  }
  return { place, skipped };
}
