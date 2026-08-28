/**
 * California overtime classification.
 *
 * Pure functions. No database, no dates-from-now, no I/O — so the rules can be
 * tested exhaustively and audited by someone who knows the law better than the
 * person who wrote the code.
 *
 * WHAT THIS DOES: splits hours into regular / time-and-a-half / double-time for
 * one workweek, for one employee.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: calculate pay. Turning hours into money
 * needs the regular rate, which needs commission, non-discretionary bonuses,
 * shift differentials, piece rate, weighted averages across multiple rates, and
 * the flat-sum-bonus special case. That belongs in its own module with its own
 * tests. Classifying hours and pricing them are different problems and mixing
 * them is how subtle payroll bugs get made.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE WORKWEEK IS MONDAY. A workweek is a fixed, employer-designated period of
 * seven consecutive 24-hour periods. It is not "the last 7 days" and it is not
 * the pay period. Every number this module produces depends on where that
 * boundary sits — which hours land in a week, when the 40-hour threshold is
 * crossed, and which day counts as the seventh consecutive one.
 *
 * Confirmed by Frontier (August 2026): the work week starts on a Monday. This
 * was a Sunday placeholder until then, and the change is not cosmetic — a
 * Saturday and Sunday that used to open a week now close the previous one, so
 * weekend hours can push a week over 40 that previously started fresh.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const DEFAULT_WORKWEEK_START_DOW = 1;   // 1 = Monday. Confirmed by Frontier, Aug 2026.

export const REGULAR = 'regular';
export const OT_15 = 'ot1_5';
export const OT_20 = 'ot2_0';

const DAILY_OT_THRESHOLD = 8;
const DAILY_DT_THRESHOLD = 12;
const WEEKLY_OT_THRESHOLD = 40;
const SEVENTH_DAY_OT_HOURS = 8;

/** Which workweek does this date fall in? Returns the workweek's start date. */
export function workweekStart(dateISO, startDow = DEFAULT_WORKWEEK_START_DOW) {
  const d = new Date(dateISO + 'T00:00:00Z');
  const shift = (d.getUTCDay() - startDow + 7) % 7;
  d.setUTCDate(d.getUTCDate() - shift);
  return d.toISOString().slice(0, 10);
}

/**
 * Classify one workweek's hours.
 *
 * @param {Array<{date:string, hours:number, worked?:boolean}>} days
 *        One entry per day the person had hours. `worked` defaults to true;
 *        pass false for vacation/holiday/sick/PTO — those hours are paid but do
 *        NOT count toward the 40-hour threshold and do not make a day count as
 *        a consecutive worked day.
 * @param {object} [opts]
 * @param {number} [opts.startDow]
 * @returns {{days:Array, totals:{regular:number, ot1_5:number, ot2_0:number},
 *            seventhDay:string|null, workweek:string}}
 */
export function classifyWorkweek(days, opts = {}) {
  const startDow = opts.startDow ?? DEFAULT_WORKWEEK_START_DOW;
  if (!days.length) {
    return { days: [], totals: { regular: 0, ot1_5: 0, ot2_0: 0 }, seventhDay: null, workweek: null };
  }

  const week = workweekStart(days[0].date, startDow);
  for (const d of days) {
    if (workweekStart(d.date, startDow) !== week) {
      throw new Error(
        `classifyWorkweek got days from different workweeks (${week} and ` +
        `${workweekStart(d.date, startDow)}). Split them first — overtime is ` +
        `always calculated per workweek.`);
    }
  }

  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));

  // The seventh-day rule applies to the seventh CONSECUTIVE day worked within
  // this workweek. It resets at the workweek boundary; it is not rolling.
  // Days that are not "worked" (PTO etc.) break the run.
  let run = 0, seventhDay = null;
  let cursor = null;
  for (const d of sorted) {
    const worked = d.worked !== false && d.hours > 0;
    if (!worked) { run = 0; cursor = d.date; continue; }
    const consecutive = cursor === null || dayDiff(cursor, d.date) === 1;
    run = consecutive ? run + 1 : 1;
    cursor = d.date;
    if (run === 7 && seventhDay === null) seventhDay = d.date;
  }

  // Pass 1 — daily rules.
  const out = sorted.map(d => {
    const h = d.hours;
    const worked = d.worked !== false;

    if (!worked) {
      // Paid, but not hours worked. No premium, no contribution to the 40.
      return { date: d.date, hours: h, worked: false,
               regular: h, ot1_5: 0, ot2_0: 0, countsToward40: 0, seventhDay: false };
    }

    if (d.date === seventhDay) {
      // First 8 at time-and-a-half, everything beyond at double time.
      // No straight-time hours arise, so nothing feeds the 40-hour test.
      return { date: d.date, hours: h, worked: true,
               regular: 0,
               ot1_5: Math.min(h, SEVENTH_DAY_OT_HOURS),
               ot2_0: Math.max(0, h - SEVENTH_DAY_OT_HOURS),
               countsToward40: 0, seventhDay: true };
    }

    const regular = Math.min(h, DAILY_OT_THRESHOLD);
    const ot1_5 = Math.max(0, Math.min(h, DAILY_DT_THRESHOLD) - DAILY_OT_THRESHOLD);
    const ot2_0 = Math.max(0, h - DAILY_DT_THRESHOLD);
    return { date: d.date, hours: h, worked: true,
             regular, ot1_5, ot2_0, countsToward40: regular, seventhDay: false };
  });

  // Pass 2 — weekly rule, applied only to straight-time hours.
  //
  // No pyramiding: an hour already paid as daily overtime is excluded from the
  // 40-hour count, so it can never be paid a premium twice. That is why this
  // pass walks `countsToward40` rather than `hours`.
  let straightSoFar = 0;
  for (const day of out) {
    if (!day.countsToward40) continue;
    const before = straightSoFar;
    straightSoFar += day.countsToward40;
    const overBy = Math.min(day.countsToward40, Math.max(0, straightSoFar - WEEKLY_OT_THRESHOLD));
    if (overBy > 0) {
      day.regular -= overBy;
      day.ot1_5 += overBy;
      day.weeklyOt = overBy;
    }
    void before;
  }

  const totals = out.reduce((t, d) => ({
    regular: round2(t.regular + d.regular),
    ot1_5: round2(t.ot1_5 + d.ot1_5),
    ot2_0: round2(t.ot2_0 + d.ot2_0),
  }), { regular: 0, ot1_5: 0, ot2_0: 0 });

  return { days: out, totals, seventhDay, workweek: week };
}

/**
 * How many consecutive days would this person be worked if a shift were added
 * on `date`? Used to enforce the no-seven-days-in-a-row scheduling rule.
 * Counts within the workweek only, matching how the seventh-day rule works.
 */
export function consecutiveDaysIfAdded(existingDates, date, opts = {}) {
  const startDow = opts.startDow ?? DEFAULT_WORKWEEK_START_DOW;
  const week = workweekStart(date, startDow);
  const set = new Set(existingDates.filter(d => workweekStart(d, startDow) === week));
  set.add(date);
  const all = [...set].sort();

  let best = 0, run = 0, prev = null;
  for (const d of all) {
    run = (prev && dayDiff(prev, d) === 1) ? run + 1 : 1;
    prev = d;
    if (run > best) best = run;
  }
  return best;
}

/** Would adding this shift put the person on a 7th consecutive day? */
export function violatesSeventhDay(existingDates, date, opts = {}) {
  return consecutiveDaysIfAdded(existingDates, date, opts) >= 7;
}

/* ---------------------------------------------------------------- helpers */

function dayDiff(a, b) {
  return Math.round(
    (Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

function round2(n) { return Math.round(n * 100) / 100; }

/** Hours between two HH:MM times, handling shifts that cross midnight. */
export function shiftHours(start, end) {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60;         // crosses midnight, as bingo sessions do
  return round2(mins / 60);
}
