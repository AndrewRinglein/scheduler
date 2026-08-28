/**
 * California meal and rest period requirements.
 *
 * Pure. Given the hours worked in a day, says what was owed; given what was
 * actually taken, says whether the day complies and what premium is owed.
 *
 * REST — 10 paid minutes per 4 hours worked "or major fraction thereof", where
 * a major fraction means more than 2 hours:
 *      up to 3.5h   none
 *      over 3.5–6h  one
 *      over 6–10h   two
 *      over 10–14h  three
 * Rest breaks are PAID and count as hours worked, so they never shorten the day.
 *
 * MEAL — 30 unpaid minutes for a shift over 5 hours, beginning before the end of
 * the 5th hour. A second for a shift over 10 hours, before the end of the 10th.
 * The first may be waived only if the whole shift is 6 hours or less. The second
 * only if the shift is 12 hours or less AND the first was actually taken.
 *
 * PREMIUM — one extra hour for a workday with any meal violation, one for any
 * rest violation. Capped at one per category, so two hours a day at most however
 * many were missed. Paid at the regular rate, not the base rate.
 */

export function restBreaksRequired(hours) {
  if (hours <= 3.5) return 0;
  if (hours <= 6) return 1;
  if (hours <= 10) return 2;
  if (hours <= 14) return 3;
  return 4;
}

export function mealsRequired(hours) {
  if (hours > 10) return 2;
  if (hours > 5) return 1;
  return 0;
}

/** May the first meal be waived? Only on a shift of 6 hours or less. */
export function firstMealWaivable(hours) { return hours > 5 && hours <= 6; }

/** May the second be waived? Only up to 12 hours, and only if the first was TAKEN. */
export function secondMealWaivable(hours, firstActuallyTaken) {
  return hours > 10 && hours <= 12 && firstActuallyTaken === true;
}

/**
 * @param {object} day
 * @param {number} day.hours
 * @param {boolean} [day.mealTaken]
 * @param {boolean} [day.mealWaived]
 * @param {boolean} [day.secondMealTaken]
 * @param {boolean} [day.secondMealWaived]
 * @param {number}  [day.restsTaken]
 * @param {number}  [day.mealStartHour] hours into the shift the first meal began
 * @param {number}  [day.secondMealStartHour]
 */
export function checkDay(day) {
  const h = day.hours || 0;
  const restsReq = restBreaksRequired(h);
  const mealsReq = mealsRequired(h);
  const restsTaken = day.restsTaken ?? 0;
  const problems = [];

  if (restsTaken < restsReq) {
    problems.push(`${restsReq - restsTaken} of ${restsReq} rest break(s) missed`);
  }

  if (mealsReq >= 1) {
    if (day.mealTaken) {
      // Late is a violation even when taken: it must BEGIN before the 5th hour ends.
      if (day.mealStartHour != null && day.mealStartHour > 5) {
        problems.push(`first meal started at ${day.mealStartHour}h, after the 5th hour`);
      }
    } else if (day.mealWaived) {
      if (!firstMealWaivable(h)) {
        problems.push(`first meal waived on a ${h}h shift — only allowed at 6h or less`);
      }
    } else {
      problems.push('first meal not taken');
    }
  }

  if (mealsReq >= 2) {
    if (day.secondMealTaken) {
      if (day.secondMealStartHour != null && day.secondMealStartHour > 10) {
        problems.push(`second meal started at ${day.secondMealStartHour}h, after the 10th hour`);
      }
    } else if (day.secondMealWaived) {
      if (!secondMealWaivable(h, day.mealTaken === true)) {
        problems.push(day.mealTaken
          ? `second meal waived on a ${h}h shift — only allowed up to 12h`
          : 'second meal waived but the first was not actually taken');
      }
    } else {
      problems.push('second meal not taken');
    }
  }

  const mealProblem = problems.some(p => p.includes('meal'));
  const restProblem = problems.some(p => p.includes('rest'));

  return {
    restsRequired: restsReq,
    restsTaken,
    mealsRequired: mealsReq,
    problems,
    ok: problems.length === 0,
    // One premium hour per category per day, never more, however many were missed.
    mealPremiumHours: mealProblem ? 1 : 0,
    restPremiumHours: restProblem ? 1 : 0,
    premiumHours: (mealProblem ? 1 : 0) + (restProblem ? 1 : 0),
  };
}

/** Daily overtime for one day, independent of the weekly rules. */
export function dailyOvertime(hours) {
  return {
    regular: Math.min(hours, 8),
    ot1_5: Math.max(0, Math.min(hours, 12) - 8),
    ot2_0: Math.max(0, hours - 12),
  };
}
