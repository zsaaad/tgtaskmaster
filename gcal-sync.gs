// Toggle Task Master -> Google Calendar one-way mirror.
//
// Lives in Apps Script at script.google.com under the hello@toggle.solutions
// account. Runs every 5 minutes on a time-driven trigger. Reads tasks from
// Firestore (anonymous Firebase Auth, same as the web app), diffs against the
// Toggle Task Manager calendar, and brings the calendar in line.
//
// To deploy / update: copy this file's contents into the bound Apps Script
// project. See README.md "Calendar sync" section for first-time setup.

// -- CONFIG -------------------------------------------------------------------
// API_KEY is the Firebase web apiKey (same one in firebase-config.js). Not a
// secret -- it identifies the project. Firestore rules still gate the read.
const CONFIG = {
  PROJECT_ID:  'toggle-task-master',
  API_KEY:     'PASTE_FIREBASE_WEB_API_KEY_HERE',
  CALENDAR_ID: 'c_7ea85a9025dc80bb5bf819762faa05bc997e478afc4ed9105185572809adb70e@group.calendar.google.com',
  APP_URL:     'https://toggle-task-master.web.app/',
};

const SOURCE_MARKER = 'toggle-task-master';
const SUMMARY_MAX = 1024;
const DUE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Color 11 = Tomato (red), 8 = Graphite. See
// https://developers.google.com/calendar/api/v3/reference/colors
const COLOR_BLOCKED = '11';
const COLOR_DONE    = '8';

// Firebase idTokens are good for 60 min. Cache for 50 to avoid creating a
// fresh anonymous user on every run (~288/day otherwise).
const TOKEN_TTL_MS = 50 * 60 * 1000;

// -- ENTRY --------------------------------------------------------------------
// Time-trigger entry point. Also runnable by hand from the Apps Script editor
// for smoke-testing.
function syncTasksToCalendar() {
  const idToken = getIdToken_();
  const tasks   = listTasks_(idToken);
  const roster  = fetchRoster_(idToken);
  const events  = listOurEvents_();

  const wantedByTaskId = new Map();
  for (const t of tasks) {
    if (!t.dueDate || !DUE_DATE_RE.test(t.dueDate)) continue;
    wantedByTaskId.set(t.id, t);
  }

  const eventsByTaskId = new Map();
  for (const e of events) {
    const taskId = e.extendedProperties && e.extendedProperties.private && e.extendedProperties.private.taskId;
    if (!taskId) continue;
    // Duplicate guard: two events with the same taskId (race or manual edit) --
    // keep the first, attempt to delete the rest. Failure is logged, not fatal.
    if (eventsByTaskId.has(taskId)) {
      tryRemoveEvent_(e.id, 'dup');
      continue;
    }
    eventsByTaskId.set(taskId, e);
  }

  let inserted = 0, updated = 0, deleted = 0, skipped = 0, failed = 0;

  for (const [taskId, task] of wantedByTaskId) {
    const want = buildEvent_(task, roster);
    const have = eventsByTaskId.get(taskId);
    try {
      if (!have) {
        Calendar.Events.insert(want, CONFIG.CALENDAR_ID, { sendUpdates: 'none' });
        inserted++;
      } else if (eventDiffers_(have, want)) {
        // update (not patch): full-resource replace so colorId clears when a
        // task transitions blocked/done -> active.
        Calendar.Events.update(want, CONFIG.CALENDAR_ID, have.id, { sendUpdates: 'none' });
        updated++;
      } else {
        skipped++;
      }
    } catch (err) {
      failed++;
      Logger.log('sync failure for task %s: %s', taskId, err && err.message || err);
    }
  }

  for (const [taskId, event] of eventsByTaskId) {
    if (wantedByTaskId.has(taskId)) continue;
    if (tryRemoveEvent_(event.id, 'orphan')) deleted++; else failed++;
  }

  Logger.log('sync done: %s inserted, %s updated, %s deleted, %s unchanged, %s failed',
             inserted, updated, deleted, skipped, failed);
}

function tryRemoveEvent_(eventId, reason) {
  try {
    Calendar.Events.remove(CONFIG.CALENDAR_ID, eventId, { sendUpdates: 'none' });
    return true;
  } catch (err) {
    Logger.log('remove (%s) failed for event %s: %s', reason, eventId, err && err.message || err);
    return false;
  }
}

// -- FIREBASE AUTH ------------------------------------------------------------
// Cached idToken via ScriptProperties. signUp creates a throwaway anonymous
// user; reusing the token for ~50 min cuts user creation to ~30/day.
function getIdToken_() {
  const props = PropertiesService.getScriptProperties();
  const cached = props.getProperty('IDTOKEN');
  const expiresAt = Number(props.getProperty('IDTOKEN_EXPIRES_AT') || 0);
  if (cached && Date.now() < expiresAt) return cached;

  const url = 'https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + CONFIG.API_KEY;
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ returnSecureToken: true }),
  });
  const idToken = JSON.parse(res.getContentText()).idToken;
  props.setProperty('IDTOKEN', idToken);
  props.setProperty('IDTOKEN_EXPIRES_AT', String(Date.now() + TOKEN_TTL_MS));
  return idToken;
}

// -- FIRESTORE READ -----------------------------------------------------------
function listTasks_(idToken) {
  const base = 'https://firestore.googleapis.com/v1/projects/' + CONFIG.PROJECT_ID +
               '/databases/(default)/documents/tasks';
  const out = [];
  let pageToken = null;
  do {
    const url = base + '?pageSize=300' + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
    const res = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + idToken },
    });
    const body = JSON.parse(res.getContentText());
    for (const doc of body.documents || []) {
      out.push(parseFirestoreDoc_(doc));
    }
    pageToken = body.nextPageToken || null;
  } while (pageToken);
  return out;
}

// Firestore REST wraps each field in a typed envelope. This parser handles the
// primitive cases the sync actually cares about (title/status/ownerId/dueDate
// etc.). arrayValue/mapValue fields (history) are intentionally dropped --
// sync doesn't read them. If a future field needs syncing, add a branch here.
function parseFirestoreDoc_(doc) {
  const out = { id: doc.name.split('/').pop() };
  const fields = doc.fields || {};
  for (const k in fields) {
    const v = fields[k];
    if      ('stringValue'    in v) out[k] = v.stringValue;
    else if ('integerValue'   in v) out[k] = Number(v.integerValue);
    else if ('doubleValue'    in v) out[k] = Number(v.doubleValue);
    else if ('booleanValue'   in v) out[k] = v.booleanValue;
    else if ('nullValue'      in v) out[k] = null;
    else if ('timestampValue' in v) out[k] = v.timestampValue;
  }
  return out;
}

// -- CALENDAR READ ------------------------------------------------------------
// Fetch every event we own. No time window: a task can have a dueDate years
// out or years past, and we still need to find its event to update or delete.
// Calendar API returns ~max 2500/page; small team won't approach that for a
// long time.
function listOurEvents_() {
  const out = [];
  let pageToken = null;
  do {
    const res = Calendar.Events.list(CONFIG.CALENDAR_ID, {
      privateExtendedProperty: 'source=' + SOURCE_MARKER,
      singleEvents: true,
      maxResults: 2500,
      pageToken: pageToken,
    });
    for (const e of res.items || []) out.push(e);
    pageToken = res.nextPageToken || null;
  } while (pageToken);
  return out;
}

// -- EVENT SHAPE --------------------------------------------------------------
function buildEvent_(task, roster) {
  const member    = (task.ownerId && roster[task.ownerId]) || null;
  const owner     = (member && member.name) || task.ownerId || '-';
  const clientStr = task.client || '-';
  const rawTitle  = task.title || '(untitled)';
  const summary   = rawTitle.replace(/\s+/g, ' ').trim().slice(0, SUMMARY_MAX);
  const ev = {
    summary: summary,
    start: { date: task.dueDate },
    end:   { date: addDay_(task.dueDate) },
    description:
      'Client: '  + clientStr + '\n' +
      'Owner: '   + owner + '\n' +
      'Status: '  + (task.status || 'active') + '\n\n' +
      'Open: '    + CONFIG.APP_URL,
    extendedProperties: {
      private: {
        taskId: task.id,
        source: SOURCE_MARKER,
      },
    },
  };
  // colorId is only set when there's an override. For active tasks we omit
  // the field entirely; Calendar.Events.update does a full-replace and treats
  // absent fields as cleared, so transitions blocked/done -> active drop the
  // color override correctly. Sending '' is rejected as "Invalid color id".
  if (task.status === 'blocked') ev.colorId = COLOR_BLOCKED;
  if (task.status === 'done')    ev.colorId = COLOR_DONE;
  // Invite the owner so the event appears on their personal calendar with
  // their own reminder settings. sendUpdates:'none' is set on all mutation
  // calls so they don't get notification emails.
  if (member && member.email) {
    ev.attendees = [{ email: member.email, responseStatus: 'accepted' }];
  }
  return ev;
}

// String arithmetic on YYYY-MM-DD via UTC dates -- avoids any local-TZ shift
// that would land the all-day event on the wrong calendar day.
function addDay_(yyyyMmDd) {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d));
  next.setUTCDate(next.getUTCDate() + 1);
  return Utilities.formatDate(next, 'UTC', 'yyyy-MM-dd');
}

// Compare only the fields we render. Description is trimmed because Calendar
// occasionally normalizes trailing whitespace and we don't want spurious
// updates burning API quota every run.
function eventDiffers_(have, want) {
  if (have.summary !== want.summary) return true;
  if ((have.colorId || '') !== (want.colorId || '')) return true;
  if ((have.description || '').trim() !== want.description.trim()) return true;
  if (!have.start || have.start.date !== want.start.date) return true;
  if (!have.end   || have.end.date   !== want.end.date)   return true;
  if (attendeeEmail_(have) !== attendeeEmail_(want))     return true;
  return false;
}

function attendeeEmail_(ev) {
  return (ev.attendees && ev.attendees[0] && (ev.attendees[0].email || '').toLowerCase()) || '';
}

// Team roster lives at team/roster in Firestore. Returns a map of
// ownerId -> { name, email } so build_Event can both render the display name
// and invite the owner's personal calendar.
function fetchRoster_(idToken) {
  const url = 'https://firestore.googleapis.com/v1/projects/' + CONFIG.PROJECT_ID +
              '/databases/(default)/documents/team/roster';
  const res = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + idToken },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) return {};
  const doc = JSON.parse(res.getContentText());
  const members = (doc.fields && doc.fields.members
                  && doc.fields.members.arrayValue
                  && doc.fields.members.arrayValue.values) || [];
  const map = {};
  for (const m of members) {
    const f = m.mapValue && m.mapValue.fields;
    if (!f) continue;
    const id    = f.id    && f.id.stringValue;
    const name  = f.name  && f.name.stringValue;
    const email = f.email && f.email.stringValue;
    if (id) map[id] = { name: name || id, email: (email || '').trim() };
  }
  return map;
}
