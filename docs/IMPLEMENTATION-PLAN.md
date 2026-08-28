# Scheduler V2 — Implementation Plan

Companion to `SCHEDULER-DESIGN-V2.md`. That document says **what** and **why**.
This one says **in what order**, **how small**, and **how you know a step is done**.

Written to be worked one stage at a time. Each stage is scoped so that a person — or an
AI agent handed only this file plus the repo — can complete it in a single focused sitting
without needing to hold the rest of the system in their head.

---

## 0. How to use this document

**One stage per working session. Never two.** The stages are deliberately smaller than feels
necessary. That is the point: a stage you can hold entirely in your head is a stage you can
verify, and a stage you can verify is one that won't quietly break something else three weeks later.

**Every stage must end green.** If a stage's acceptance checks don't all pass, the stage is not
done — do not start the next one. Half-finished stages are where drift begins.

**Working with Claude Code (this is how this project is being built).** Start a fresh context per
stage. Paste **§1 Conventions, §2 Demo mode, and the single stage** — nothing else. The conventions
are short and prevent the agent inventing its own patterns; the rest of the plan would tempt it to
build ahead, and you would lose the ability to check its work.

A prompt that works:

> Here are the conventions for this repo and the demo-mode rules. Implement exactly stage **B1**
> and nothing else. Do not start B2. When you're done, list how you verified each acceptance
> check. If an acceptance check can't pass, stop and tell me why instead of working around it.

When it finishes, run the acceptance checks **yourself** before accepting the diff. The agent
reporting that a check passed is not the same as the check passing.

**When you find the plan is wrong.** You will. Amend this file in the same commit as the code,
so the plan and the repo never disagree.

---

## 1. Conventions (these apply to every stage)

Existing repo conventions this build must follow — deviating from them is a defect, not a choice:

| Thing | Convention |
|---|---|
| Location | Everything lives under `sched/` in `bingo-ecommerce-main`. No new repo, no new backend. |
| Data access | All reads/writes go through `FGSData` in `fgs-data.js`. No direct `fetch` to Supabase from a page. |
| Auth | `FGSAuth.getAuthHeaders()`. Manager-gated screens check role inline against `user_roles` (not `is_admin_of_customer`, which excludes `manager`). |
| Tenancy | Every table carries `customer_id TEXT NOT NULL` — a plain string, not a foreign key; there is no `customers` table. Access comes from `user_roles(user_id, customer_id, role)`. Every query filters on `customer_id`. Routing via `?customer=XXX` or hostname. |
| Migrations | Sequentially numbered SQL in `migrations/`. **Verified: highest existing is 182, so the next free number is 183.** One migration per stage, never two. Each has a commented rollback block at the top. |
| RLS | Enabled on every new table, with an explicit manager-or-higher policy. No table ships without RLS. |
| Realtime | Board and manager screens subscribe via the pattern established in migration 138. |
| Messaging | SMS via AWS, email via Resend, both through the existing sender. Every send is logged to `shift_messages`. Tokened links follow migration 134. |
| Time | Store `TIMESTAMPTZ` in UTC. Render in hall-local time. Shift times are `TIME` (a shift belongs to a `shift_date`). |
| Money & hours | Never compute pay in the browser. Hours are derived server-side and are the single source of truth. |

### Production safety — there is no staging

**Confirmed: migrations run straight against the live Supabase project.** There is no staging
environment, and the halls run **nine sessions a week across both halls, every day of the week**
(Mon SC, Tue–Thu RWC, Fri SC, Sat afternoon + evening SC, Sun afternoon + evening SC). That means
a bad migration doesn't wait politely for Monday — it can land in the middle of a live session
with money moving through the POS.

These rules are not optional, and they override convenience in every stage:

1. **Additive only.** `CREATE TABLE`, `ADD COLUMN … DEFAULT`, `CREATE INDEX`. Never `DROP COLUMN`,
   never `ALTER COLUMN … TYPE`, never rename, on any table the live app reads. If a column must
   change shape, do it in three separate releases: add the new column → backfill and dual-write →
   stop reading the old one → drop it in a much later, separate migration.
2. **New tables are free; existing tables are dangerous.** Almost everything in this plan is a new
   table, which is why the plan is shaped the way it is. The handful of stages that touch existing
   tables (`staff`, `shift_assignments`) only ever add nullable columns.
3. **Run in the safe window.** Sessions start around 6:30 PM daily, with weekend afternoon sessions
   from 1:00 PM. The reliable window is **weekday mornings — Monday to Friday, before noon.**
   Never migrate on a Saturday or Sunday.
4. **Snapshot immediately before.** Take a Supabase backup/point-in-time marker before every
   migration, and note the timestamp in the commit message. This is the actual rollback for
   anything that goes wrong in a way the down-migration doesn't cover.
5. **Rehearse the rollback first.** Run up → down → up on a scratch copy of the schema *before*
   running up on production. A rollback you have never executed is a wish, not a plan.
6. **One migration per deploy.** Never batch two stages' migrations into one push. If something
   breaks you want to know exactly which change did it.
7. **Index creation on any table with real volume uses `CONCURRENTLY`** so it doesn't take a lock.

**Worth doing before B1 (the first migration):** a second Supabase project, or Supabase's branching
if the plan allows it, costs little and removes most of this risk. It is not a blocker — the rules
above are sufficient — but every stage gets cheaper and less frightening if migrations can be
tested somewhere that isn't the business.

### Definition of Done — applies to every stage, no exceptions

A stage is done when **all** of these are true:

1. The stage's own acceptance checks pass.
2. It works in **both** the live tenant and the **demo tenant** (see §2).
3. RLS is on for any new table, and a non-manager cannot read or write it.
4. Nothing regressed: the existing scheduler (v0.3.0 shift invite/accept flow) still works end to end.
5. The migration has a **rehearsed** rollback — run up → down → up on a scratch schema *before*
   it touched production, and a backup timestamp is recorded in the commit message.
6. The migration ran in the safe window (weekday morning), not during or near a session.
7. No secret, key, or token is in client-side code.
8. `SCHEDULER-DESIGN-V2.md` is updated if the stage changed a design decision.

---

## 2. Demo mode — decided up front, built into the spine

**Decision: demo mode is a real tenant, not a mock layer.**

`customer_id = 'demo'` is a full, seeded organisation sitting alongside the real halls. It has its
own staff, roles, schedules, shifts, pets and break policy. Demo mode does not fork the code path;
it *is* the code path, pointed at demo data.

Why this and not a `DEMO=true` flag with fixtures:

- A mocked demo drifts from reality the moment a real feature changes, and you find out during a
  demo. Same-code-path demo can't drift — if the demo is broken, production is broken.
- Every stage gets free end-to-end coverage. Seeding demo data for a feature *is* testing it.
- You can hand someone a demo login and let them click without any risk to real data.
- No dead code shipping to production.

What demo mode adds on top of the normal app, and **only** when `customer_id = 'demo'`:

| Capability | Behaviour |
|---|---|
| Demo control bar | A fixed panel with scripted triggers (fire a break alert, start a chase, clock someone in, jump the clock). Hidden entirely for any other tenant. |
| Time machine | Demo tenant may run a clock offset so a "session night" can be replayed on demand. Real tenants always use wall-clock. |
| Outbound send guard | **Texts and emails are never actually sent for the demo tenant.** They are written to `shift_messages` with `channel='demo'` and rendered in a fake inbox. This is a hard gate at the sender, not a UI choice. |
| Gusto guard | Demo never calls the Gusto API. Sync writes a simulated response. |
| Reseed | One button restores the demo tenant to a known state. |

**Rule enforced from Stage 1:** any code that sends a message, charges, or calls a third party must
check the demo guard *at the point of the side effect* — not at the caller. A demo tenant must be
structurally incapable of texting a real person.

---

## 3. Build order at a glance

```
A  Foundations & demo spine      A1 – A7      the ground everything stands on
B  Roles & headcount             B1 – B6      includes capability + deputies
C  Availability                  C1 – C2      binary; no migration needed
D  Slotting & hours              D1 – D5
E  Booking & messaging           E1 – E4
F  Swaps                         F1 – F4
G  Characters (pets/monsters)    G1 – G5
H  Time clock                    H1 – H5
I  Break engine                  I1 – I7      the hard part; smallest stages
J  Break board                   J1 – J6
K  Payroll & Gusto               K1 – K5
L  Hardening & launch            L1 – L5
```

Ship boundaries — points where you could stop and still have something useful in the hall:

- **After D** the manager can build and see a schedule. Replaces the spreadsheet.
- **After F** staff self-serve bookings and swaps. Replaces the phone calls.
- **After H** you have real hours. Replaces the paper time sheet.
- **After J** the hall runs on the board.
- **After K** payroll stops being manual.

---

## A — Foundations & demo spine

### A0. Schema discovery  *(read-only, no changes)*
**Goal.** Find out the real shape of `schedules` and `user_roles` before writing anything to them.
**Depends on.** Nothing.
**Why this exists.** `halls` and `staff` are defined in `database-schema-complete.sql` and are
known. **`schedules` and `user_roles` are not defined anywhere in the repo** — they predate it or
were created directly in Supabase. With migrations going straight to production, writing INSERTs
against a table whose shape is a guess is exactly the risk the safety rules exist to prevent.
**Files.** `A0-discover-schema.sql` — catalog queries only. No writes, no locks, no customer data.
**Acceptance.** The output names every column, constraint and check on those four tables, and
confirms which `customer_id` values already exist so `demo` cannot collide with a real one.
**Rollback.** None needed; it changes nothing.

### A1. Create the demo tenant
**Goal.** `customer_id = 'demo'` exists as a tenant and can be routed to.
**Depends on.** Nothing.
**DB.** *Verified against the repo:* there is **no `customers` table**. Tenancy is just a
`customer_id TEXT` string carried on every row, with access granted by rows in `user_roles
(user_id, customer_id, role)` where role ∈ `owner|admin|manager|staff`. So "creating a tenant"
means: pick the string `demo`, insert at least one `halls` row for it, and grant yourself a
`user_roles` row with role `manager` on `demo`. No schema change.
**Files.** `A1-demo-tenant.sql`.
**Note — a trap found during discovery.** `staff.role` has a CHECK constraint limiting it to
`admin | manager | staff | floor_runner | caller`. That column is a **permission** role and is a
different thing from `sched_roles` (the job someone does on a session). Do not try to store
"Session Staff" or "Flash Manager" in `staff.role`; it will fail the constraint, and widening that
constraint would be a destructive change to a live table for no benefit. The two concepts stay
separate.
**Acceptance.**
- `sched/app.html?customer=demo` loads without error and shows an empty scheduler.
- A user with a `user_roles` row for `demo` sees it; a user without one is denied.
- Real tenants are unaffected — open the live customer and confirm it is unchanged.
**Rollback.** Delete the demo `user_roles` and `halls` rows.

### A2. Demo guard helper (server-side)
**Goal.** One function that every side-effecting path will consult.
**Depends on.** A1.
**Files.** New `sched/js/demo-guard.js` (client hints only) + the server/edge helper where sends originate.
**Detail.** `isDemo(customer_id) => customer_id === 'demo'`. Export from a single module. No caller
may re-implement this check.
**Acceptance.**
- Unit test: `isDemo('demo') === true`, `isDemo('vanguard') === false`.
- Grep the repo: exactly one definition of the demo check exists.
**Rollback.** Delete the file.

### A3. Demo control bar shell
**Goal.** An empty, styled demo panel that appears only for the demo tenant.
**Depends on.** A1, A2.
**Files.** `sched/js/demo-bar.js`, styles in the sched stylesheet.
**Acceptance.**
- Panel renders on `?customer=demo`; contains a single non-functional "Reseed" button.
- Panel is absent from the DOM entirely (not merely hidden) on any other tenant. Verify with devtools.
**Rollback.** Remove the include.

### A4. Seed script skeleton
**Goal.** One idempotent script that builds the demo tenant from nothing.
**Depends on.** A1.
**Files.** `migrations/seed-demo-scheduler.sql` (or a script under `scripts/`).
**Detail.** Running it twice must leave the same state as running it once. Start with staff only.
Seed a **wider manager pool than the three named characters** — Shelly, Rachel and Sagit are the
ones with characters so far, but there are more managers in reality, so seed at least five so that
"every Bingo Manager is off tonight" is a situation the demo can actually show. Workers: around a
dozen, enough that a Friday needs choosing rather than just taking everyone.
**Both halls from day one:** seed **two** halls (Redwood City and Santa Clara) for the demo tenant,
with some staff working only one hall and at least one person who works both. Multi-hall bugs —
a query missing its `hall_id` filter, coverage counted across halls instead of per hall — surface
immediately rather than after the system has been trusted.
**Acceptance.**
- Run twice; row counts identical, no duplicate-key errors.
- Demo staff appear in the existing Workers tab.
- Two halls exist for `demo`, and the hall selector switches between them.
**Rollback.** Truncate demo rows by `customer_id='demo'`.

### A5. Reseed button wired
**Goal.** The Reseed button actually restores demo state.
**Depends on.** A3, A4.
**Acceptance.**
- Delete a demo staff row by hand, hit Reseed, row returns.
- Reseed on a non-demo tenant is impossible — the endpoint rejects it server-side, not just in UI.
**Rollback.** Unwire the button.

### A6. Character art into storage
**Goal.** The 60 pets + 6 characters are served from Supabase storage, not embedded.
**Depends on.** Nothing.
**Files.** Upload `pets/` and `monsters/` from the working folder.
**Detail.** Public read bucket, path `characters/{id}-{pose}.png`. Keep the trimmed, right-facing
normalised versions — do not re-upload the originals, half of them face the wrong way.
**Acceptance.**
- All 132 files load by URL in a browser.
- Every `-walk` sprite faces right. Spot-check ten.
**Rollback.** Delete the bucket folder.

### A7. Minimal test harness
**Goal.** A way to run unit tests at all.
**Depends on.** Nothing.
**Why this is a stage.** *Verified against the repo:* there is currently **no automated test
framework** — no test runner, no `*.test.js`, and CI only deploys. Phases I and K lean on unit
tests as their primary safeguard, and those tests cannot exist until something can run them.
Building the break planner without a test runner would throw away the main reason it's specced as
a pure function.
**Files.** `package.json` test script + one runner (node's built-in `node:test` is enough — no new
dependency needed on Node 24, which is what the repo's tooling already runs).
**Detail.** Keep it deliberately small: a `tests/` folder, one runner, no mocking library, no DOM.
These tests only ever cover pure functions — planner maths, hours maths, overtime classification.
Nothing that touches Supabase.
**Acceptance.**
- `npm test` runs and passes with one trivial placeholder test.
- A deliberately failing test makes `npm test` exit non-zero (check this — a runner that always
  exits 0 is worse than no runner).
- Optionally wired into CI, but not required to block a deploy yet.
**Rollback.** Remove the script and folder.

---

## B — Roles & headcount

### B1. `sched_roles` table + seed
**Goal.** Roles exist as data.
**DB.** Migration 183. Table per design doc, plus `fixed_count INTEGER` and `min_on_floor`.
Seed the five roles for each real tenant and for demo: Bingo Manager (fixed 1), Paymaster (fixed 1),
Flash Manager (fixed 1), Flash Runner (min 2), Session Staff (min 2).
**Acceptance.**
- Five roles per tenant. RLS on. Manager can select; anon cannot.
- Rollback runs clean.
- Roles resolve correctly at **both** halls — a role is per tenant, not per hall, but every screen
  that uses one must still filter shifts by `hall_id`.

### B2. Roles admin screen (read-only)
**Goal.** Manager can *see* the roles table in the app.
**Depends on.** B1.
**Acceptance.** Roles tab lists five roles with counts and minimums for the current tenant. No editing yet.

### B3. Roles admin screen (editable)
**Goal.** Manager can add, rename, deactivate, and change `min_on_floor`.
**Depends on.** B2.
**Acceptance.**
- Rename persists and reloads correctly.
- Deactivating a role hides it from future slotting but does not break existing shifts referencing it.
- A role with `fixed_count = 1` renders as "always 1" with no editable count.

### B4. `shift_role_requirements` + headcount step
**Goal.** A shift stores how many of each role it needs; the manager sets the variable ones.
**Depends on.** B1.
**DB.** Migration 184. Plus trigger keeping `scheduled_shifts.spots_needed` as the derived sum.
**Acceptance.**
- Fixed roles render locked at 1 with no stepper.
- Variable roles have −/+ steppers, floored at their `min_on_floor`; the floor cannot be violated.
- `spots_needed` updates automatically; existing V1 reads of that column still work.
- Reload the page: counts persist.

### B5. Staff role capability + deputies
**Goal.** The system knows who is qualified for which role, and who can act as cover.
**Depends on.** B1.
**DB.** Migration 185 (new table — additive, safe).

```sql
CREATE TABLE staff_role_capability (
  customer_id TEXT NOT NULL,
  staff_id    UUID NOT NULL REFERENCES staff(id)        ON DELETE CASCADE,
  role_id     UUID NOT NULL REFERENCES sched_roles(id)  ON DELETE CASCADE,
  can_do      BOOLEAN NOT NULL DEFAULT false,  -- trained and normally does this job
  is_deputy   BOOLEAN NOT NULL DEFAULT false,  -- can step up to cover it when needed
  updated_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_id, role_id)
);
```

**Capability is ADVISORY, not a filter.** Everyone available is still offered for every role. What
capability changes is only whether slotting them shows a caution. This is deliberate: on a
short-staffed night the manager must be able to put a body in a chair, and software that refuses
is software she works around. It flags, it does not block.

- `can_do = true` → no flag. This is one of their normal jobs.
- `is_deputy = true` → no flag. Approved cover, e.g. a senior person trusted to act as Bingo
  Manager when all three managers are off.
- Neither → the slot shows **"not trained for this role"** and the manager can proceed anyway.

**Seeding.** Backfill `can_do = true` for each staff member's current role so nothing is worse off
on day one. Flag at least two deputies for Bingo Manager in the demo tenant so the "everyone's off
tonight" scenario can be demonstrated.

**Acceptance.**
- RLS on; manager-or-higher can read and write, staff cannot.
- Every existing staff member has `can_do = true` for the role they already work.
- Rollback drops the table cleanly and slotting still works without it.

### B6. Capability admin screen
**Goal.** Manager maintains the matrix.
**Depends on.** B5.
**Acceptance.**
- Grid of staff × roles, each cell cycling: not trained → can do → deputy.
- Changes persist; reload confirms.
- Deputy cells are visually distinct from can-do cells.
- Works for both halls' staff in one view.

---

## C — Availability

**Decided: availability is binary.** A person either works a given recurring slot or they don't.
There is no "sometimes". This removes a migration, a third UI state, and an amber path through
every screen that touches staffing.

**This means no schema change at all.** `shift_eligibility` already carries two booleans —
`eligible` (manager-driven: may this person be offered this slot) and `default_available`
(worker-driven: does this person work this slot). Binary availability is what that table was
built for. Phase C is therefore two UI stages and zero migrations.

### C1. Availability grid
**Goal.** Manager sees and toggles a staff × recurring-schedule grid.
**Depends on.** A1.
**DB.** None. Reads and writes `shift_eligibility.default_available`.
**Acceptance.**
- Grid lists every active staff member against every recurring schedule, for both halls.
- Clicking a cell toggles available ⇄ unavailable and persists; reload confirms.
- A cell for a schedule at a hall the person never works is still togglable — the manager decides,
  the system doesn't guess.
- Demo tenant is pre-seeded with a realistic spread across both halls.

### C2. Texted availability request
**Goal.** Staff set their own availability from a link, without a login.
**Depends on.** C1, and the existing token flow from migration 134.
**Acceptance.**
- Manager sends a request; a row lands in `shift_messages` per recipient.
- **Demo tenant sends nothing** — logged with `channel='demo'` and shown in the fake inbox.
- The tokened link opens a page listing each recurring schedule per hall with a yes/no toggle,
  and works without creating an account.
- A staff member's own answer overwrites the manager's guess, and the manager can see it changed.

## D — Slotting & hours

### D1. Slot generation from headcount
**Goal.** Step 2 renders exactly as many empty slots as step 1 asked for.
**Depends on.** B4.
**Acceptance.** Change a count, slots appear/disappear immediately; lowering a count releases anyone
already in the removed slot.

### D2. Eligible-staff dropdowns
**Goal.** Slot dropdowns only offer people who can work that night.
**Depends on.** C1, D1.
**Depends on.** C1, D1, **B5**.
**Decided:** eligibility is **availability only**. Capability is advisory — everyone available is
offered for every role, and someone without `can_do` or `is_deputy` simply carries a
"not trained for this role" caution on the slot. It never blocks. A schedule that cannot be built
is worse than a schedule with a warning on it.
**Decided:** **availability is binary.** No "sometimes", no amber, no provisional state. A person
is offered for a shift or they are not.
**Acceptance.**
- Everyone available that night is offered for every role — no capability filtering.
- Trained people and approved deputies slot with no caution.
- Anyone else slots with a visible "not trained for this role" caution, and **the save succeeds**.
- Someone already slotted elsewhere in the same shift does not appear in other dropdowns.
- No third availability state appears anywhere — grep the diff for "sometimes" and find nothing.

### D3. Persist assignments with roles
**Goal.** Slotting writes `shift_assignments` with `role_id` and status `booked`.
**Depends on.** D2.
**DB.** Migration 186 — add `role_id` and the `booked`/`swap_pending` statuses to the check constraint.
**Acceptance.** Reload restores the schedule exactly. V1 statuses still valid.

### D4. Per-assignment hours
**Goal.** Step 3 — every filled slot has an editable start and end.
**Depends on.** D3.
**DB.** Migration 187 — `starts_at`/`ends_at` on assignments, `default_start`/`default_end` on roles.
**Acceptance.**
- Times default from the role and persist per person.
- Edited rows are visually marked.
- Total scheduled hours displays and is correct for an overnight shift (crossing midnight).

### D5. Hours bulk actions
**Goal.** The four shortcuts.
**Depends on.** D4.
**Acceptance.** Apply-to-role, everyone-on-session-hours, everyone-30-min-later, reset-to-defaults —
each works and persists. Midnight crossing still correct after "30 minutes later".

---

## E — Booking & messaging

### E1. Booking message template
**Goal.** A template with placeholders for name, role, date, hall, and **that person's own hours**.
**Depends on.** D4, existing template table (135).
**Acceptance.** Rendering the template for a real assignment produces correct text with no `{{}}` left.

### E2. Send booking texts
**Goal.** The button sends, logs, and reports.
**Depends on.** E1, A2.
**Acceptance.**
- Sends to each booked person; a row per send in `shift_messages`.
- **Demo sends nothing.** Verified by attempting a demo send and confirming no provider call — check
  the provider dashboard shows zero, not just that the UI said "sent".
- Re-send offered only to people who have not responded.

### E3. Booking acknowledgement page
**Goal.** The tokened link shows the shift and a "Got it" action.
**Acceptance.** Works without login; acknowledgement is visible to the manager.

### E4. Staff "my shifts" list
**Goal.** A logged-in staff member sees their upcoming shifts with status.
**Acceptance.** Shows booked, swap-pending, and past shifts correctly for the signed-in user only.

---

## F — Swaps

### F1. `shift_swaps` table
**DB.** Migration 188. Per design doc, with the one-live-swap-per-booking constraint.
**Acceptance.** RLS on; a staff member can see only their own swaps.

### F2. Request-a-replacement screen
**Goal.** Staff names a replacement from the org's staff list.
**Depends on.** F1.
**Acceptance.**
- Cannot submit without naming someone.
- Original assignment stays `booked`; a `swap_pending` row is created.
- The shift never displays as unstaffed at any point in this flow.

### F3. Replacement confirm RPC
**Goal.** One atomic transaction moves the shift.
**Depends on.** F2.
**Detail.** Model on `respond_to_shift()`. Accept → swap accepted, original released, new assignment
booked with the **same `role_id` and the same hours**. Decline → original stays booked.
**Acceptance.**
- Accept and decline both produce the correct end state.
- Run the accept twice (double-tap the link): the second is a no-op, not a duplicate assignment.
- Both parties and the manager get a confirmation message (logged; not sent in demo).

### F4. Manager swap view
**Goal.** Pending swaps visible and force-resolvable.
**Acceptance.** Manager can force either outcome; result matches what the RPC would have done.

---

## G — Characters

### G1. `pets` table + library import
**DB.** Migration 189. `id, kind ('cat'|'dog'|'boss'), min_tier, walk_path, sit_path, active`.
Import all 66 with correct tiers: cat 0, dog 1, boss 2.
**Acceptance.** 66 rows; every path resolves to a real file in storage (test every one, not a sample).

### G2. Staff tier + pet claim column
**DB.** Migration 190. `staff.tier`, `staff.pet_id`, and the partial unique index on
`(customer_id, pet_id)`.
**Acceptance.**
- Two staff cannot hold the same pet — prove it by attempting the insert directly in SQL and
  watching it fail on the constraint, not on app logic.
- `tier` derives correctly from role for existing staff.

### G3. Pet picker page (phone)
**Goal.** The staff-facing picker.
**Depends on.** G1, G2.
**Acceptance.**
- Renders three-across on a 390px viewport with tappable targets.
- Locked species show a padlock and cannot be selected.
- Taken pets show the owner's name and cannot be selected.

### G4. Claim flow with race handling
**Goal.** Claiming writes `staff.pet_id`; losing a race is handled gracefully.
**Depends on.** G3.
**Acceptance.**
- Claim persists and releases any previous pet.
- Simulate a race (two sessions claim simultaneously): one succeeds, the other gets
  "just taken, pick another" — no 500, no duplicate.

### G5. Character art in the manager UI
**Goal.** Slot rows and rosters show the person's character.
**Acceptance.** Every screen showing a person shows their character; staff with no pet get a neutral
placeholder, never a broken image.

---

## H — Time clock

### H1. `time_entries` table
**DB.** Migration 191.
**Acceptance.** RLS on; kiosk token can insert, cannot read other tenants.

### H2. Kiosk auth for the clock page
**Goal.** `sched/clock.html` authenticates as a device, not a user.
**Depends on.** H1, existing kiosk pattern (130).
**Acceptance.** Page works with a kiosk token and no user session; without a token it refuses.

### H3. PIN storage and set-up
**Goal.** Staff have a hashed PIN.
**DB.** Migration 192 — `staff.pin_hash`.
**Detail.** Hash server-side. **A raw PIN must never be stored, logged, or sent to the client.**
**Acceptance.**
- Manager can trigger a PIN reset; first check-in prompts the worker to choose one.
- Grep confirms no plaintext PIN in logs or client code.

### H4. Clock in / clock out
**Goal.** Tap name → PIN → on the clock.
**Depends on.** H2, H3.
**Acceptance.**
- Correct PIN clocks in; wrong PIN does not, and does not reveal which part was wrong.
- Clock-out closes the entry.
- Auto-close fires for anyone still clocked in N hours after shift end, and flags the entry.

### H5. Walk-ups and approval
**Goal.** Someone not on the schedule can start work.
**Acceptance.**
- Walk-up picks a role and is clocked in immediately with `approval='pending'`.
- The clock runs from the tap, **not** from the approval — verify the recorded start time.
- Manager approves from their own screen; the entry flips to approved.

---

## I — Break engine

The riskiest area. Stages here are the smallest in the plan on purpose. **Build the engine as a
pure function first and test it in isolation before any of it touches the UI.**

### I1. `break_policies` table + defaults
**DB.** Migration 193. All the columns from the design doc including `meal_is_paid` (default false),
`warn_lead_minutes` (5) and `warn_show_seconds` (60).
**Acceptance.** One row per tenant with California defaults.

### I2. `break_events` table
**DB.** Migration 194. Including `paid`, `interrupted_at`, `premium_owed`.
**Acceptance.** RLS on; rollback clean.

### I3. Planner as a pure function
**Goal.** `planBreaks(shiftStart, shiftEnd, policy) → [{kind, plannedStart, deadline}]`, no I/O, no DB.
**Depends on.** I1, **A7** (there is no test runner until A7 exists).
**Acceptance — unit tests, no UI:**
- A 6-hour shift produces one meal starting before the 5-hour mark and the right number of rests.
- A 4-hour shift produces one rest and no meal.
- An 11-hour shift produces two meals.
- Nothing is scheduled inside `no_breaks_first_minutes`.
- A shift crossing midnight is handled correctly.

### I4. Coverage constraint
**Goal.** Extend the planner to respect `min_on_floor` per role across everyone on shift.
**Depends on.** I3.
**Acceptance — unit tests:**
- Three Session Staff with a minimum of 2 never have two on break simultaneously.
- **Coverage is counted per hall.** Two people at Redwood City and two at Santa Clara do not
  satisfy a minimum of 2 by being four people in total. Write this test explicitly — it is the
  multi-hall bug most likely to reach production unnoticed.
- With an impossible constraint (2 people, minimum 2, both need meals) the planner returns a
  **flagged, still-legal plan rather than silently violating the minimum or looping forever.**
  Decide and document which gives way — the design says legal deadlines win, coverage bends,
  and the manager is told.

### I5. Persist and re-plan
**Goal.** Planner output is written to `break_events`; clock-in triggers a re-plan.
**Depends on.** I3, I4, H4.
**Acceptance.**
- Clocking in creates that person's events.
- A late arrival re-plans everyone without duplicating existing events.
- Re-planning is idempotent: run it twice, same result.

### I6. Break state machine
**Goal.** `planned → due → on_break → done`, plus `postponed` and `missed`.
**Depends on.** I5.
**Acceptance.**
- Start, end, postpone, and miss transitions all work and are logged.
- Postpone re-slots inside the legal window; postponing past the deadline is refused for a worker
  and requires a manager.
- An early tap-back sets `interrupted_at`, marks the event `paid`, and sets `premium_owed`.

### I7. Paid-hours calculation
**Goal.** One server-side function: worked hours for a time entry.
**Depends on.** I6.
**Acceptance — unit tests:**
- Rests never deducted.
- A clean 30-minute meal is deducted.
- An interrupted meal is **not** deducted and flags a premium.
- A missed meal is not deducted and flags a premium.
- Overnight shift arithmetic correct.

---

## J — Break board

### J1. Board page shell with kiosk auth
**Acceptance.** `sched/board.html` loads on a TV with a kiosk token; refuses without one.

### J2. Tiles from live data
**Goal.** ON BREAK and UP NEXT read real `break_events`.
**Depends on.** I5.
**Acceptance.** Timers show whole minutes, rounded up, never 0 while time remains.

### J3. Realtime updates
**Depends on.** J2.
**Acceptance.** Someone clocking in on the iPad changes the board within a second, with no refresh.

### J4. Five-minute warning
**Depends on.** J2, I1.
**Acceptance.**
- Box turns red and blinks for the whole warning window.
- Name banner appears for exactly `warn_show_seconds`, then clears on its own.
- A due alert **immediately dismisses** any warning banner. Test this explicitly.

### J5. Due-now takeover
**Depends on.** J2.
**Acceptance.**
- Fires on `due`, stays until the iPad is tapped.
- Everything else dims and freezes.
- Meal-deadline escalation turns it red.
- Multiple simultaneous dues stack without overlapping.

### J6. Character layer
**Depends on.** G1, J3.
**Acceptance.**
- Position encodes state: floor / up-next / on-break.
- Slow ambient motion; name and role always legible; never obscures a timer.
- All characters dim and freeze during a takeover.
- Sound is opt-in per device and defaults to off.

---

## K — Payroll & Gusto

### K1. Pay-period review screen (read-only)
**Depends on.** I7.
**Acceptance.** Per person: hours by day, breaks taken/postponed/missed, unapproved walk-ups,
overtime flags, premium flags. Numbers match a hand calculation for one full demo night.

### K2. Gusto OAuth app + token storage
**Acceptance.**
- OAuth completes; tokens stored server-side only.
- No token reachable from the browser — verify by inspecting network and storage.
- **Demo tenant cannot reach this screen.**

### K3. Employee mapping
**DB.** Migration 195 — `staff.gusto_employee_uuid`.
**Acceptance.** Roster pulled from Gusto; a mapping UI resolves unmatched staff; an unmatched person
blocks only their own sync, not everyone's.

### K4. Overtime classification
**Goal.** Split hours into regular / OT / double-OT before pushing.
**Depends on.** A7.
**Acceptance — unit tests:** >8/day, >12/day, weekly, and seventh-consecutive-day cases.

### K5. Timesheet push
**Depends on.** K2, K3, K4.
**Acceptance.**
- One timesheet per shift, UTC timestamps, hours pre-classified.
- Idempotent: `gusto_timesheet_id` recorded; re-running sends nothing new.
- **Demo simulates the response and never calls Gusto.**
- Confirm in the Gusto UI that hours land as pending.

---

## L — Hardening & launch

### L1. Full demo-tenant walkthrough
**Acceptance.** The whole story runs on demo without touching a real record: availability → build →
book → swap → clock in → breaks → board → payroll.

### L2. Permission audit
**Acceptance.** For every new table, a non-manager user and an anonymous user are both denied.
Tested with actual requests, not by reading policies.

### L3. Outbound-send audit
**Acceptance.** Every send path checks the demo guard at the side effect. Deliberately attempt to
text a real number from demo and confirm it is impossible.

### L4. Failure-mode pass
**Acceptance.** Board survives network loss and reconnects. iPad survives reload mid-PIN. A shift
with nobody assigned doesn't crash the planner.

### L5. One live session, supervised
**Acceptance.** Run one real bingo night with the system alongside the current paper process, not
replacing it. Compare hours to the paper record before trusting payroll to it.

---

## Open questions to resolve before the stages that need them

**Resolved:**

| # | Question | Answer | Affects |
|---|---|---|---|
| 1 | Are meals genuinely duty-free? | **Yes** — staff are relieved of duty. Meals unpaid and deducted; rests paid. `meal_is_paid = false`. | I7 |
| 2 | Per-staff role capability matrix? | **Yes, but advisory.** Two flags per staff × role — `can_do` and `is_deputy` — used to show a "not trained" caution when slotting. It never filters or blocks. | B5, B6, D2 |
| 2c | Bingo Manager cover? | **Named deputies** — senior staff flagged `is_deputy` on Bingo Manager slot in with no caution, so a night with all three managers off is staffable and looks intentional. | B5, D2 |
| 2b | Three-level availability? | **No — binary.** Available or not. "Sometimes" is removed entirely; it needed a migration, a third UI state and an amber path, and bought nothing the manager can't judge herself. | C1, D2 |
| 3 | Which halls? | **Both Redwood City and Santa Clara from day one.** Seed and test both throughout. | A4, B1, I4 |
| 4 | Who builds it? | Stages handed to Claude Code one at a time, in the real repo. | how this doc is used |
| 5 | Build order? | **Straight through A→L.** No pulling the board forward. | everything |
| 6 | Manager cover? | **There are more managers than the three named.** Shelly, Rachel and Sagit are just the ones with characters so far. Seed a wider pool; a session always has a real Bingo Manager available. | A4, B4 |
| 7 | Staging environment? | **None — migrations go straight to production.** See Production safety above. | every migration |
| 8 | Waitlists for over-subscribed shifts? | **No — out of scope, do not build.** `SCHEDULER-MOCKUP.html` implements a full claim/release/auto-promote waitlist; it is not to be ported. Staffing is **manager-publishes**: she builds the whole schedule and puts it out, staff are told where they are and acknowledge. Nobody claims or queues for a shift. A decline therefore creates a gap *she* must fill, which is what the swap/replacement stages in F are for — that is the only path by which an assignment changes hands.

**The handoff rule (decided).** The governing invariant is that **a shift is never quietly unowned**.

- **Handoff accepted** — Rosa offers Thursday to Tina, Tina accepts. That is sufficient. The shift
  transfers immediately, no manager gate, no pending state. The manager is informed, not asked.
- **Decline with no replacement** — Rosa simply says no. The shift becomes unfilled and the manager
  is **notified straight away**, because this is the case that silently leaves a hole in the floor.
  In the user's words: *"that's kind of not fine."*

The asymmetry is the point. A solved problem needs no permission; an unsolved one must never wait
to be discovered. Building it the other way round — approving every handoff — would add friction to
the case that is already fine and add nothing to the case that isn't.

**Capability interacts with this exactly as it does everywhere else: it flags, it does not block.**
If Tina isn't trained for the role she's accepting, the transfer still completes and the manager sees
the "not trained for this role" caution on that slot. Blocking the handoff would push the swap back
into texts and phone calls, where the schedule can't see it at all.

**Confirmed by the user:** workers do sometimes hand a shift off to someone else directly, so F is a real and load-bearing part of the build rather than an edge case. Open question 9 below settles whether a handoff needs manager approval or merely notifies her. | E1–E4, F1–F4 |
| 9 | Staging environment? *(superseded)* | The scheduler now lives in its own **Operational DB** project, not the ecommerce production database. No live customers, no V1 to break — the production-safety rules above are far less binding than when written. | every migration |

**Still open:**

| # | Question | Needed by |
|---|---|---|

| 6 | Commission and premium hours into Gusto — manual on the payroll run, or API? | K5 |
| 7 | Avatar tiers cumulative or exclusive? Currently cumulative. | G3 |
| 8 | Auto-clock-out threshold — how many hours after shift end? | H4 |
| 9 | *(answered)* Shift handoff approval — see the Handoff rule below. | F2–F4 |
| 10 | How urgent is the unfilled-shift alert? Assumed: notify immediately, escalate if the session is within 48 hours. | F4 |


---

## What could go wrong

Named here so they're not surprises:

- **The break planner is the hard part.** It is a constraint problem wearing an easy disguise.
  This is why I3 and I4 are pure functions with unit tests before any UI exists. Do not skip that.
- **Overnight arithmetic.** Bingo runs past midnight. Every duration calculation in this system can
  be wrong in a way that only shows up after 12 AM. It is called out in D4, I3 and I7 deliberately.
- **Demo leaking into production.** A demo that texts a real customer is the worst failure here,
  which is why the guard sits at the side effect and gets its own audit stage (L3).
- **Payroll trust.** Do not let the first pay run be the first test. L5 exists for that reason.
- **No staging.** Every migration is a live change to the database the halls trade on, seven nights
  a week. The additive-only rule and the weekday-morning window are what stand between this build
  and an outage during a session. They are the least negotiable thing in this document.
- **Scope creep through charm.** The characters are the fun part and will attract "just one more"
  ideas. They are Phase G and J6 for a reason: the hall can run without them, and cannot run
  without breaks and hours.
