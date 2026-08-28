# Implementation plan — what's left

Frontier bingo hall scheduler · 12 August 2026

Companion to `DESIGN-PLAN-REMAINING.md`. That document says **what** and **why**.
This one says **in what order**, **how small**, and **how you know a stage is done**.

Thirty-five stages. Every one is scoped so it can be held entirely in your head
in a single sitting.

---

## 0. How to use this

**One stage per session. Never two.** The stages are smaller than feels
necessary — that is deliberate. A stage you can hold in your head is a stage you
can verify, and a stage you can verify won't quietly break something three weeks
later.

**Every stage ends green.** If the acceptance checks don't all pass, the stage
isn't done. Don't start the next one. Half-finished stages are where drift
begins.

**Handing a stage to Claude Code.** Fresh context each time. Paste §1
Conventions plus one stage. Nothing else — the rest of the plan tempts it to
build ahead, and then you can't check the work.

> Here are the conventions for this repo. Implement exactly stage **A3** and
> nothing else. Do not start A4. When you're done, list how you verified each
> acceptance check. If a check can't pass, stop and tell me why rather than
> working around it.

Run the acceptance checks yourself. An agent reporting that a check passed is
not the same as the check passing.

**When the plan turns out to be wrong** — and it will — amend this file in the
same commit as the code, so the plan and the repo never disagree.

---

## 1. Conventions (every stage)

| Thing | Convention |
|---|---|
| Pages | Plain HTML + vanilla JS. No framework, no bundler, no ES modules at runtime. They must open by double-clicking. |
| Building | Edit `sched/js/**`, then `node build.js`. Never edit `sched/manager.html` or `sched/board.html` directly — they're generated. |
| Images | **Never `loading="lazy"`.** On a `file://` page it is never fetched at all. `build.js` refuses to write a page containing one. |
| Art | Characters come from `ART[...]` embedded by `build.js`, never a relative path. Regenerate with `tools/embed-art.sh`. |
| Database | All calls live in `sched/js/api.js`. Views receive data, never fetch it. |
| Migrations | Additive and reversible. Numbered, saved in `migrations/`, applied to the live project — there is no staging. |
| Worker access | Anonymous, via a token, through `SECURITY DEFINER` functions scoped to one `staff_id`. Workers never get a login. |
| Tests | `npm test` must be green before a stage is done. New behaviour gets a test in the same stage. |
| Art check | `node tools/check-art.mjs` after touching any page that draws a character. |
| Dates | `YYYY-MM-DD` strings. Never parse to a local `Date` for display — it slides a day west of UTC. |
| Workweek | Starts **Monday**. Pay periods are 14 days from `PAY_PERIOD_ANCHOR`. |

---

# Block A — The worker sees their shifts

*Nothing here is blocked. No credentials, no domain, no third party.*

### A1 · `worker_shifts` returns published shifts
Add to `worker_home`, or a sibling RPC, the list of shifts for this token's
person: date, hall, role, start time, session id, assignment id, and their
response state. **Only from periods whose status is `published`** — a draft is
Rachel thinking, not a commitment.

**Accept:** a person with three published shifts gets three; the same person
with those shifts in a draft period gets none; an unknown token gets `ok:false`.

### A2 · The shifts section renders
`me.html` grows a *My shifts* section above availability. Date, day name, hall
badge, role, start time. Grouped by week. Nothing clickable yet.

**Accept:** shifts render in date order; someone with none sees a sentence
saying so, not an empty box; `node tools/check-art.mjs` still passes 7/7.

### A3 · Acknowledge a shift
A **Got it** button per shift calling `worker_shift_respond(token, assignment,
'accepted')`. The button becomes a quiet "acknowledged" state.

**Accept:** tapping it persists; reloading keeps it; acknowledging twice is
harmless.

### A4 · Decline, with the warning
An **I can't work this** button. First tap shows the warning in plain language:
*"You're expected to find someone to take it. Declining without a replacement
isn't normally allowed and your manager will be told."* Second tap confirms.

On confirm: the assignment's `staff_id` is cleared, `response` becomes
`declined`, and a row lands in `sched_declines` (staff, assignment, session,
declined_at). **Decided:** the slot empties.

**Accept:** the warning appears before anything is written; after confirming,
the slot is empty in the manager app and a decline row exists; the worker's page
no longer lists the shift.

### A5 · Declines are visible in the schedule
The manager's day roster marks a slot that was declined — who declined it and
when — so an empty slot with history reads differently from one never filled.

**Accept:** a declined slot shows the previous person's name and the date;
`viewWeek` renders with no errors when there are no declines at all.

---

# Block B — Handing a shift over

*Depends on A. Nothing else.*

### B1 · The handoff table
Migration: `sched_handoffs` — id, assignment_id, session_id, from_staff,
to_staff, status (`pending|accepted|declined|expired`), requested_at,
resolved_at. Partial unique index enforcing **one pending handoff per
assignment**.

**Accept:** a second pending handoff for the same assignment is rejected by the
database, not by application code; the error is reported and quoted.

### B2 · Who can cover
`handoff_candidates(token, assignment)` returning people who are **qualified for
that exact role**, active, not already working that session, and not marked
unavailable that day. First names and characters only — never a phone or email.

**Accept:** a caller's list contains only callers and named deputies; somebody
already in another chair that session is absent; the returned objects contain no
contact details.

### B3 · Asking someone
The worker picks a candidate; `handoff_request(token, assignment, to_staff)`
creates the pending row. Their shift now shows *waiting on <name>*, with a way
to cancel.

**Accept:** the request persists; the shift still belongs to the original person
throughout; cancelling returns it to normal.

### B4 · The replacement answers
The asked person sees *"<Name> has asked you to take Friday 15th, Santa Clara,
caller, from 3:15"* on their own page, with accept and decline.

**Accept — accept:** the assignment's `staff_id` moves, `handed_from` records
where it came from, the handoff resolves, and it appears on the new person's
shift list and not the old one's.
**Accept — decline:** the shift stays with the original person, who can ask
somebody else.

### B5 · Expiry and the race
A handoff pending when its session starts becomes `expired` and stops showing.
Two people accepting the same handoff: the second gets a clear message, not a
double booking.

**Accept:** an expired handoff is invisible to both parties; accepting an
already-resolved handoff returns a readable error and changes nothing.

---

# Block C — The worker sees their hours

### C1 · `worker_hours` for the pay period
RPC returning, for this token's person and the current pay period (14 days from
`PAY_PERIOD_ANCHOR`): hours worked, overtime hours, commission earned, and the
period's start and end. **No pay rate — it is not stored and must not be
derived.**

**Accept:** totals match the Staff hours screen for the same person and period;
the response contains no rate under any key.

### C2 · The hours section renders
*My hours* on `me.html`: the period dates, hours, overtime, commission. One step
back to the previous period.

**Accept:** somebody with no hours sees zeroes and a period, not a blank; the
dates shown are the real period boundaries and start on a Monday.

---

# Block D — Rachel's list

### D1 · `manager_attention`
One RPC returning the five things: non-repliers to the open availability
request, declines since last seen, handoffs completed since last seen, critical
staff over their two days, and published sessions that are short.

**Accept:** returns all five keys even when every one is empty; counts match
hand-run queries.

### D2 · The tab
A nav item with a count badge. Each entry links to the thing it's about. A
"mark all seen" that moves a `last_seen_at` on the manager's own row.

**Accept:** the badge count equals the number of entries; after marking seen,
declines and handoffs drop out but short sessions and non-repliers remain,
because those are states rather than events.

---

# Block E — The break plan, before the night

### E1 · The Gantt
A manager view for a chosen session: one row per person, the evening across the
top, meals and rests as blocks, conflicts in red, and the coverage floor per
role stated. Reads `planBreaks()` — no new data.

**Accept:** a real Santa Clara Friday renders 57 breaks and no conflicts; a
session with nobody assigned says so rather than rendering an empty grid.

---

# Block F — The board, finished

*All board-side. No new data.*

### F1 · The five-minute warning
The person's tile turns red and blinks for the full five minutes before a break
is due. A due alert supersedes any warning.

**Accept:** the warning starts exactly five minutes out and stops when the break
starts; when a takeover fires, no warning is visible anywhere.

### F2 · Name flash and freeze
The person's name flashes across the board for one minute. During any alert the
floor freezes and dims. **The alert always wins.**

**Accept:** with an alert active, no character moves and no chase can start;
dismissing the alert resumes the floor from where it stopped, not from the left
edge.

### F3 · Sound, behind a control
An *enable sound* button — browsers won't play audio unbidden, and the back room
shouldn't start making noises by itself. Chirp on clock-in, meow on a break
alert, chime on postpone.

**Accept:** silent until enabled; the choice survives a reload; every sound is
short enough not to overlap the next one.

### F4 · Chase and groom
A dog occasionally chases a cat, with a bark. Two stopped characters near each
other pause and one grooms the other, with a purr.

**Accept:** neither behaviour starts while an alert is up; a chase ends and both
return to ordinary wandering; nothing throws when only one character is on the
floor.

---

# Block G — Building a fortnight faster

### G1 · Copy the last fortnight
Copies people into the same roles where they are still qualified and still
available, leaves the rest empty, and **reports what it could not place and
why**.

**Accept:** somebody deactivated since is not copied; somebody who has said they
can't work that day is not copied; the report names both.

### G2 · Fill from availability
For each empty slot, offer qualified people who said yes and aren't already on
that session. **Suggests — does not commit.** Fills the dropdowns for Rachel to
confirm.

**Accept:** nobody who answered "no" is ever suggested; **nobody who has not
answered is treated as a yes**; nothing is saved until Rachel saves.

### G3 · Clear people
Empties every slot in the fortnight, keeping the shape. Confirms first, and says
how many filled slots are about to go.

**Accept:** the count in the confirmation matches what is removed; the crew
template is untouched.

---

# Block H — Messaging

*H1–H5 need nothing from anybody. H6 needs four strings. H7 needs a file
upload.*

### H1 · `notify()` and the log
One function: `notify(staff_id, template, vars)`. Picks the channel — SMS if
they have a number, email if not, never both. Templates in one place, rendering
for either channel. Every attempt logged to `sched_messages`. **Email only at
this stage;** the SMS branch returns "no channel" and logs it.

**Accept:** a person with an email is sent one; a person with neither is logged
as unreachable rather than failing; the calling code never names a channel.

### H2 · Availability requests go out
Sending a request calls `notify()` per person with their link. A nudge action
for non-repliers.

**Accept:** everyone asked gets one message; the nudge reaches only people with
no `replied_at`; sending twice does not double-message anyone.

### H3 · Publishing sends the booking messages
Publishing a fortnight notifies everybody with a shift in it, carrying their
link. **Publishing is the only trigger.**

**Accept:** editing a published fortnight sends nothing further; unpublishing
and republishing does not spam; the message names the number of shifts, not one
of them.

### H4 · Welcome and pick your pet
Adding a staff member offers to send the welcome message with their link.

**Accept:** the link works from a cold browser with no session; a person added
without contact details is logged as unreachable and the manager is told.

### H5 · Swap messages
"Can you take this?" on request, "you're covering this" on accept, "they said
no" on decline.

**Accept:** all three fire on the right transitions and no message goes to
somebody uninvolved.

### H6 · SMS turns on
Copy `aws-eum.ts` and `types.ts` verbatim. Set `AWS_EUM_ACCESS_KEY_ID`,
`AWS_EUM_SECRET_ACCESS_KEY`, `AWS_EUM_REGION`, `AWS_EUM_ORIGINATION_IDENTITY`.
`notify()` starts choosing SMS for people with a number. **No calling code
changes.**

**Accept:** one real text arrives; the message ends with the STOP line; a person
with both a number and an address gets exactly one message; git diff shows no
change to H2–H5.

### H7 · The link points somewhere real
`me.html` served from a bingobuyin.com URL. Link generation uses that instead of
the current `file://` path.

**Accept:** a link copied from the manager app opens on a phone on mobile data.

---

# Block I — Payroll export

### I1 · The review screen
A pay period showing unapproved walk-ups, missed or late meals owing premiums,
overtime flags, and anyone with an open or impossible entry. Each resolvable in
place.

**Accept:** a period with nothing wrong says so plainly; each flag type is
reproducible from seeded data.

### I2 · The gate
The Excel export is unavailable until every flag is resolved or explicitly
overridden with a reason.

**Accept:** the export button is disabled with the reason shown; an override is
recorded with who and why.

---

# Block J — Loose ends

### J1 · Ten more cats
40 cats, 51 floor runners, three people with nothing and no headroom for a hire.
Generate at least ten, drop them in `sched/art/pets`, run `tools/embed-art.sh`,
add the rows.

**Accept:** every active person has a character; the catalogue exceeds the
roster by at least ten.

### J2 · Real times for the management roles
MOD, Opener/Swing Shift and Flash Manager still carry guessed start and end
times flagged amber. They drive meal deadlines.

**Accept:** no `is_placeholder` rows remain for those roles; no amber "?" in the
scheduler.

### J3 · Retire the plaintext PIN
`admin_pin` is `4321` in settings, readable by anyone signed in. Move to the
hashed `set_manager_pin` path and delete the row.

**Accept:** no plaintext PIN in any table; the clock still accepts the manager
PIN.

### J4 · Chase the missing contacts
42 of 67 staff have neither a phone nor an email — the single largest constraint
on everything in Block H. A printable list of who's missing what, and a count on
the staff screen that doesn't go away until it's zero.

**Accept:** the list matches the database; the count decreases as details are
entered.

---

## Suggested order

**A → B → C** first. It is the substantial build, it needs nothing from anyone,
and it makes publishing mean something.

**D** next — small, and it makes A and B visible instead of silent.

**E, F** next. Cheap, self-contained, and the board is the part people enjoy.

**G** next. It saves Rachel the most repetitive hour she spends.

**H1–H5** next: the whole loop, running on email, needing nothing from anybody.
**H6–H7** the moment the four strings and the upload arrive.

**I** last of the features. **J** in the gaps — J4 should start now regardless,
because it is the only item on this list that gets slower the longer it waits.
