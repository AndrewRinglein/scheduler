/**
 * Attendance alerts — the three things the hall shouts about.
 *
 * Pure, and shared. The break board runs this against real punches; the demo
 * tab runs it against a simulated night. One implementation, so a demo can
 * never show behaviour the board does not actually have — which is the whole
 * risk of demo screens, and the reason this was pulled out of board.html
 * rather than reimplemented beside it.
 *
 * Each alert is loud for its own hold and then parks. Loud forever is noise
 * people learn to ignore; loud once and gone is a problem nobody fixed.
 */

export const ALERT_HOLD_MIN = { meal: 10, out: 5, lunch: 5, in: 2 };
export const MEAL_LEN_MIN = 30;
export const LATE_IN_MIN = 15;

export const ALERT_WHAT = {
  out:   'HAS NOT CLOCKED OUT',
  lunch: 'NOT BACK FROM LUNCH',
  in:    'HAS NOT CLOCKED IN',
  meal:  'MEAL DEADLINE',
};

/**
 * @param {Array} people [{ id, name, role, rostered,
 *                          clockInMin|null, clockedOut, schedInMin|null,
 *                          schedOutMin|null, openMeal: { startMin } | null }]
 * @param {number} nowMin  minutes from midnight, may exceed 1440 past midnight
 * @param {number} nowMs   wall clock, only used to age the alerts
 * @param {Map} firstSeen  key -> ms first observed. MUTATED, and must live
 *        outside the caller's render loop: the board recomputes every five
 *        seconds, and a countdown stored per run restarts on every tick, so
 *        nothing would ever park.
 * @returns {Array} [{ kind, key, id, name, role, at, over, loud }]
 */
export function attendanceAlerts(people, nowMin, nowMs, firstSeen) {
  const out = [];
  for (const p of people) {
    /* Checked before the shift-end case on purpose: somebody on an unclosed
       meal AND past their end is more usefully described as missing from the
       floor than as having forgotten to clock out. */
    if (p.openMeal) {
      const due = p.openMeal.startMin + MEAL_LEN_MIN;
      if (nowMin >= due) out.push({ kind: 'lunch', id: p.id, name: p.name,
        role: p.role || '', over: nowMin - due, atMin: due });
      continue;
    }
    /* clockedOut, not just clockInMin: somebody who HAS closed their shift is
       the case this alert exists to detect the absence of. Dropping it made a
       finished shift keep shouting. */
    if (p.clockInMin != null && !p.clockedOut && p.schedOutMin != null) {
      const end = p.schedOutMin <= (p.schedInMin ?? 0) ? p.schedOutMin + 1440 : p.schedOutMin;
      if (nowMin >= end) out.push({ kind: 'out', id: p.id, name: p.name,
        role: p.role || '', over: nowMin - end, atMin: p.schedOutMin });
      continue;
    }
    if (p.clockInMin == null && p.rostered && p.schedInMin != null
        && nowMin >= p.schedInMin + LATE_IN_MIN) {
      out.push({ kind: 'in', id: p.id, name: p.name, role: p.role || '',
                 over: nowMin - p.schedInMin, atMin: p.schedInMin });
    }
  }

  /* Forget keys that have gone away, so the same problem recurring later
     shouts again rather than arriving pre-parked. */
  const live = new Set(out.map(a => `${a.kind}|${a.id}`));
  for (const k of [...firstSeen.keys()]) {
    if (!live.has(k) && !k.startsWith('meal|')) firstSeen.delete(k);
  }

  return out.map(a => {
    const key = `${a.kind}|${a.id}`;
    if (!firstSeen.has(key)) firstSeen.set(key, nowMs);
    const held = (ALERT_HOLD_MIN[a.kind] ?? 5) * 60000;
    return { ...a, key, loud: (nowMs - firstSeen.get(key)) < held };
  });
}
