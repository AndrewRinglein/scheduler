# Employee Management — Bingo Hall Scheduler

Staff scheduling for Frontier Gaming Systems: who works which session, which job
they're doing, when they go on break, and who covers the floor while they're gone.
Replaces the spreadsheet Rachel builds by hand every fortnight.

---

## Where things live

**Database:** the **Operational DB** Supabase project (`lkcfbgnuodqzvowschjn`) — the
same project as the inventory system. Every scheduler table is prefixed `sched_`
to keep the two apart. This is *not* the bingo-ecommerce database; nothing here
touches it.

**Halls:** `rwc` (Redwood City) and `sc` (Santa Clara), already in `halls`.
Santa Clara and Redwood City run different schedules.

**Operating days:** Friday, Saturday, Sunday, Monday only. Weekends run two
sessions (AM and PM); Friday and Monday run one.

## Current state

Loaded with Rachel's real 7/31–8/10 Santa Clara schedule: **53 staff, 12 sessions,
228 assignments**, verified headcount-for-headcount against the source spreadsheet.

| Page | What it does |
|---|---|
| `sched/schedule.html` | Live week cards (draft / planned / deployed) → day roster + caller rotation |
| `sched/roles.html` | Read and edit the six roles |
| `sched/week-view.html` | Static snapshot of the original spreadsheet, kept for reference |

Sign in as `staff@bingohalls.app`.

## The six roles

MOD · Opener/Swing Shift · Paymaster · Flash Manager · Callers/Strip · Flash Runners

The first four are one person each. Callers/Strip is four. Flash Runners varies —
nine to twelve per session in practice.

## Things that will bite you

**Start times are not per role.** They vary by role × day-type × session part, and
live in `sched_role_times`. Paymaster is 2pm Friday/Monday, 9:30am weekend AM,
3:30pm weekend PM.

**`min_on_floor` = `fixed_count` means that role can never take a break.** True of
MOD, Paymaster and Flash Manager. Not a bug — it's why the prototype had managers
skip scheduled breaks. The roles screen says so out loud.

**Capability flags, it never blocks.** `sched_staff_role_capability` decides whether
slotting someone shows a "not trained for this role" caution. It never filters a
dropdown and never refuses a save. On a short-staffed night the manager must be able
to put a body in a chair; software that refuses gets worked around, and then the
schedule lives on paper where nobody can see it.

**Staffing is manager-publishes.** She builds the whole schedule and puts it out;
staff acknowledge. Nobody claims or queues for shifts — waitlists are explicitly out
of scope, and the claim/release/auto-promote logic in `SCHEDULER-MOCKUP.html` is not
to be ported.

**The handoff rule.** A shift is never quietly unowned. If Rosa hands Thursday to
Tina and Tina accepts, that's sufficient — it transfers immediately, no manager gate.
If Rosa just declines with no replacement, the manager is notified straight away.
The asymmetry is the point: a solved problem needs no permission, an unsolved one
must never wait to be discovered.

## Caller rotation

Callers move through Calling → Verifying → Strips/Support across three sections of a
session. Rachel built these by hand and said there was no reason behind them — but all
twelve in her sheet follow one cyclic rule, and `sched/js/caller-rotation.js`
reproduces **who is calling in 36 of 36 sections**. `validateRotation()` checks the
invariants independently, so a hand-edited rotation can be checked too.

## Layout

```
migrations/     001, 002, and the import of Rachel's schedule
migrations/_superseded/   written for the wrong database — do not run
sched/          the pages
sched/js/       caller-rotation.js and the (now redundant) demo guard
tests/          node --test; 17 passing
docs/           design spec and the 62-stage implementation plan
```

Run tests with `npm test`.

## Open questions

- What does a slash in a cell mean — "Sagit/Rachel", "Ruthie/Raman*"? Either, both,
  or a split shift? Currently imported as the first name with the full text kept in
  `note`.
- How urgent is the unfilled-shift alert? Assumed: immediate, escalating inside 48 hours.
- Redwood City's schedule differs from Santa Clara's and has not been looked at yet.
