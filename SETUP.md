# Phase 2 Firebase setup

Five-minute walkthrough to point Toggle Task Master at a real Firebase project.

## 1. Create the Firebase project

1. Go to <https://console.firebase.google.com/> → **Add project**.
2. Name it something like `toggle-task-master` (the slug doesn't matter — the
   id Google assigns is what matters).
3. Google Analytics: skip (you can turn it on later).

## 2. Enable Anonymous Auth

1. **Build → Authentication → Get started**.
2. **Sign-in method** tab → **Anonymous** → enable.

## 3. Create the Firestore database

1. **Build → Firestore Database → Create database**.
2. Mode: **Production**. (Rules below replace the default lock-everything.)
3. Region: pick one close to the team (e.g. `asia-southeast1` for Malaysia).

## 4. Add a web app + grab the config

1. **Project settings (gear icon)** → **Your apps** → **Web** (`</>` icon).
2. Nickname: `ttm-web`. Don't enable Hosting yet — we'll wire that in phase 3.
3. Copy the `firebaseConfig` object Firebase shows you.
4. In the repo, copy `firebase-config.example.js` to `firebase-config.js`
   and paste the real values. `firebase-config.js` is gitignored.

```bash
cp firebase-config.example.js firebase-config.js
# then edit firebase-config.js
```

## 5. Deploy the security rules

The rules live in `firestore.rules` at the repo root.

### Option A — Firebase CLI (recommended)

```bash
npm install -g firebase-tools          # one-time
firebase login                         # one-time
firebase use --add                     # pick your project
firebase deploy --only firestore:rules
```

If `firebase init` asks for a `firestore.indexes.json`, accept the default —
we don't need any composite indexes in phase 2.

### Option B — paste into the console

Console → **Firestore Database → Rules** tab → paste the contents of
`firestore.rules` → **Publish**.

## 6. Run it

```bash
# from the repo root
python3 -m http.server 8080
# then open http://localhost:8080
```

Open two browser tabs (or two browsers) at the same URL. They should
both auth anonymously, share the same task pool, and update in
real-time. The "playing as" dropdown still lets you pick which team member
each tab claims — useful while we have one anon UID per browser.

## 7. Sanity checks

- **Console → Firestore → tasks** should show task docs after you create one.
- Drag an orb across in tab A → it should appear on tab B within ~1s.
- Closing both tabs and reopening should restore everything (tasks come from
  Firestore, drift positions get re-randomized inside each owner's zone).

## What's not wired yet (phase 3)

- Firebase Hosting deploy (`firebase deploy --only hosting`).
- A team config UI for adding/removing members (currently the `TEAM` array
  in `app.js` is the source of truth; the Firestore `team/roster` doc is
  populated from it on first run).
- Browser push notifications when a task lands on you with the tab
  backgrounded.

## Troubleshooting

- **"Missing or insufficient permissions"** in the console → rules didn't
  deploy or you're not authed. Refresh the tab; check the rules tab in the
  console matches `firestore.rules`.
- **Console says "Firebase fallback: running in localStorage mode"** →
  `firebase-config.js` doesn't exist or still has `REPLACE_ME` values.
- **Tasks appear duplicated after refresh** → you had localStorage tasks from
  phase 1 plus Firestore tasks now. Clear `localStorage` once
  (`localStorage.clear()` in devtools) — phase 2 treats Firestore as source
  of truth.
