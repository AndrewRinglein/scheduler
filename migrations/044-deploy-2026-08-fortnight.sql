-- 044: the August fortnight is not a draft.
--
-- Angela: "None of these days are drafts anymore. Update them to be actual
-- schedules."
--
-- Every session listed here came from a schedule she wrote -- the six RWC
-- nights from RCV Schedule 8_11-8_20, and the SCV nights from her SCV sheet.
-- 'draft' means the app guessed; these are what the halls are running.
--
-- SC on 10 August is deliberately NOT included. It predates her SCV sheet and
-- was filled from the PTO availability guess, so stamping it as an actual
-- schedule would be a lie about where it came from. It stays draft until it
-- comes from somewhere real.
--
-- This is a plain status update and sends nothing to anybody. Telling staff is
-- schedule_publish(), behind the "Publish this fortnight" button, and that is
-- hers to press -- there is no version of this where a migration texts sixty
-- people because a status column changed.
--
-- Reversible: set the same rows back to 'draft'.

update public.sched_sessions s
   set status = 'deployed', updated_at = now()
 where s.status <> 'deployed'
   and ( (s.hall_id = 'rwc' and s.session_date in
            (date '2026-08-11', date '2026-08-12', date '2026-08-13',
             date '2026-08-18', date '2026-08-19', date '2026-08-20'))
      or (s.hall_id = 'sc'  and s.session_date in
            (date '2026-08-14', date '2026-08-15', date '2026-08-16',
             date '2026-08-17', date '2026-08-21', date '2026-08-22',
             date '2026-08-23')) );
