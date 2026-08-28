/**
 * California regular rate and overtime premiums.
 *
 * This is the module that turns hours into money. It is separate from
 * ca-overtime.js on purpose: that one decides WHICH hours are premium, this one
 * decides WHAT THEY COST. Mixing the two is how payroll bugs get made, because
 * the two questions have completely different inputs.
 *
 * THE CENTRAL POINT, and the reason this exists at all:
 *
 *   Overtime is NOT paid at 1.5x the base hourly wage. It is paid at 1.5x the
 *   REGULAR RATE, which is base wages plus commission and other includable pay,
 *   divided by hours worked. Commission raises it. Paying overtime on base rate
 *   alone underpays every time commission is earned in an overtime week.
 *
 * Premiums are expressed as ADDITIONAL pay on top of straight time for all
 * hours, which is how California computes them:
 *   time-and-a-half hours owe an extra 0.5 x regular rate
 *   double-time hours   owe an extra 1.0 x regular rate
 */

export const MIN_WAGE_DEFAULT = 16.50;   // CA state floor; local ordinances may exceed it

/**
 * Commission is production-based, so it uses the ordinary regular-rate formula.
 * A FLAT-SUM bonus does not: it is divided by non-overtime hours only and
 * carries a 1.5x multiplier instead of 0.5x. Callers must say which they mean.
 */
export const PRODUCTION = 'production';   // commission, piece rate, shift differential
export const FLAT_SUM = 'flat_sum';       // e.g. "$100 for working the weekend"

/**
 * @param {object} input
 * @param {number} input.hoursWorked      total hours actually worked in the workweek
 * @param {number} input.ot15Hours        hours classified as time-and-a-half
 * @param {number} input.ot20Hours        hours classified as double time
 * @param {number} input.baseRate         hourly wage
 * @param {Array<{amount:number, kind?:string}>} [input.extraPay]
 *        includable pay earned in this workweek — commission, non-discretionary
 *        bonuses, shift differentials. Discretionary gifts, expense
 *        reimbursements and pay for time not worked must NOT be passed here.
 * @param {number} [input.minimumWage]
 * @returns {object} breakdown
 */
export function regularRateForWeek(input) {
  const {
    hoursWorked, ot15Hours = 0, ot20Hours = 0, baseRate,
    extraPay = [], minimumWage = MIN_WAGE_DEFAULT,
  } = input;

  if (!hoursWorked || hoursWorked <= 0) {
    return { regularRate: 0, baseWages: 0, includablePay: 0, premium: 0,
             straightTime: 0, total: 0, belowMinimum: false, flatSumPremium: 0 };
  }

  const production = extraPay.filter(p => (p.kind ?? PRODUCTION) === PRODUCTION);
  const flatSum = extraPay.filter(p => p.kind === FLAT_SUM);

  const baseWages = round2(baseRate * hoursWorked);
  const productionPay = round2(production.reduce((s, p) => s + p.amount, 0));
  const flatSumPay = round2(flatSum.reduce((s, p) => s + p.amount, 0));

  // Ordinary regular rate: all includable pay over ALL hours worked.
  let regularRate = (baseWages + productionPay) / hoursWorked;

  // The regular rate can never fall below minimum wage.
  const belowMinimum = regularRate < minimumWage;
  if (belowMinimum) regularRate = minimumWage;

  // Premiums: the EXTRA owed beyond straight time.
  const premium = round2(0.5 * regularRate * ot15Hours + 1.0 * regularRate * ot20Hours);

  // Flat-sum bonuses use their own rate: divided by NON-overtime hours only,
  // and a 1.5x multiplier rather than 0.5x.
  const nonOtHours = Math.max(0, hoursWorked - ot15Hours - ot20Hours);
  const flatSumRate = (flatSumPay > 0 && nonOtHours > 0) ? flatSumPay / nonOtHours : 0;
  const flatSumPremium = round2(1.5 * flatSumRate * (ot15Hours + ot20Hours));

  const straightTime = round2(baseWages + productionPay + flatSumPay);

  return {
    regularRate: round4(regularRate),
    baseWages,
    includablePay: productionPay,
    flatSumPay,
    straightTime,
    premium,
    flatSumPremium,
    total: round2(straightTime + premium + flatSumPremium),
    belowMinimum,
    // What the naive-but-wrong calculation would have produced, so the
    // difference commission makes can be shown rather than asserted.
    premiumOnBaseRateOnly: round2(0.5 * baseRate * ot15Hours + 1.0 * baseRate * ot20Hours),
  };
}

/** The extra owed purely because commission raised the regular rate. */
export function commissionRateAdjustment(input) {
  const r = regularRateForWeek(input);
  return round2(r.premium - r.premiumOnBaseRateOnly);
}

/**
 * Break premiums are paid at the REGULAR rate, not the base rate — so
 * commission raises these too. Capped at one meal premium and one rest premium
 * per workday regardless of how many were missed.
 */
export function breakPremiumPay(regularRate, days) {
  const hours = days.reduce((n, d) => n + (d.mealViolation ? 1 : 0) + (d.restViolation ? 1 : 0), 0);
  return { hours, pay: round2(hours * regularRate) };
}

/**
 * BIWEEKLY pay periods: fourteen days, always starting on a Monday.
 *
 * NOT semi-monthly. This was 1st–15th / 16th–end-of-month until Frontier
 * corrected it in August 2026, and the difference is not cosmetic — a
 * fortnightly period drifts against the calendar, so period boundaries land on
 * "very uneven days" and no month contains a whole number of them.
 *
 * Everything derives from a single anchor Monday. Changing the anchor moves
 * every period at once and is the ONLY thing that needs editing when the real
 * boundary is confirmed. The anchor below is provisional.
 */
export const PAY_PERIOD_DAYS = 14;

/** Provisional. Must be a Monday. Change this one line to re-align every period. */
export const PAY_PERIOD_ANCHOR = '2026-08-03';   // Monday. PROVISIONAL — confirm.

/**
 * @param {string} dateISO
 * @param {string} [anchor] a Monday any number of whole fortnights away
 * @returns {{start:string, end:string, index:number}} index counts fortnights
 *          from the anchor and may be negative for dates before it.
 */
export function payPeriodFor(dateISO, anchor = PAY_PERIOD_ANCHOR) {
  const day = 86400000;
  const d = Date.parse(dateISO + 'T00:00:00Z');
  const a = Date.parse(anchor + 'T00:00:00Z');
  /* Floor, not truncate: a date before the anchor belongs to the period that
     CONTAINS it, and truncation would round it toward the anchor instead. */
  const index = Math.floor((d - a) / (PAY_PERIOD_DAYS * day));
  const start = a + index * PAY_PERIOD_DAYS * day;
  return {
    start: new Date(start).toISOString().slice(0, 10),
    end: new Date(start + (PAY_PERIOD_DAYS - 1) * day).toISOString().slice(0, 10),
    index,
  };
}

/** Does a pay period line up exactly with a schedule fortnight? Both are
 *  Monday-anchored fortnights, so they either coincide or are offset by a
 *  whole week — and which one it is decides whether a published schedule can
 *  be read straight off as a timesheet. */
export function alignsWithSchedule(payAnchor = PAY_PERIOD_ANCHOR, scheduleMonday) {
  const day = 86400000;
  const diff = Math.round(
    (Date.parse(scheduleMonday + 'T00:00:00Z') - Date.parse(payAnchor + 'T00:00:00Z')) / day);
  return ((diff % PAY_PERIOD_DAYS) + PAY_PERIOD_DAYS) % PAY_PERIOD_DAYS === 0;
}
function round2(n) { return Math.round(n * 100) / 100; }
function round4(n) { return Math.round(n * 10000) / 10000; }
