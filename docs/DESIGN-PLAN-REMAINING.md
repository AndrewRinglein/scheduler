# What's left to build

Frontier bingo hall scheduler · design plan · 12 August 2026

**Revised 12 August** — §4 was wrong in the first draft (it said no email
existed; there is a live, working email function) and §1 gained the pay-period
correction. Everything else stands.

Written after walking the demo's ten views against what exists. Everything here
is either something you've asked for that isn't built, or something in the
original demo we haven't reached. Decisions you've already made are marked
**decided** and are not up for re-litigation — they're recorded so the build
doesn't quietly drift away from them.

---

## The shape of the thing we're building toward

Your words, which are the spine of the next three sections:

> Rachel sends out availability. She books people. She can book them even if
> they haven't sent back their availability. She's gonna mostly book people who
> are available. They are booked. They get a text saying they have it. They can
> try to get out of it by having someone else take it over. They can decline it,
> which is gonna give them a warning that they're not normally allowed to
> decline. Declining without finding a replacement is not acceptable.

That's a five-step loop — **ask → book → publish → tell → settle** — and most of
what's missing is the back half of it. The front half exists.

---

## 1. The worker's page

**Status:** a third built. It does availability and the pet picker. Everything
below is missing.

One permanent link per person, no login, already working. The page grows four
sections.

### My shifts
Every shift in the published fortnight and beyond: date, hall, role, start time,
and whether they've acknowledged it. Unpublished fortnights are invisible to
them — a draft is Rachel thinking, not a commitment.

Each shift offers two actions:

- **Hand it over** — the normal route (see §2).
- **I can't work this** — decline. Shows a warning first, in plain language:
  *"You're expected to find someone to take it. Declining without a replacement
  isn't normally allowed and your manager will be told."* They can still go
  through. **Decided.**

### My hours
Current pay period — **fourteen days starting on a Monday**, not the 1st–15th.
Hours worked, overtime earned, and commission for the period.

*Fixed 12 August:* the code had this as semi-monthly in both the regular-rate
module and the Staff hours screen. It now derives from a single anchor Monday
(`PAY_PERIOD_ANCHOR`, currently `2026-08-03` and marked provisional) — change
that one line and every period moves. Tests check that every period across four
years starts on a Monday and contains its own date. **No pay rate**,
which costs us nothing because no rate is stored anywhere in this system.
**Decided.**

Worth knowing: pay fortnights and schedule fortnights are both Monday-anchored,
so they either coincide exactly or sit a week apart, never anything messier.
`alignsWithSchedule()` answers which. If they coincide, a published schedule can
be read straight off as a timesheet.

### My availability
Already built. Stays where it is.

### My character
Already built. Stays.

**Open:** does a worker need to see *last* pay period once a new one starts?
Assume yes, one step back, no further.

---

## 2. Handing over a shift

**Status:** nothing built. There's a `handed_from` column and a `declined`
state; no flow.

**Decided:** the replacement must be **qualified for that exact role** — a
caller can only be replaced by a caller or a named deputy. **Decided:** once the
replacement accepts, **it's done**; Rachel is told rather than asked.

### The flow

1. Worker picks a shift and taps *Hand it over*.
2. They see everyone qualified for that role who is **active, not already
   working that session, and not made unavailable that day**. Pets and first
   names, so it reads like people rather than a database.
3. They pick someone. That person gets a message: *"Can you take Friday 15th,
   Santa Clara, caller, from 3:15?"* with a link.
4. The replacement accepts or declines on their own page.
5. **Accept** → the assignment moves, both people are told, Rachel's list gets
   an entry. **Decline** → the original person is told and still owns the shift;
   they can ask someone else.

### Rules worth stating
- One live request per shift at a time. Asking three people simultaneously and
  having two accept is a race with a real-world cost.
- A request expires when the session starts. A pending handoff for a shift that
  has already begun is noise.
- The original person keeps the shift until someone accepts. There is never a
  moment where a published shift has nobody's name on it because of a handoff
  in flight.

### Data
`sched_handoffs` — shift, from, to, status (`pending|accepted|declined|expired`),
requested_at, resolved_at. The assignment itself only moves on accept, and
`handed_from` records who it came from so history survives.

---

## 3. Declining

**Decided:** the slot **empties** and Rachel is alerted. The decline is recorded
against the person so a pattern is visible rather than forgotten.

Two consequences worth being deliberate about. The schedule shows a real hole,
which is honest — a name in a slot the person has refused is worse than an empty
one. And `sched_declines` accumulates a record per person, which is the thing
that turns "I feel like Jordy declines a lot" into an answer.

---

## 4. Messaging

**Status — corrected 12 August.** An earlier draft of this document said
"nothing at all." That was wrong, and the mistake was mine: I checked the
scheduler tables and the ecommerce project and never checked our own edge
functions.

### Email already works

There is a live `send-email` function on the Operational DB. It sends through
Resend, logs every attempt to the `emails` table, and defaults to test mode
unless a caller explicitly turns it off. **Eleven real emails have been sent
from it — not test mode, every one with a Resend provider id, the most recent
on 12 August.** The API key is set. Nothing needs provisioning.

Its interface is generic: a list of recipients, each with a subject, a text
body and optional HTML. That is everything the four messages below need.

`verify_jwt` is on, so an authenticated caller is required — the manager app
qualifies, the anonymous worker page does not. That is the right way round;
workers receive messages, they don't send them.

### SMS needs four strings and nothing else

The provider layer in your colleague's repo (`aws-eum.ts`, `twilio.ts`,
`sns.ts`, `types.ts`) has no database coupling and no reference to any domain.
Sending needs exactly four environment variables:

    AWS_EUM_ACCESS_KEY_ID
    AWS_EUM_SECRET_ACCESS_KEY
    AWS_EUM_REGION
    AWS_EUM_ORIGINATION_IDENTITY      # the toll-free number

They are already set as secrets on their Supabase project. Same number, same
carrier approval, same opt-out list.

**The registration already covers this use case.** Their repo contains
`send-shift-invite` — booking texts to staff carrying a token link. That is
precisely what we want to send. There is nothing to amend and no vetting to
wait on. An earlier draft raised this as a risk; it is not one.

**The domain matters only for the link, not the send.** Nothing in the sending
path mentions a domain. What must be on bingobuyin.com is the page a worker
lands on — `me.html`, one self-contained file, dropped alongside where the old
scheduler is served. The manager app, the break board and the time clock are
never linked to and stay exactly as they are. The file still talks to our
Supabase project; only its URL lives on their domain.

### The four messages

**Decided:**

| Message | Trigger | Carries |
|---|---|---|
| Welcome / pick your pet | A new staff member is added | Their permanent link |
| Availability request | Rachel creates and sends a request | The pre-filled form |
| You've been booked | Rachel **publishes** a fortnight | Their link, all their shifts |
| Swap request / swap confirmed | A handoff is asked for and resolved | The specific shift |

Publishing is the trigger for booking messages. That gives publish a real
meaning it currently lacks, and it gives Rachel a deliberate moment before 67
people are messaged rather than a message firing every time she touches a
dropdown.

**Decided:** Rachel gets no texts. Declines, completed swaps and non-replies
collect in the app as a list she checks (§5).

### Design: one send path, two channels

A single `notify(person, template, vars)` that picks the channel per person —
SMS if they have a number, email if they have an address, both never. Templates
live in one place and render for either channel. The channel is a detail of
delivery, not something the calling code should know about, so publishing a
fortnight does not care how anybody is reached.

This matters practically: **email works today and SMS is a switch.** Build the
loop on email now, and adding the four credentials later turns texting on for
the people who have numbers without touching any of the code that sends.

### The one real blocker

**Contact details.** Of 67 active staff, 25 have an email, 18 have a phone,
and **42 have neither**. Inline editing now exists in the staff list; somebody
has to actually sit down and fill it in. Until then any send — by either
channel — reaches roughly a third of the workforce. This is the single largest
constraint on the whole messaging effort and no amount of code moves it.

---

## 5. Rachel's list

**Status:** doesn't exist.

**Decided:** in-app only. A single place that answers "what needs me?" —

- People who haven't replied to the availability request
- Shifts declined, with who and when
- Handoffs completed since she last looked
- Critical staff asking for more than their two days off
- Sessions in the published fortnight that are short

A count badge on the tab. Each entry links to the thing it's about. This is
small to build and is the difference between the app telling her things and her
having to go looking.

---

## 6. The break board, finished

**Status:** functional, not alive. Tiles, the floor, postpone and skip, and the
meal-deadline takeover all work. Missing, all of it already specified by you:

- **Sounds** — meow on a break alert, chirp on clock-in, purr on grooming, bark
  on a chase, chime on postpone. Behind an *enable sound* control, because
  browsers won't play audio until someone clicks and because the back room
  shouldn't start making noises unasked.
- **Five-minute warning** — the person's UP NEXT box turns red and blinks for
  the full five minutes, and their name flashes across the board for one minute.
  A due alert supersedes any warning.
- **Freeze and dim** during an alert. The alert always wins.
- **Dog chases cat**, occasionally, with a bark. **Two stopped pets** near each
  other pause and one grooms the other.

None of this needs new data. It's all board-side.

---

## 7. The break plan, before the night

**Status:** the planner exists and is tested; there's no way to look at it ahead
of time.

A Gantt for a chosen session: every person as a row, the evening across the top,
meals and rests as blocks, coverage floors shown, conflicts in red. Rachel picks
a session in the schedule and sees how the breaks will fall before anyone is
standing in the hall.

This is the cheapest real win on the list — `planBreaks()` already returns
exactly this data structure and nothing consumes it outside the TV.

---

## 8. Building a fortnight faster

**Status:** nothing. 310 slots, filled by hand, every fortnight.

Three actions on the schedule screen:

- **Copy the last fortnight** — same people into the same roles where they're
  still qualified and available, leaving the rest empty and reporting what it
  couldn't place.
- **Fill from availability** — for each empty slot, suggest qualified people who
  said yes and aren't already working that session. Suggest, not commit: it
  fills the dropdowns and Rachel confirms.
- **Clear people** — empty every slot in the fortnight, keeping the shape.

The rule underneath all three: **never silently assign someone who said no.**
Availability now has a real "not answered" state, so the difference between
*declined* and *never asked* is available to lean on.

---

## 9. Payroll export

**Decided: no Gusto.** Excel only.

What exists produces classified hours and a two-tab workbook. What's missing is
the gate: a **review screen** for a pay period that shows unapproved walk-ups,
missed or late meals owing premiums, overtime flags, and anyone whose entries
look wrong — and doesn't let the export happen until Rachel has looked. The
export itself is nearly done; the check before it isn't started.

---

## 10. Loose ends

- **Ten more cats.** 40 cats, 51 floor runners. Three people have no character
  and there's no headroom for a new hire.
- **Placeholder shift times.** MOD, Opener and Flash Manager still carry guessed
  start and end times, flagged amber. They drive meal deadlines.
- **`admin_pin` is plaintext `4321`** in settings, readable by anyone signed in.
- **Every signed-in user can read and write everything**, including hours and
  commission. Fine while only managers sign in — and the reason workers get
  tokens rather than accounts. Would need tightening before anyone else gets a
  login.
- **Publishing tells nobody** until §4 exists.

---

## Suggested order

**First — the worker page and handoffs (§1, §2, §3).** Highest value per hour.
Uses data that already exists, needs no domain, no carrier registration and no
contact details, and can be handed to someone in person. It also gives publish a
purpose.

**Second — Rachel's list (§5).** Small, and it makes everything in §2 and §3
visible instead of silent.

**Third — the break board (§6) and the break plan (§7).** Cheap, self-contained,
and the board is the piece people actually enjoy.

**Fourth — faster building (§8).** Saves Rachel the most repetitive hour she
spends.

**Fifth — messaging (§4).** Email is live and needs nothing from anybody, so
the loop can be complete and running on email the day the worker page is. SMS
is then four strings and a file upload, and turns on for whoever has a number
without changing any calling code.

**Last — the payroll review gate (§9).**

### What is actually blocked, and by what

Nothing in §1, §2, §3, §5, §6, §7 or §8 is blocked. All of it uses data that
already exists and needs no credentials, no domain and no third party.

| Blocked thing | Blocked by | Who can unblock it |
|---|---|---|
| SMS sending | Four AWS values from the other project's secrets | Whoever has access to it |
| The link in a message | `me.html` served from a bingobuyin.com URL | Whoever can write to that host |
| Reaching most of the workforce | 42 of 67 staff have no phone and no email | Somebody typing them in |

The third is the one that matters. The first two are minutes of somebody's time;
the third is the difference between a messaging system and a messaging system
that reaches people.
