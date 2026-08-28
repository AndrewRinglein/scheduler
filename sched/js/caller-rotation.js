/**
 * Caller rotation.
 *
 * Callers move through positions across the three sections of a session.
 * Rachel built these by hand and said there was no particular reason behind
 * them — but the twelve rotations in her 7/31–8/10 sheet turn out to follow a
 * consistent cyclic pattern, so this reproduces what she was already doing
 * rather than imposing something new.
 *
 * For caller at index i, section s (both 0-based), with C = number of calling
 * positions (3, one per section):
 *
 *   i === s              -> Calling      (each of the first three calls once)
 *   i === (s + 1) % C    -> Verifying    (verifier is the next caller round)
 *   otherwise            -> Strips/Support
 *
 * Trainees never take a position; they shadow all three sections. Extra
 * callers beyond the first three land on Strips/Support, which is exactly
 * where Ruthie and Raman sit in the real sheet.
 */

export const CALLING = 'Calling';
export const VERIFYING = 'Verifying';
export const SUPPORT = 'Strips/Support';
export const TRAINING = 'Training';

export const SECTIONS = 3;

/**
 * @param {Array<{name:string, training?:boolean, canCall?:boolean}>} callers
 * @param {object} [opts]
 * @param {number} [opts.sections=3]
 * @param {Object<string,Object<number,string>>} [opts.overrides]
 *        name -> { sectionIndex: 'PM Paymaster Duties' } for the real-world
 *        cases where someone's last section is spent doing another job.
 * @returns {Array<{name:string, sections:string[]}>}
 */
export function planRotation(callers, opts = {}) {
  const sections = opts.sections ?? SECTIONS;
  const overrides = opts.overrides ?? {};

  // Only non-trainees are eligible to hold a position.
  const eligible = callers.filter(c => !c.training && c.canCall !== false);
  const cycle = Math.min(sections, eligible.length);

  return callers.map(c => {
    if (c.training) {
      return { name: c.name, sections: Array(sections).fill(TRAINING) };
    }
    const i = eligible.indexOf(c);
    const out = [];
    for (let s = 0; s < sections; s++) {
      const ov = overrides[c.name]?.[s];
      if (ov) { out.push(ov); continue; }
      if (cycle > 0 && i === s % cycle) out.push(CALLING);
      else if (cycle > 1 && i === (s + 1) % cycle) out.push(VERIFYING);
      else out.push(SUPPORT);
    }
    return { name: c.name, sections: out };
  });
}

/* A duty can change hands PART WAY THROUGH a section -- Angela's RWC sheet
 * writes it "Calling/Verifying", meaning this person starts the section
 * calling and finishes it verifying, while somebody else comes the other way.
 * It is stored with an arrow rather than a slash because the cart's own label,
 * "Strips/Support", already contains a slash and "Calling/Cart" would come out
 * as "Calling/Strips/Support" and read as three duties.
 *
 * Validating the stored string as a single value reported "0 callers" for the
 * middle section of every RWC night -- a false alarm on a rotation that is
 * perfectly correct. So a section is checked at its start and at its end. */
export const HANDOVER = ' → ';
export function rotParts(value) {
  const [a, b] = String(value ?? '').split('→').map(x => x.trim());
  return [a || '', b || a || ''];
}
/** What this person is doing at the start of the section. */
export const rotStart = v => rotParts(v)[0];
/** ...and at the end of it. */
export const rotEnd   = v => rotParts(v)[1];

/** Structural checks a rotation must satisfy, independent of how it was made. */
export function validateRotation(plan, sections = SECTIONS) {
  const problems = [];
  for (let s = 0; s < sections; s++) {
    const inSection = plan.map(p => p.sections[s]);
    for (const [when, at] of [['start', rotStart], ['end', rotEnd]]) {
      const duties = inSection.map(at);
      const calling = duties.filter(x => x === CALLING).length;
      const verifying = duties.filter(x => x === VERIFYING).length;
      /* Only say "at the start"/"at the end" when the section actually has a
         handover in it -- otherwise every ordinary problem is reported twice. */
      const split = inSection.some(v => rotStart(v) !== rotEnd(v));
      const where = `section ${s + 1}${split ? ` (at the ${when})` : ''}`;
      if (calling !== 1) problems.push(`${where}: ${calling} callers (want exactly 1)`);
      if (verifying > 1) problems.push(`${where}: ${verifying} verifiers (want at most 1)`);
      if (!split) break;                 // no handover, so start and end agree
    }
  }
  for (const p of plan) {
    if (p.sections.some(v => rotParts(v).includes(TRAINING))
        && p.sections.some(v => rotParts(v).includes(CALLING))) {
      problems.push(`${p.name}: trainee assigned to call`);
    }
  }
  return problems;
}
