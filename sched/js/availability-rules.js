/**
 * Availability request rules.
 *
 * THE MODEL IS OPT-OUT. Every session in the period starts AVAILABLE and the
 * person turns days off. That is deliberate and it has one consequence worth
 * stating plainly: a person who never opens the form looks exactly like a
 * person who said yes to everything. The answers alone cannot tell those apart,
 * so whether somebody has RESPONDED is tracked separately from what they
 * answered, and Rachel's "still waiting on" list is the only thing that
 * distinguishes them. Do not infer consent from an untouched form.
 *
 * CRITICAL STAFF get a cap. Anyone who holds a role beyond the universal floor
 * runner — MOD, Paymaster, Caller, Opener, Flash Manager — may turn off at most
 * two DAYS in the period.
 *
 * The unit of the cap is the calendar DAY, not the session. Saturday and Sunday
 * each run two sessions; turning off Saturday evening spends one of the two
 * days and leaves Saturday afternoon available. That is the most permissive
 * reading of "two days" and it lets somebody decline the evening without
 * surrendering the afternoon they could actually have worked.
 *
 * The cap limits what somebody can DECLARE, never what is true. Someone with
 * jury duty on a third day still has jury duty. A form that refuses the answer
 * produces a no-show instead of a decline, which is strictly worse for the
 * person building the schedule — so exceeding the cap raises a request to the
 * manager rather than blocking the input.
 */

export const CAP_CRITICAL_DAYS = 2;

/** Anyone qualified for a role other than the universal one is critical. */
export function isCritical(staffId, capabilities, universalRoleId) {
  return capabilities.some(c =>
    c.staff_id === staffId &&
    c.role_id !== universalRoleId &&
    (c.can_do || c.is_deputy));
}

/**
 * @param {Array<{date:string, part:string}>} sessions  every session in the period
 * @param {Array<{date:string, part:string}>} offSessions  the ones turned off
 * @param {object} [opts]
 * @param {boolean} [opts.critical]
 * @param {number}  [opts.cap]
 */
export function evaluate(sessions, offSessions, opts = {}) {
  const critical = !!opts.critical;
  const cap = opts.cap ?? CAP_CRITICAL_DAYS;

  const inPeriod = new Set(sessions.map(key));
  const off = offSessions.filter(s => inPeriod.has(key(s)));

  // Days, not sessions — declining one half of a weekend costs one day, and
  // declining both halves of the same day still costs one.
  const daysOff = [...new Set(off.map(s => s.date))].sort();
  const allowed = critical ? cap : Infinity;
  const overBy = Math.max(0, daysOff.length - allowed);

  return {
    critical,
    cap: critical ? cap : null,
    daysOff,
    daysOffCount: daysOff.length,
    daysLeft: critical ? Math.max(0, cap - daysOff.length) : null,
    sessionsOff: off.length,
    sessionsAvailable: sessions.length - off.length,
    overBy,
    /* Over the cap is not a rejection. It is an answer that needs a human. */
    needsApproval: overBy > 0,
    message: critical
      ? (overBy > 0
          ? `You are critical staff and can normally take ${cap} day${cap === 1 ? '' : 's'} off in a period. ` +
            `You have marked ${daysOff.length}. Tell us why and the manager will look at it.`
          : `You are critical staff. You can turn off ${cap} day${cap === 1 ? '' : 's'} in this period — ` +
            `${cap - daysOff.length} still available.`)
      : null,
  };
}

/** Would turning this day off exceed the cap? Used to warn before the tap. */
export function wouldExceed(sessions, offSessions, date, opts = {}) {
  if (!opts.critical) return false;
  const cap = opts.cap ?? CAP_CRITICAL_DAYS;
  const days = new Set(offSessions.map(s => s.date));
  if (days.has(date)) return false;         // already off, turning more off is free
  return days.size >= cap;
}

/** Every session between two dates, from the halls' operating pattern. */
export function sessionsInPeriod(allSessions, startISO, endISO) {
  return allSessions
    .filter(s => s.session_date >= startISO && s.session_date <= endISO)
    .map(s => ({ date: s.session_date, part: s.part, hall: s.hall_id, id: s.id }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.part.localeCompare(b.part));
}

function key(s) { return `${s.date}|${s.part}`; }
