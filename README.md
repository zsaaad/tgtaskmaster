# Toggle Task Master — a spatial task manager for small marketing teams

_(formerly "Toss" — same app, fuller name)_

> Tasks are circles. Your screen has a dotted line down the middle.
> Left of the line is yours. Right of the line is everyone else.
> You get things off your plate by **physically dragging them across the line**
> onto a teammate, or into the DONE / BLOCKED bucket.

That's the whole app.

## Why this exists

Asana, Linear, Trello, ClickUp — all great, all over-built for a marketing team
of 4–6 people who mostly need to know:

1. What's on **my** plate today?
2. What did I hand to **Vik** and is it back yet?
3. What's stuck?

Existing tools answer those by burying you in projects, statuses, custom fields,
swimlanes, and tagging conventions nobody follows. **Toggle Task Master** answers them with
geometry: if it's on your left, it's yours. If it's a ghost on Vik's avatar,
you're waiting on Vik. If it's in DONE, it's done.

The act of delegation is a gesture, not a form.

## How it works

Each person on the team opens the same URL and picks their identity once. From
then on, the screen shows their **personal view**:

```
+--------------------------------------------+
|  Toggle Task Master                       [+ new task]   |
|                                            |
|                                            |
|   (•)        ¦                ( YY )       |
|              ¦                             |
|        (•)   ¦                ( Vik )      |
|              ¦                             |
|              ¦                ( Lina )     |
|     (•)      ¦                             |
|              ¦      [   DONE   ]           |
|              ¦      [ BLOCKED  ]           |
|                                            |
+--------------------------------------------+
   LEFT = my plate        RIGHT = everyone else
                          + done / blocked buckets
```

- Click **+ new task**, fill in title + description + due date → a circle
  spawns on your left.
- Drag a circle onto a teammate's avatar → ownership transfers. The task
  appears on **their** left side in real-time.
- Drag a circle into **DONE** or **BLOCKED** → status flips. Both you and the
  task's creator see it land in your respective buckets.
- A small counter on each teammate's avatar shows how many tasks you've
  handed them that aren't done yet — your accountability trail without
  opening another tool.

Overdue circles have a red rim. Tasks due today have an amber rim. Future
tasks are neutral. That's the entire visual language.

## Three iterations to get here

This README documents the **target shape**. The codebase moves through three
phases — see [`CLAUDE.md`](./CLAUDE.md) for the build roadmap and what's done
vs. still ahead.

| Phase | What it proves | Tech |
|-------|----------------|------|
| 1 | The drag-across-line gesture feels right | Single HTML file, localStorage, fake multi-user via dropdown |
| 2 | Real-time multi-user + accountability ghosts | + Firebase Firestore + Anonymous Auth |
| 3 | Production-feel MVP — due-date signal, mobile fallback, incoming notifications | + polish, no new infra |

## Tech stack

Deliberately boring and tiny.

- **Frontend:** vanilla HTML / CSS / JS in a single page. No build step in
  phase 1, optional Vite later if the file gets unwieldy.
- **Backend:** Firebase Firestore (real-time) + Anonymous Auth.
- **Hosting:** Firebase Hosting (free tier covers a team this size easily).
- **No** framework, **no** task queue, **no** server to maintain.

## Setup (will be filled in as code lands)

```bash
# phase 1 — local prototype
open index.html

# phase 2+ — wire up Firebase
# 1. create a Firebase project at console.firebase.google.com
# 2. enable Firestore + Anonymous Auth
# 3. copy the config snippet into `firebase-config.js` (gitignored)
# 4. deploy: firebase deploy --only hosting
```

## Status

Pre-code. Design locked, [`CLAUDE.md`](./CLAUDE.md) holds the build plan and
data model. Phase 1 prototype is the next thing to build.

## What this is NOT

- Not a project management tool. No projects, no milestones, no Gantt.
- Not a CRM or a sales pipeline.
- Not for teams >~8. The right-side avatar row stops working past that.
- Not a replacement for tools like Linear if your team actually ships
  software. This is for **operations-style** work where the unit is "a thing
  someone needs to do" and the verb is "hand it to someone."
