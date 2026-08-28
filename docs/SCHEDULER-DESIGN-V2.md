# Scheduler V2 — Roles, Swaps, Time Clock, Breaks, Payroll

Successor to `SCHEDULER-DESIGN.md`. V1 (shipped as sched v0.3.0, migrations 133–143) covered:
staff list with comm prefs, eligibility/availability matrix, materialized shifts from recurring
schedules, invite texts (AWS SMS) / emails (Resend) with unique tokened accept/decline links,
waitlist, message templates + send log, staff self-serve dashboard, realtime.

V2 extends the same sub-app (`sched/`) and the same Supabase DB. Nothing here creates a new
backend; everything rides FGSData/FGSAuth, `?customer=` tenancy, and RLS patterns from 133.

---

## Decisions locked (owner-confirmed)

| Area | Decision |
|---|---|
| Availability | **Binary** per staff × recurring schedule: available or not. Captured once, by manager or via texted request. (An earlier three-level design with "sometimes" was dropped — see Module 1.) |
| Roles | **Manager-configurable** role list with per-shift needed counts. Current set: Bingo Manager, Paymaster, Flash Manager, Flash Runner, Session Staff. |
| Booking | Manager slots people directly → "You've been booked" text. (Invite/accept from V1 remains for when she wants to ask first.) |
| Swaps | To get out of a booking, staff must tag a named replacement who already agreed. Replacement confirms via text. **No cutoff** — swaps allowed any time before the shift. |
| Time clock | iPad kiosk at the hall. **Tap name + 4-digit PIN.** Walk-ups can check in and pick a role; pending manager approval. |
| Breaks | **California-compliant defaults**: paid 10-min rest per ~4 hrs worked, unpaid 30-min meal that must *start* before the end of the 5th hour, second 30-min meal past 10 hrs. Staggered automatically, none at shift start. |
| Break refusal | Refusal = **postpone, not skip** ("not hungry now"). Snooze re-queues the break; the engine keeps it inside the legal window and escalates as the deadline nears. Manager can approve a postpone. |
| Coverage | Stagger algorithm respects **per-role minimums** (Bingo Manager never below 1, ≥2 Session Staff and ≥2 Flash Runners on the floor). |
| Monitor | **Internal** standalone full-screen page (`sched/board.html`) on a TV in the main room. Not part of the Division-2 display rotation. |
| Payroll | Hours + breaks accumulate per person per pay period and push to **Gusto via their time-tracking API**, one timesheet per shift. |
| Walk-ups | Get a role assigned at check-in, so coverage rules and the break engine apply to them immediately. |

Assumptions where no answer was given (flag if wrong):
- **Un-confirmed replacement**: until the tagged person confirms by text, the original worker
  stays booked and on the hook. Both parties can see the pending state.
- **Flash Manager tier**: senior staff, not manager — they work the session, so they keep a
  scheduled break and pick from cats or dogs rather than a monster.

---

## Module 1 — Availability

**Availability is binary.** A person either works a given recurring slot or they don't get
offered it. There is no "sometimes".

An earlier draft had three levels — available / sometimes / unavailable — with "sometimes" shown
amber in the slotting picker. It was removed deliberately. It required a migration off the existing
boolean, a third state in every availability and slotting screen, and an amber path through the
booking flow, and in exchange it told the manager something she already knows about her own staff.
A flag that only means "be slightly less confident" is not worth a state in the data model.

**This means no schema change.** `shift_eligibility` already carries exactly the two booleans this
needs:

| Column | Meaning |
|---|---|
| `eligible` | Manager-driven — may this person be offered this recurring slot at all? |
| `default_available` | Worker-driven — does this person work this slot? |

Capture paths, unchanged from V1 except that the value set is two rather than three:

1. **Manager fills it** — the Workers tab grid, one toggle per staff × recurring schedule, across
   both halls.
2. **Texted availability request** — the invite-token flow (migration 134) sends a link to a page
   listing each recurring schedule per hall with a yes/no toggle. Works without creating a login.
   A worker's own answer overwrites the manager's guess, and the manager can see that it changed.

Slotting then offers exactly the available people, in one list, with no second tier.

## Module 2 — Roles

```sql
CREATE TABLE sched_roles (
  id UUID PK, customer_id TEXT NOT NULL,
  name TEXT NOT NULL,                 -- Bingo Manager, Paymaster, Flash Manager, Flash Runner, Session Staff
  color TEXT,                         -- for board + gantt chips
  min_on_floor INTEGER NOT NULL DEFAULT 0,   -- coverage rule: never fewer than N un-broken
  sort INTEGER, active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (customer_id, name)
);

CREATE TABLE shift_role_requirements (      -- how many of each role a shift needs
  shift_id UUID REFERENCES scheduled_shifts(id) ON DELETE CASCADE,
  role_id  UUID REFERENCES sched_roles(id) ON DELETE CASCADE,
  needed   INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (shift_id, role_id)
);

ALTER TABLE shift_assignments ADD COLUMN role_id UUID REFERENCES sched_roles(id);
```

**The role set as of 31 July 2026:**

| Role | Needed (Friday) | Min on floor | Avatar tier | Notes |
|---|---|---|---|---|
| Bingo Manager | 1 | 1 | Manager | Runs the session; approves breaks and walk-ups. Never below 1 on the floor. |
| Paymaster | 1 | 1 | Senior | Banks, payouts, cash box. |
| Flash Manager | 1 | 1 | Senior | Runs the flash operation and the runners under it. Works the session, so stays in the break rotation. |
| Flash Runner | 3 | 2 | Floor runner | Selling flash on the floor. |
| Session Staff | 3 | 2 | Senior | **Register, caller and strip cart are one role** — people rotate through all three during a night, so the planner only tracks the headcount, not which station. |

Collapsing register/caller/strip cart into one role matters for the break engine: it means coverage
is a single count of two-on-the-floor rather than three separate one-deep constraints that would
deadlock as soon as anyone took a meal.

- Roles admin screen (manager+): add/rename/deactivate, set color and `min_on_floor`.
**Staffing a session is two steps, in this order:**

1. **How many.** Bingo Manager, Paymaster and Flash Manager are structurally fixed at exactly one
   — no stepper, no decision, they render as "always 1". Flash Runner and Session Staff are the
   only counts the manager actually sets, sized to the crowd she expects (floor of 2 each, which
   is also their `min_on_floor`, so a session can never be built that the break planner can't
   then solve).
2. **Who.** Only once the counts exist does the UI generate that many empty slots to fill.
3. **What hours.** Every filled spot gets a start and end time, seeded from a per-role default
   (managers and cash in early, floor roles at doors-open) and editable on every row. Bulk
   shortcuts: apply the first row to everyone in that role, put everyone on the session's hours,
   push every end time later by 30 minutes, or drop back to the role defaults. Edited rows are
   marked so it's obvious what's been touched, and a running total of scheduled labour hours sits
   at the bottom.

```sql
ALTER TABLE shift_assignments
  ADD COLUMN starts_at TIME,   -- NULL falls back to the role default for that shift
  ADD COLUMN ends_at   TIME;
ALTER TABLE sched_roles
  ADD COLUMN default_start TIME, ADD COLUMN default_end TIME;
```

Per-person hours are not cosmetic — the break planner needs each person's own start and end to
place their rests and meal inside the legal windows, and the booking text quotes that person's
actual hours rather than the session's. Changing an end time re-solves that person's break plan.

```sql
ALTER TABLE sched_roles ADD COLUMN fixed_count INTEGER;  -- NULL = manager decides per session
-- Bingo Manager / Paymaster / Flash Manager → 1; Flash Runner / Session Staff → NULL
```

Doing headcount first is what makes the screen match how she actually thinks about a night: the
question is never "who is the paymaster and also how many paymasters" — it's "how big is this
crowd", and the three fixed roles are a given. Lowering a count after people are slotted releases
the extras rather than silently keeping over-staffed rows.

- Templates remember role counts: when a shift is materialized from a recurring schedule,
  copy the previous same-weekday shift's `shift_role_requirements` as the default (mirrors the
  V1 "offer previous same-weekday counts" behavior, now per role) — so "same as last Friday"
  restores both the headcount and the people.
- `spots_needed` on `scheduled_shifts` becomes the derived sum of role requirements
  (kept in sync by trigger; existing UI reads keep working).
### Who can do what — capability and deputies

Slotting is gated on **availability AND capability**, not availability alone.

```sql
CREATE TABLE staff_role_capability (
  customer_id TEXT NOT NULL,
  staff_id    UUID NOT NULL REFERENCES staff(id)       ON DELETE CASCADE,
  role_id     UUID NOT NULL REFERENCES sched_roles(id) ON DELETE CASCADE,
  can_do      BOOLEAN NOT NULL DEFAULT false,   -- one of their normal jobs
  is_deputy   BOOLEAN NOT NULL DEFAULT false,   -- can step up to cover it
  PRIMARY KEY (staff_id, role_id)
);
```

**Capability flags, it does not block.** Every available person is still offered for every role.
Capability only decides whether the slot shows a caution:

| State | Slotting behaviour |
|---|---|
| `can_do` | No caution — one of their normal jobs. |
| `is_deputy` | No caution — approved cover, e.g. trusted to act as Bingo Manager. |
| Neither | **"Not trained for this role"** caution, and the manager can proceed anyway. |

This is the important design decision in this section. A system that refuses to let a manager put
a body in a chair on a short-staffed Tuesday is a system she stops using — she'll build the
schedule on paper and type it in afterwards, and then the data is wrong in a way nobody sees.
Flagging keeps the information without taking away her authority.

Two flags rather than one, because "this is their job" and "they can cover it in a pinch" are
genuinely different, and a night with every Bingo Manager off is still staffable by a named
deputy without it looking like a mistake.

Backfill `can_do = true` for each person's existing role so nobody is worse off on day one.

## Module 3 — Booking + replacement (swap) flow

New assignment statuses on top of 133's set:

```
invited → confirmed            (V1 ask-first flow, unchanged)
booked                          -- manager slotted directly; "you've been booked" text sent
booked → swap_pending           -- worker tagged a replacement
swap_pending → booked(new)      -- replacement confirmed via text; old row → released(swap)
swap_pending → booked(orig)     -- replacement declined; original still on the hook, may tag another
```

```sql
CREATE TABLE shift_swaps (
  id UUID PK, customer_id TEXT NOT NULL,
  shift_id UUID NOT NULL REFERENCES scheduled_shifts(id) ON DELETE CASCADE,
  from_staff_id UUID NOT NULL REFERENCES staff(id),
  to_staff_id   UUID NOT NULL REFERENCES staff(id),   -- "Johnny"
  status TEXT NOT NULL DEFAULT 'pending'
     CHECK (status IN ('pending','accepted','declined','cancelled')),
  role_id UUID REFERENCES sched_roles(id),            -- carries the role across
  requested_at TIMESTAMPTZ DEFAULT now(), responded_at TIMESTAMPTZ,
  UNIQUE (shift_id, from_staff_id) DEFERRABLE         -- one live swap per booking
);
```

Flow:
1. Worker opens their booking (from the booking text's link or `me.html`) → "Can't make it?" →
   picks a replacement from the org's staff list ("Johnny's agreed to replace me").
2. Johnny gets a text (new message template, same tokened-link machinery as 134/135):
   *"[Name] asked you to cover their [role] shift [date/time] at [hall]. Tap to accept/decline."*
3. Accept → one RPC (modeled on `respond_to_shift()`) atomically: swap → accepted, original
   assignment → `released`, new assignment `booked` with same `role_id`. Both parties + manager
   get confirmation texts; board and manager UI update via realtime (138).
4. Decline → original stays `booked`; worker can tag someone else. No cutoff at any point.
5. Manager view shows pending swaps and can force-resolve either way.

All swap texts land in the existing `shift_messages` log, so the portal message history stays
the single audit trail.

## Module 4 — Time clock (iPad kiosk)

New page `sched/clock.html`, full-screen PWA (manifest + service worker already exist for the
sub-app), designed for a mounted iPad. Kiosk auth follows the existing kiosk-unit pattern
(migration 130) — the device holds a kiosk token; workers do NOT log in.

- **Check-in**: roster grid of today's booked staff (photo/initials + name), tap name → 4-digit
  PIN pad. PIN stored as a hash on `staff` (new column `pin_hash`); manager sets/resets in the
  Workers tab; first-ever check-in prompts the worker to choose their PIN.
- **Walk-up**: "I'm not on the list" → full staff roster → PIN → pick role → clocked in with
  `approval = pending`; manager approves from her phone/portal (one tap, realtime badge).
  Approval does not block the clock — time counts from the tap; an unapproved entry is flagged
  at payroll review.
- **Check-out**: tap name + PIN again. Auto-checkout + flag if someone is still clocked in
  N hours after shift end (config, default 2h).

```sql
CREATE TABLE time_entries (
  id UUID PK, customer_id TEXT NOT NULL,
  staff_id UUID NOT NULL REFERENCES staff(id),
  shift_id UUID REFERENCES scheduled_shifts(id),      -- NULL possible for walk-up w/o shift
  role_id  UUID REFERENCES sched_roles(id),
  clock_in TIMESTAMPTZ NOT NULL, clock_out TIMESTAMPTZ,
  source TEXT NOT NULL DEFAULT 'kiosk' CHECK (source IN ('kiosk','manager')),
  approval TEXT NOT NULL DEFAULT 'auto'
     CHECK (approval IN ('auto','pending','approved','rejected')),  -- walk-ups start pending
  approved_by UUID REFERENCES auth.users(id), notes TEXT
);
```

Clock-in is the event that activates the break engine for that worker.

## Module 5 — Break engine

### Policy (California defaults, encoded as config not code)

```sql
CREATE TABLE break_policies (         -- one active row per customer; editable later
  customer_id TEXT PK,
  rest_minutes INTEGER DEFAULT 10,          -- ALWAYS PAID, on the clock — never deducted
  rest_per_hours NUMERIC DEFAULT 4,         -- one 10-min rest per 4 hrs worked (or major fraction)
  meal_minutes INTEGER DEFAULT 30,
  meal_is_paid BOOLEAN DEFAULT false,       -- false = duty-free/unpaid; true = on-duty/paid
  meal_deadline_hours NUMERIC DEFAULT 5,    -- meal must START before end of 5th hour
  second_meal_after_hours NUMERIC DEFAULT 10,
  no_breaks_first_minutes INTEGER DEFAULT 90, -- "not right away"
  premium_hours_on_violation NUMERIC DEFAULT 1  -- extra hour owed per violation day
);
```

### Paid vs unpaid — the rule this system has to get right

- **10-minute rests are always paid.** They stay on the clock and are never deducted. Not
  configurable, because the law isn't.
- **A 30-minute meal is unpaid only when it is a genuine off-duty meal period** — the worker is
  relieved of *all* duty and free to leave the premises. If they must stay on site, stay reachable,
  keep an eye on a register or a cash box, or get pulled back mid-meal, it is an **on-duty meal
  period and must be paid** as hours worked. (On-duty meals are only permitted in limited
  circumstances and require a written agreement with the employee.)
- **Missed, late, short or interrupted meal → premium.** The employer owes one additional hour of
  pay at the regular rate for a day with a meal violation, and a separate additional hour for a day
  with a rest violation.

**Frontier's practice (confirmed):** staff are relieved of duty for their meal, so the standard
treatment applies — the 30 minutes come out of paid hours, and rests stay on the clock. That is what
the defaults above encode.

The engine still must not *hard-code* "meal = unpaid", because the exception shows up on real
nights: a paymaster who can't walk away from the cash box, or the last session-staff member called
back to a register mid-meal, was not relieved of duty for that period. Deducting that half hour
would be a wage error, not a rounding one.

```sql
ALTER TABLE break_events
  ADD COLUMN paid BOOLEAN NOT NULL DEFAULT false,   -- resolved per event, not assumed
  ADD COLUMN interrupted_at TIMESTAMPTZ,            -- tapped back early / called back
  ADD COLUMN premium_owed BOOLEAN NOT NULL DEFAULT false;
```

Resolution rules the engine applies when computing payable hours:
1. `kind = 'rest10'` → always `paid = true`.
2. `kind = 'meal30'` and the worker was relieved and it ran its full length → `paid = false`,
   deduct 30 minutes.
3. Meal **interrupted** before 30 minutes, or started after the legal deadline, or never taken →
   `paid = true` (nothing deducted) **and** `premium_owed = true`.
4. If the hall runs on-duty meals for a role by written agreement (`meal_is_paid = true`) → the
   meal is paid and never deducted for that role.

The iPad's "I'm back" tap is what distinguishes case 2 from case 3: an early tap-back, or a manager
pulling someone off break, records `interrupted_at` and flips the event to paid + premium. That
flag then surfaces on the pay-period review screen, so a missed meal is a visible line item rather
than a silent under-payment.

*Not legal advice — have payroll or employment counsel confirm the policy values and the on-duty
meal agreements before go-live. The design goal here is that the system can represent either
answer, and defaults to the safer one when a meal is disturbed.*

### Planner (the Gantt)

On clock-in, the engine builds/rebuilds the day's **break plan** for everyone currently on the
clock — a set of `break_events` with planned start times:

- One 10-min rest per `rest_per_hours` block, placed near the middle of each work block where
  practicable; first one never before `no_breaks_first_minutes`.
- One 30-min meal placed so it *starts* comfortably before the `meal_deadline_hours` mark
  (target ~4.0–4.5 hrs in), second meal planned automatically when projected hours > 10.
- **Stagger constraint**: at any minute, for each role, (workers on floor − on break) ≥
  `sched_roles.min_on_floor`; globally, spread starts so breaks don't cluster.
  Greedy interval scheduler is enough at this staff count (~5–20/night); no solver needed.
- Re-planned on every event that changes the picture: late arrival, walk-up, postpone, swap,
  early checkout. Plans are advisory until a break actually starts; actuals are what payroll sees.

```sql
CREATE TABLE break_events (
  id UUID PK, customer_id TEXT NOT NULL,
  time_entry_id UUID NOT NULL REFERENCES time_entries(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('rest10','meal30')),
  planned_start TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ, ended_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'planned'
     CHECK (status IN ('planned','due','on_break','done','postponed','missed')),
  postpone_count INTEGER NOT NULL DEFAULT 0,
  postponed_by TEXT CHECK (postponed_by IN ('worker','manager')),
  deadline TIMESTAMPTZ                    -- legal latest start (meals); NULL for rests
);
```

### Postpone ("not hungry now"), not skip

- When a break goes `due`, the worker either taps **Start break** on the iPad, or taps
  **Postpone** → engine re-slots it later, still honoring coverage and — for meals — the legal
  `deadline`. Manager approval recorded on the postpone.
- As a meal's deadline approaches (default: 45 min out) the board escalates and postpone
  requires the manager, not just the worker. If the deadline passes anyway, the event is marked
  `missed` and flagged on the payroll review screen (CA missed-meal = premium-pay exposure;
  surfacing it is the system's job, paying it is payroll's).
- Break end: worker taps "I'm back" (rest) — meals auto-complete at 30 min with a tap-to-confirm.
  Meal time is subtracted from paid hours; rests are not.

## Module 6 — Break board (`sched/board.html`)

Internal full-screen page on the main-room TV. Kiosk-token auth like the clock; realtime
subscription (138) so it never needs a refresh. Three zones, every entry with a live timer.
**Timers display whole minutes only** ("26 min", "in 4 min") — seconds tick too fast to read
across a hall and make a calm board look frantic. Values round up so a timer never reads 0
while time remains.

1. **ON BREAK now** — name, role chip, minutes until due back.
2. **UP NEXT** — next 3–5 planned breaks, each with minutes until its planned start.
3. **Five-minute warning** — when a break enters its last five minutes before due, that person's
   UP NEXT box turns **red and blinks** for the whole five minutes, and their **name flashes across
   the top of the board for one minute** ("JOHNNY — 10-MIN BREAK IN 5 MINUTES — HEAD TO THE BREAK
   ROOM"), with a soft chime. The point is lead time: someone on the far side of the hall can start
   wrapping up and walking rather than being surprised when the alert lands. The banner clears
   itself after a minute; the red blinking box persists until the break is actually due.
4. **DUE-NOW takeover** — when a break flips to `due`, that person's name goes huge
   ("MARIA — 30 MIN BREAK NOW") and *stays* until they tap Start (or Postpone) on the iPad.
   Multiple dues stack; meal-deadline escalation turns the tile red.

Precedence is strict: a due alert supersedes a warning. If someone's break comes due while another
person's five-minute banner is up, the banner is dismissed immediately — there is only ever one
top-priority message on the screen.

```sql
ALTER TABLE break_policies
  ADD COLUMN warn_lead_minutes INTEGER NOT NULL DEFAULT 5,   -- how early to warn
  ADD COLUMN warn_show_seconds INTEGER NOT NULL DEFAULT 60;  -- how long the name stays up
```

Big type, high contrast, readable across a bingo hall. No member-facing data on it.

### Pet layer

Every employee claims a **named pet** — a cat or a dog — from the shipped library (see below).

**Position encodes state** — the pets ARE the status display, read spatially:
- Checked in / on the floor → pet walks slowly along a lane at the **bottom** of the screen.
- Upcoming break (next in queue) → pet drifts to the **middle** band, near its UP-NEXT tile.
- On break → pet sits in the **top** band next to its countdown timer.
- Clock out → pet walks off-screen.

Pets are **AI-generated art from a fixed library**, not per-worker freeform generation. The
library ships with **60 pets — 40 cats and 20 dogs — plus 6 boss creatures** (generated with fal.ai flux/schnell plus
background removal, hand-QA'd, stored as trimmed transparent PNGs), each in two poses: walking
(side profile, facing right) and sitting. Adding more later is a batch job, not a per-worker
call — which keeps art quality controlled and costs fixed.

**One pet, one person.** A pet is claimed exclusively: once someone takes Marmalade, Marmalade
is off the board for everyone else. This makes the floor unambiguous — a pet identifies exactly
one worker at a glance, which is the whole point of the spatial encoding.

```sql
CREATE TABLE pets (                        -- the shipped library
  id TEXT PRIMARY KEY,                     -- 'marmalade', 'rufus', 'vampire', …
  kind TEXT NOT NULL CHECK (kind IN ('cat','dog','boss')),
  walk_path TEXT NOT NULL, sit_path TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true
);

ALTER TABLE staff ADD COLUMN pet_id TEXT REFERENCES pets(id);
-- exclusivity, enforced by the DB rather than the UI:
CREATE UNIQUE INDEX uniq_pet_per_customer ON staff(customer_id, pet_id)
  WHERE pet_id IS NOT NULL;
```

Claiming happens in the staff site (`me.html` → **Pick your pet**, prototype:
`pet-picker.html`): a searchable grid filterable by cat/dog/boss/available-only, taken pets
greyed out with the current owner's name and not selectable, and a claim writing `staff.pet_id`.
Re-picking releases the previous pet back to the pool. Because the unique index is the real
gate, two people tapping the same pet at once resolves cleanly — the loser gets "just taken,
pick another" rather than a duplicate.

### Seniority tiers — what each role may claim

The species itself encodes seniority, so tier is readable on the floor without a label:

| Tier | May claim | Who |
|---|---|---|
| Floor runner (most junior, the biggest group) | **Cats** | Flash Runner |
| Senior staff | **Dogs** (cats too) | Paymaster, Flash Manager, Session Staff |
| Manager | **Monsters** (and anything below) | Bingo Manager |

```sql
ALTER TABLE pets  ADD COLUMN min_tier SMALLINT NOT NULL DEFAULT 0;  -- 0 cat, 1 dog, 2 monster
ALTER TABLE staff ADD COLUMN tier     SMALLINT NOT NULL DEFAULT 0;  -- derived from role
-- claim check, enforced server-side alongside the uniqueness index:
--   (SELECT min_tier FROM pets WHERE id = NEW.pet_id) <= NEW.tier
```

Tiers are **cumulative** in the current build (`CUMULATIVE = true` in the prototype): a senior
worker who loves cats keeps the option. Flip the flag to make each tier exclusive, so a dog
always means senior and nothing else. Locked species still render in the grid, greyed with a
padlock and "senior staff only" — visible aspiration beats a hidden feature, and it makes a
promotion feel like it unlocks something.

When someone's tier drops, their pet is *not* auto-released; the manager is prompted at the next
claim review, since silently taking away someone's cat would read as a punishment.

### Boss monsters (manager tier)

Managers don't get pets — they get **monsters**, so a boss is identifiable on the floor at a
glance and never mistaken for a shift worker. Same library table, `kind = 'boss'`,
`min_tier = 2`. Exclusivity works exactly the same — one monster, one manager.

The theme is deliberately monsters, not fantasy generally — no fairies or mermaids. All the
managers are women, so they are drawn to match: cute chibi girl characters, spooky in species but
friendly in face. Shipped: **vampire, dragon, werewolf, witch, zombie, rubber ducky**.

| Manager | Monster | Reads on the board as |
|---|---|---|
| Shelly (Redwood City) | Rubber Ducky girl — wild curly red hair, yellow raincoat, duck ring | **Shelly the Rubber Ducky** |
| Rachel | Dragon | **Rachel the Dragon** |
| Sagit | Witch | **Sagit the Witch** |

The boss tag is one identity — name + species on the first line, role beneath — rather than the
staff format of name/role over pet name. Bosses render ~25% larger with a warm gold tag and a
soft aura, and they are **excluded from the break timeline**: they approve breaks rather than
take scheduled ones, so they never appear in ON BREAK or UP NEXT. They patrol whenever clocked in.
Vampire, werewolf and zombie are unclaimed, available for the other managers. (Shelly's Rubber
Ducky isn't a monster — the manager tier is really "characters"; the name stuck from the first three.)

### Dog-chases-cat

Every 25–50 seconds a dog on the floor may take off after the nearest cat ahead of it, with a
bark. The cat runs faster than the dog, so the dog never catches it; after 6–10 seconds it
gives up and both drift back to a normal amble. The fleeing cat shows a small "!" above it.

Constrained by the same guardrails as everything else on this screen: a chase never starts
while a break alert is on screen, and any running chase ends the instant one fires — the alert
always wins. Chases also skip anyone grooming, on break, or clocked out, and bosses never
participate.

**Motion.** Cats wander at individual speeds rather than in lockstep. Every 15 seconds each cat
independently has a **30% chance to change speed**, picked from stop-in-place / amble / normal /
trot. When two stopped cats end up near each other, one **grooms the other** — it sits, leans in
with a slow licking motion, a small heart floats up, and the pair holds for ~10–14 seconds before
resuming. This is what makes the floor feel alive instead of mechanical.

**Sound.** The board plays audio cues (also AI-generated): a **cat meow** when a break alert
takes over the screen, a **chirp** when someone clocks in, a soft **purr** when a grooming pair
starts, a **chime** on postpone/manager actions. Trade-off worth naming: in a loud hall a sound
cue genuinely helps the alert land, but it also means the board makes noise during play —
so volume is configurable per hall and every cue can be muted independently, with the meow
alert being the one to keep if only one survives. Browsers block autoplay until a user gesture,
so the kiosk TV needs one click after load (or autoplay allowlisted for the board's origin).

Guardrails so it never becomes a distraction (these are requirements, not suggestions):
- Ambient motion only: no chasing, no antics beyond grooming; respects a reduced-motion flag.
- Name + role always rendered as text beside the cat — nobody should need to remember whose
  cat is the orange tabby mid-rush.
- Timers and tiles always layer **above** cats; a cat can never obscure a number.
- During a DUE-NOW takeover, that person's cat walks to center and sits large beside the
  alert tile; **all other cats dim and freeze** until the takeover clears. The cat amplifies
  the alert, never competes with it.
- Scope stays here: no accessories, streaks, or gamification. It's an avatar, not a game.

## Module 7 — Hours → payroll (Gusto)

**Decision: payroll runs through Gusto, connected via the Gusto API** (their time-tracking app
integration, not file import).

- Worked hours per `time_entry`: `clock_out − clock_in − Σ(unpaid meal durations)`. Rests are always
  paid and never deducted; a meal is deducted **only** when it resolved as a genuine off-duty meal
  (see Module 5). Interrupted, late or missed meals are paid AND flagged as premium-owing.
- **Pay-period review screen** (manager+): per person per period — hours by day, breaks taken /
  postponed / missed, unapproved walk-up entries, overtime flags, and the commission module's
  per-person totals pulled alongside. This screen is the gate: nothing reaches Gusto until the
  manager resolves flags and hits Sync.

### Gusto integration mechanics (per Gusto's time-tracking integration docs)

- Register a **Time Tracking application** in the Gusto Developer Portal with "Disable Gusto's
  time tracking features" selected; connect via **OAuth2**. Tokens stored server-side
  (Supabase edge function / secrets), never in the browser.
- **Employee reconciliation**: pull the Gusto employee roster and map to `staff` —
  `ALTER TABLE staff ADD COLUMN gusto_employee_uuid UUID;` — with a match/fix-up screen inside
  the pay-period review (unmatched staff block sync for that person only).
- **Push is per shift, not per period** (Gusto requires shift-level submission): on Sync, each
  approved `time_entry` posts to `POST /companies/{company_uuid}/time_tracking/time_sheets`
  with UTC timestamps, time zone, and **hours pre-classified into Regular / Overtime / Double
  Overtime** — the scheduler applies CA rules (>8h/day OT, >12h/day DOT, 7th-consecutive-day
  rules) before pushing, since Gusto expects classified hours.
- Only **unpaid, uninterrupted** meals are excluded from pushed hours. Rests are always included.
  A meal that was interrupted or taken late is pushed as paid time, with its premium hour flagged
  for the manager to add on the Gusto payroll run.
- Pushed hours sit **pending inside Gusto** until the manager syncs them into the payroll run
  from Gusto's own UI — so Gusto remains the final checkpoint. Late corrections after a payroll
  has run go through Gusto off-cycle adjustments.
- Sync is idempotent per time_entry (store `gusto_timesheet_id` + synced_at on the row) and
  fully logged.
- **Commissions**: Gusto's time-sheets API carries hours, not dollar pay items. Commission
  totals from the commission module surface on the review screen next to hours; getting them
  into Gusto is either manual entry into the payroll run or (if the API scope allows) a payroll
  one-time-earning update — verify scope during Phase 6 (open question #5).

## Build order

| Phase | Ships | Depends on |
|---|---|---|
| 1 | Availability tri-state + roles admin + role slotting + "you've been booked" texts | migrations only |
| 2 | Swap flow (tag replacement, text confirm, RPC, manager force-resolve) | 1 |
| 3 | Time clock kiosk (PIN, walk-ups, approvals) | 1 (roles) |
| 4 | Break engine + planner + iPad break taps | 3 |
| 5 | Break board TV page (tiles + timers first; pet layer + me.html pet picker second) | 4 |
| 6 | Pay-period review + Gusto OAuth app, employee mapping, per-shift timesheet sync | 3 (4 improves it) |

Each phase is releasable on its own; 1–2 change the manager's week immediately, 3–6 change game
night. Sequencing matches the Division-3 rollout targets.

## Open questions

1. ~~Which payroll provider?~~ **Resolved: Gusto, via API** (see Module 7).
2. Meal breaks unpaid and off the clock — confirm that matches how workers are paid today
   (doc assumes yes; volunteers may differ).
3. Should "sometimes available" workers ever get an automatic "can you work Tuesday?" text, or
   is direct booking always fine? (V2 assumes direct booking.)
4. Do we need a per-staff role capability matrix (who is *allowed* to call), or does the manager
   just know? (V2 assumes she knows.)
5. Commissions + missed-meal premium into Gusto: manual entry in the Gusto payroll run, or
   automated via payroll-update API if the integration scope allows — verify during Phase 6.

*Compliance note: break rules here follow common California wage-order defaults, but this doc is
not legal advice — have payroll/HR confirm the policy values in `break_policies` before go-live.*
