# CLAUDE.md — Toggle Task Master

Project instructions for any Claude session working in this directory.

## What this is

A spatial task manager for small marketing teams. App name: **Toggle Task
Master** (previously prototyped as "Toss" — same product, fuller name). See
[`README.md`](./README.md) for the user-facing pitch. The core mechanic:
each person has a screen split by a stone wall. **Left = mine, right =
everyone else + DONE/BLOCKED baskets.** Delegation is a drag across the wall.

## Cranium

- Slug for this project: `tg-taskmanager`
- Durable notes: `~/cranium/projects/tg-taskmanager.md`
- Active todos: `~/cranium/todos/tg-taskmanager.md`
- Parent project: `toggle-agency` (this lives inside `~/Desktop/Code/tg/`, the
  Toggle Agency / UNITAR repo, but is its own thing — internal tool, not
  client-facing).

Follow the cranium rules in `~/cranium/CLAUDE.md`. When you complete a
meaningful unit of work, update the todos file and append a line to today's
journal.

## Non-negotiable design constraints

These are the things that make this app what it is. Don't relax them without
talking to Zaid first.

1. **One vertical wall splits the screen.** Left half is *me*, right half is
   *everyone else + baskets*. The split is the entire conceptual frame.
2. **Tasks are floating orbs.** They drift with light physics inside their
   owner's zone — never crossing the wall on their own. The only way an orb
   reaches the other side is if a human picks it up and carries it across.
3. **Pixel-art top-down dungeon aesthetic.** Think Zelda overworld / pixel-
   dungeon tilesets. Sprites are procedurally drawn in canvas (no external
   asset pipeline). The palette is dungeon-dark: deep blues, stone greys,
   torchlight oranges, character-color shirts as the only saturated hits.
4. **Characters with names, not avatars.** Each person is a little pixel
   character standing in their zone. Your character is on the left; teammates
   stand on the right. Names float above them.
5. **Baskets are actual baskets.** DONE and BLOCKED render as wicker baskets
   (pixel-art) on the right side, not as rectangles. Things dropped in them
   visibly pile up inside.
6. **Stacks are visible.** When a task lands on a teammate or in a basket,
   the orb stays there — visually attached. Glance at the right side and you
   should immediately see who's holding how many.
7. **Delegation is a drag gesture on desktop, a tap-menu on mobile.** The
   assign action *is* the spatial movement.
8. **No projects, no tags, no statuses beyond `active | done | blocked`.**
   Resist scope creep — features get parked, not added.
9. **Every transfer is logged in `task.history[]`.** Audit trail under the
   casual gesture.

## Tech stack — locked unless we hit a wall

- Vanilla HTML/CSS/JS, single page. No framework in phase 1.
- **`<canvas>` for the play area** (sprites + physics). DOM only for the
  header bar and modal dialogs. Decision rationale lives in
  `~/cranium/decisions/2026-05-22-tg-taskmanager-canvas.md`.
- All sprites are **procedurally drawn** in code from string-array data —
  no external image files, no asset pipeline, no CORS issues.
- "Press Start 2P" loaded from Google Fonts for pixel-font UI labels.
- Firebase Firestore for data + real-time (phase 2). Anonymous Auth for
  identity. Firebase Hosting for deploy.
- No bundler in phase 1. If the JS file crosses ~1200 lines or we need
  imports, reach for Vite — not React, not Svelte, just Vite + plain ES
  modules.

If you find yourself wanting to add a framework, a state library, a backend
server, or a database other than Firestore — stop and write a one-paragraph
decision note in `~/cranium/decisions/` first. There has to be a reason.

## Data model

Single Firestore collection `tasks`. One doc per task:

```js
{
  id: string,              // doc id
  title: string,
  description: string,     // optional, can be empty
  dueDate: timestamp | null,
  status: "active" | "done" | "blocked",
  ownerId: string,         // userId of who currently has it on their left
  createdBy: string,       // userId of original creator
  history: [               // append-only
    { from: string, to: string, at: timestamp, kind: "transfer" | "status" }
  ],
  // Physics state — local to the current owner's view, persisted so the
  // orbs don't teleport on reload:
  x: number | null,        // px within owner's zone
  y: number | null,
  vx: number,              // velocity, in px/frame
  vy: number,
  // Optional metadata:
  client: string | null,   // one of CLIENTS in app.js ("Toggle" | "Unitar" | "City U") or null
  createdAt: timestamp,
  updatedAt: timestamp,
}
```

`history[].kind` values: `"transfer"` (orb handed to another teammate),
`"status"` (dropped into DONE/BLOCKED basket — `to` is the bucket id),
`"request-back"` (pulled back from a teammate's stack), `"reopen"` (pulled
back from a basket — orb returns to your left as active).

The `CLIENTS` list lives in `app.js`. Add a new client by appending to that
array — the new-quest dropdown and the ledger filter pick it up automatically.

When a task transfers to a new owner, **clear `x`, `y`, `vx`, `vy`** — the new
owner's view will assign a fresh spawn position. Stack positions for tasks
attached to teammates on the right side are *derived* (index in the filtered
list), not persisted.

One Firestore doc `team/roster`:

```js
{
  members: [
    { id: "zaid", name: "Zaid", color: "#5b8def", emoji: "🧠" },
    { id: "vik",  name: "Vik",  color: "#f08a3e", emoji: "🛠️" },
    // ...
  ]
}
```

Client behaviour:

- Listen to **all tasks** in real-time (team is small, data is small — don't
  prematurely optimize with composite indexes).
- Filter client-side:
  - **Left side** = `ownerId === me && status === "active"`
  - **Avatar ghost on right** for member X = `ownerId === X && status === "active" && me in history.from` (i.e. I sent it to them)
  - **DONE bucket** = `status === "done" && (createdBy === me || me appears in history)`
  - **BLOCKED bucket** = `status === "blocked" && (createdBy === me || me appears in history)`

## Build phases — current status

Treat these as a roadmap, not a strict gate. Don't jump ahead until the
previous phase actually works.

### Phase 1 — single-user prototype (NOT STARTED)

Deliverable: `index.html` that one person can open locally and use end-to-end
with fake multi-user (identity dropdown). Uses localStorage. Proves the
drag-across-line gesture feels right.

Acceptance: Zaid can sit with the prototype open, create 5 tasks, drag them
across, and the gesture feels natural. If it doesn't feel right, we redesign
the gesture before adding Firestore.

### Phase 2 — real multi-user (NOT STARTED)

Adds: Firestore + Anonymous Auth, real-time sync across browsers, outgoing
ghost badges on teammate avatars, task history panel.

Acceptance: Two browsers, two identities, drag on one updates the other in
under a second.

### Phase 3 — MVP polish (NOT STARTED)

Adds: due-date rim color (overdue red / today amber / future neutral), "Today"
filter toggle, click-to-edit task panel, incoming task animation + sound +
backgrounded-tab browser notification, mobile tap-menu fallback, team config UI.

Acceptance: ship it to the marketing team. Watch them use it for a week
without explanation. Iterate from real usage, not speculation.

## Conventions

- **File layout (phase 1):** single `index.html`, single `app.js`, single
  `styles.css`. If you split further, justify it.
- **No emoji in code or commit messages** unless Zaid asks.
- **No comments explaining what code does** — only why, and only when the why
  is non-obvious. The data model above is the canonical reference; the code
  should match it without restating it.
- **Commit messages:** short, imperative, lowercase. e.g. `phase 1: drag
  reassigns owner`. No conventional-commit prefixes.
- **Never auto-commit.** Zaid commits manually. You can prepare a message if
  asked.

## The Ledger

A full-screen overlay (separate `<dialog>`) reached via the LEDGER button in
the header. Shows every task as a sortable / filterable table — status,
title, client, owner, creator, due, history, last updated. Click any row to
open the existing detail dialog on top (history + take-back + delete). An
EXPORT CSV button writes a UTF-8 CSV with all fields and a flattened
history string. This is deliberately *not* a separate HTML file — single SPA,
single Firestore subscription when phase 2 lands.

## Ledger view

A full-screen overlay (the `#ledger-dialog`) accessed via the LEDGER button in
the header. Master sheet of all tasks: status / title / client / owner /
creator / due / history / updated. Sortable by clicking column headers,
filterable by client and status, CSV-exportable (BOM-prefixed UTF-8 so Excel
opens it cleanly). Row click opens the same detail dialog used from the
canvas — so take-back, delete, and edit flow through one place.

This was a deliberate call over a separate `tasks.html` page: keeps the SPA
single-file, single-source-of-truth, and shares the Firestore subscription
that phase 2 will add. CSV export covers the "I need this in Sheets" case
without making Sheets the runtime.

## Streaks + rewards

Each user has a daily check-in streak with a rewards layer on top. Stored in
localStorage key `toss.streaks.v2` as:

```js
{
  userId: {
    lastDay: "YYYY-MM-DD",
    count: number,            // current streak
    best: number,             // longest streak ever
    charges: number,          // torch charges held (0–MAX_CHARGES)
    chargesEarned: number[],  // milestones already paid out (so we don't double-award)
  }
}
```

**Check-in mechanics:**
- Loading the app while playing as that identity counts. No button.
- `recordCheckin()` runs on app init and on identity-switch in phase 1.
- `diff === 0`: no-op. `diff === 1`: count++. `diff === 2` with a charge: spend
  the charge, count += 2 (charge bridges the missed day). Otherwise: reset to 1.

**Rewards layer:**
- **Titles** at 3 / 7 / 14 / 30 / 60 / 100 / 365 days (ACOLYTE → MYTHIC). Rendered
  via `drawTitleLabel()` below each character's feet. Colors escalate per tier.
  MYTHIC uses a smooth-lerp gold↔cream shimmer.
- **Torch charges** — Duolingo-style streak insurance. Earned at days 7, 30, 100
  (one each, max 3 held). Auto-spend when a player misses exactly one day.
- **Character aura** — `drawAura()` paints a pulsing halo behind characters with
  streak ≥ 7. Tier 2+ adds drifting embers. Tier 4 (MYTHIC) adds a light beam
  from above. Aura alphas tuned (0.12 / 0.22 / 0.30) so multiple active streaks
  don't wash out the right zone.
- **Toasts** — `announceCheckin()` surfaces charge spends, milestones, new
  titles, and (only at ≥7d) broken-streak notices. Charge-spent + milestone-hit
  on the same call collapse into one "TORCH RECHARGED" message.

**Tavern (Hall of Trophies):** Full-screen overlay (`#tavern-dialog`) opened by
clicking the streak badge in the header. Shows current streak + best ever,
torch-charge slots, current title, the full title ladder (locked / unlocked /
current), per-quest stats, and a Party panel listing every teammate's streak +
title + best.

**Phase 2:** move `streak` to each user's Firestore doc. Drop the identity-switch
check-in hook (real users won't switch). Load-time check-in stays.

## Clients

Hard-coded list in `app.js` `CLIENTS = ["Toggle", "Unitar", "City U"]`. Add
new ones there; the dropdown and the ledger filter pick them up
automatically. Tasks with `client === null` show as "—" in the ledger and
filter under "(none)".

## What NOT to build

Park these explicitly. If a future session is tempted, they should re-read
this section first.

- Recurring tasks
- Subtasks / parent-child
- Comments threads on tasks
- Multiple workspaces / multiple teams
- Custom buckets beyond DONE and BLOCKED
- Custom task statuses
- Time tracking
- File attachments
- Integrations (Slack, email, calendar)
- Notifications by email or push beyond simple browser notifications
- Search (the right answer when search would help is "you have too many tasks
  on your plate, hand some off")
- Analytics / reporting dashboards

If Zaid asks for one of these, push back once with "are we sure this isn't the
thing Asana already does well?" — then build it if he confirms.

## Working style for this project

- Zaid is the only user / decision-maker. Default to terse responses.
- He'll likely want to iterate visually a lot. Be ready to ship rough HTML and
  refine in dialog rather than over-planning.
- The novelty is the UX, not the tech. Time spent picking frameworks or
  arguing about state management is time stolen from making the drag feel
  good.
