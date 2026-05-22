// === TOGGLE TASK MASTER — gamified spatial task manager ===
// Phase 1 (single-user prototype). Canvas + procedural pixel-art.
// Data: localStorage. See CLAUDE.md for design constraints.

// --- TEAM ---
const TEAM = [
  { id: "zaid", name: "Zaid", color: "#5b8def" },
  { id: "yy",   name: "YY",   color: "#e8743b" },
  { id: "vik",  name: "Vik",  color: "#3aa17a" },
  { id: "lina", name: "Lina", color: "#9c6bd8" },
  { id: "sam",  name: "Sam",  color: "#1bb0c2" },
];

// --- CLIENTS ---
const CLIENTS = ["Toggle", "Unitar", "City U"];

// --- CONSTANTS ---
const STORAGE_TASKS    = "toss.tasks.v2";
const STORAGE_ME       = "toss.me.v2";
const STORAGE_STREAKS  = "toss.streaks.v2";

const SCALE = 3;                  // 1 sprite-pixel = SCALE screen px (characters, wall)
const BASKET_SCALE = 4;           // baskets render larger so they read as prominent containers
const CHAR_W = 16 * SCALE;
const CHAR_H = 16 * SCALE;
const BASKET_W = 16 * BASKET_SCALE;
const BASKET_H = 14 * BASKET_SCALE;
const WALL_W = 12 * SCALE;        // center wall column width

const ORB_R = 22;                 // task orb radius
const STACK_OFFSET = 7;           // per-stack-item visual offset (px)
const DRAG_THRESHOLD = 8;

// --- STATE ---
const state = {
  me: localStorage.getItem(STORAGE_ME) || TEAM[0].id,
  tasks: loadTasks(),
  streaks: loadStreaks(),         // userId -> { lastDay: "YYYY-MM-DD", count: number }
  drag: null,                     // { taskId, offX, offY, startX, startY, moved, path: [{x,y,t}] }
  hoverTarget: null,              // { kind, id } highlighted as drop target while dragging
  hoverOrbId: null,               // task id under cursor when not dragging
  dropAnim: {},                   // taskId -> { start: stateT } for landed-on-target pop
  t: 0,                           // game time, ms
  rightOrbHits: [],               // { taskId, x, y, r } populated each render for stack/basket click-targeting
  rightClick: null,               // { taskId, startX, startY } pending click on a right-side orb
};

function loadTasks() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_TASKS) || "[]");
    return raw.map(t => ({
      vx: 0, vy: 0, x: null, y: null,
      client: null,
      ...t,
      history: t.history || [],
    }));
  } catch { return []; }
}

function loadStreaks() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_STREAKS) || "{}");
    let migrated = false;
    for (const id in raw) {
      if (raw[id].best === undefined)          { raw[id].best = raw[id].count || 0; migrated = true; }
      if (raw[id].charges === undefined)       { raw[id].charges = 0; migrated = true; }
      if (raw[id].chargesEarned === undefined) { raw[id].chargesEarned = []; migrated = true; }
    }
    if (migrated) localStorage.setItem(STORAGE_STREAKS, JSON.stringify(raw));
    return raw;
  } catch { return {}; }
}
function saveStreaks() { localStorage.setItem(STORAGE_STREAKS, JSON.stringify(state.streaks)); }

// --- STREAK REWARDS ---
const CHARGE_MILESTONES = [7, 30, 100];
const MAX_CHARGES = 3;

const TITLE_TIERS = [
  { min: 365, text: "MYTHIC",     color: "#ffd070", shimmer: true  },
  { min: 100, text: "LEGEND",     color: "#fff8e0", shimmer: false },
  { min: 60,  text: "CHAMPION",   color: "#c8a0e8", shimmer: false },
  { min: 30,  text: "HERO",       color: "#ffd070", shimmer: false },
  { min: 14,  text: "ADVENTURER", color: "#7ab5e8", shimmer: false },
  { min: 7,   text: "APPRENTICE", color: "#e8943a", shimmer: false },
  { min: 3,   text: "ACOLYTE",    color: "#c8c2dc", shimmer: false },
];
function streakTitle(n) {
  for (const t of TITLE_TIERS) if (n >= t.min) return t;
  return null;
}

function maybeEarnCharges(s) {
  const earned = [];
  for (const m of CHARGE_MILESTONES) {
    if (s.count >= m && !s.chargesEarned.includes(m)) {
      s.chargesEarned.push(m);
      if (s.charges < MAX_CHARGES) { s.charges++; earned.push(m); }
    }
  }
  return earned;
}

// --- STREAKS ---
function dateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function daysBetween(aKey, bKey) {
  const [ay, am, ad] = aKey.split("-").map(Number);
  const [by, bm, bd] = bKey.split("-").map(Number);
  const aMs = new Date(ay, am - 1, ad).getTime();
  const bMs = new Date(by, bm - 1, bd).getTime();
  return Math.round((bMs - aMs) / 86400000);
}

// Display-time streak — silently shows 0 if the user's last check-in was >1 day ago.
// (Charges only auto-spend at next recordCheckin call — display doesn't pre-spend them.)
function getStreak(userId) {
  const s = state.streaks[userId];
  if (!s) return 0;
  const diff = daysBetween(s.lastDay, dateKey());
  if (diff <= 1) return s.count;
  return 0;
}
function getCharges(userId) { return state.streaks[userId]?.charges || 0; }
function getBest(userId)    { return state.streaks[userId]?.best    || 0; }

// Records a check-in for `userId` against today. Returns a result object describing
// what changed so the caller can animate / toast. Idempotent for same day.
function recordCheckin(userId) {
  const today = dateKey();
  let s = state.streaks[userId];
  if (!s) {
    s = { lastDay: today, count: 1, best: 1, charges: 0, chargesEarned: [] };
    state.streaks[userId] = s;
    saveStreaks();
    return { prev: 0, next: 1, bumped: true, earnedMilestones: [] };
  }
  const diff = daysBetween(s.lastDay, today);
  if (diff === 0) return { prev: s.count, next: s.count, bumped: false, earnedMilestones: [] };
  if (diff === 1) {
    const prev = s.count;
    s.count++;
    s.lastDay = today;
    if (s.count > s.best) s.best = s.count;
    const earnedMilestones = maybeEarnCharges(s);
    saveStreaks();
    return { prev, next: s.count, bumped: true, earnedMilestones };
  }
  // Exactly one missed day, with a charge available — bridge it
  if (diff === 2 && s.charges > 0) {
    const prev = s.count;
    s.charges--;
    s.count += 2;                  // charge covers yesterday; today is the next consecutive day
    s.lastDay = today;
    if (s.count > s.best) s.best = s.count;
    const earnedMilestones = maybeEarnCharges(s);
    saveStreaks();
    return { prev, next: s.count, bumped: true, chargeUsed: true, earnedMilestones };
  }
  // Break
  const wasCount = s.count;
  s.count = 1;
  s.lastDay = today;
  saveStreaks();
  return { prev: wasCount, next: 1, broken: true, bumped: true, earnedMilestones: [] };
}

function updateStreakDisplay(animate = false) {
  const el = document.getElementById("streak-display");
  if (!el) return;
  const n = getStreak(state.me);
  el.querySelector(".streak-num").textContent = n;
  el.querySelector(".streak-label").textContent = n === 1 ? "day" : "days";
  el.classList.toggle("zero", n === 0);
  if (animate) {
    el.classList.remove("bump");
    void el.offsetWidth;
    el.classList.add("bump");
  }
}

function updateChargeDisplay() {
  const el = document.getElementById("charge-display");
  if (!el) return;
  const n = getCharges(state.me);
  el.querySelector(".charge-num").textContent = n;
  el.classList.toggle("zero", n === 0);
}

// --- TOASTS ---
function showToast(html, kind = "info", durationMs = 5000) {
  const area = document.getElementById("toast-area");
  if (!area) return;
  const t = document.createElement("div");
  t.className = `toast ${kind}`;
  t.innerHTML = html;
  area.appendChild(t);
  setTimeout(() => t.remove(), durationMs);
}

// Surfaces all the celebrations / notices from a recordCheckin result.
function announceCheckin(prevCount, result) {
  // Don't shame small-streak breaks — below 7 there's no title/charge yet, nothing meaningful was lost.
  if (result.broken && prevCount >= 7) {
    showToast(`<em>[BROKEN]</em> STREAK ENDED AT ${prevCount} DAYS<span class="small">start fresh today</span>`, "broken");
  }
  // Collapse: if a charge was spent AND a milestone was hit in the same call, that's a "torch recharged"
  // event — they spent one and earned one back. Show a single message instead of two.
  const earned = result.earnedMilestones || [];
  if (result.chargeUsed && earned.length > 0) {
    showToast(`<em>[TORCH]</em> RECHARGED<span class="small">streak preserved · ${earned[0]}-day milestone hit</span>`, "charge", 4500);
  } else if (result.chargeUsed) {
    showToast(`<em>[CHARGE]</em> TORCH CHARGE SPENT<span class="small">streak preserved</span>`, "charge", 3500);
  } else if (earned.length > 0) {
    for (const m of earned) {
      const firstTimeHint = m === 7 ? `<span class="small">missed a day? your torch will cover it</span>` : "";
      showToast(`<em>[MILESTONE]</em> ${m}-DAY STREAK<span class="small"><em>+1 torch charge</em> earned</span>${firstTimeHint}`, "milestone", 5000);
    }
  }
  // Title earned — independent of charges
  if (result.bumped && result.next > 0) {
    const newTitle = streakTitle(result.next);
    const oldTitle = streakTitle(prevCount);
    if (newTitle && (!oldTitle || oldTitle.text !== newTitle.text)) {
      showToast(`<em>[TITLE]</em> NEW TITLE<span class="small"><em>${newTitle.text}</em></span>`, "title", 4000);
    }
  }
}

function save() {
  localStorage.setItem(STORAGE_TASKS, JSON.stringify(state.tasks));
  localStorage.setItem(STORAGE_ME, state.me);
}

const memberById = id => TEAM.find(m => m.id === id);
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function startOfToday() { const d = new Date(); d.setHours(0,0,0,0); return d; }
function isOverdue(t) { return t.dueDate && new Date(t.dueDate) < startOfToday(); }
function isDueToday(t) {
  if (!t.dueDate) return false;
  return new Date(t.dueDate).toDateString() === startOfToday().toDateString();
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[c]);
}

// --- COLOR UTILS ---
function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map(c => c+c).join("") : h, 16);
  return { r:(n>>16)&255, g:(n>>8)&255, b:n&255 };
}
function rgbToHex({r,g,b}) {
  return "#" + [r,g,b].map(v => clamp(v|0,0,255).toString(16).padStart(2,"0")).join("");
}
function shade(hex, amount) {
  const c = hexToRgb(hex);
  return rgbToHex({ r: c.r + amount, g: c.g + amount, b: c.b + amount });
}

// === SPRITES ===
// Each sprite is an array of strings. Chars map to palette colors via lookup.
// "." = transparent.

const SPRITE_CHAR = [
  "....HHHHHH......",
  "...HHHHHHHH.....",
  "..HHHHHHHHHH....",
  "..HKFFFFFFKH....",
  "..KFEFFFFEFK....",
  "..KFFFFFFFFK....",
  "..KFFFMMFFFK....",
  "...KFFFFFFK.....",
  "....KFFFFK......",
  "...KSSSSSSK.....",
  "...SSSSSSSS.....",
  "...SSSSSSSS.....",
  "...SSPPPPSS.....",
  "...PPPPPPPP.....",
  "...PPP..PPP.....",
  "..BBB....BBB....",
];

const SPRITE_BASKET = [
  "................",
  "...KKKKKKKKKK...",
  "..K..........K..",
  "..KRRRRRRRRRRK..",
  ".KwRwRwRwRwRwRK.",
  ".KRwRwRwRwRwRwK.",
  ".KwRwRwRwRwRwRK.",
  ".KRwRwRwRwRwRwK.",
  ".KwRwRwRwRwRwRK.",
  ".KRwRwRwRwRwRwK.",
  "..KRRRRRRRRRRK..",
  "...KKKKKKKKKK...",
  "................",
  "................",
];

const SPRITE_TORCH = [
  ".YYY.",
  "YYfYY",
  "YfFfY",
  ".FfF.",
  "..F..",
  ".bbb.",
  ".bBb.",
  ".bbb.",
  ".bBb.",
];

// Tiny streak flame — 4 wide x 6 tall
const SPRITE_FLAME_MINI = [
  "..Y.",
  ".YY.",
  "YfFY",
  "YFFY",
  ".YY.",
  "..Y.",
];
const PAL_FLAME_MINI = {
  ".": null,
  "Y": "#ffd070",
  "f": "#ffa040",
  "F": "#e85a20",
};

// === PALETTES ===
function paletteForChar(shirtColor) {
  return {
    ".": null,
    "H": "#3a2418",                     // hair
    "K": "#0d0a1a",                     // outline
    "F": "#e8c8a8",                     // skin light
    "E": "#0d0a1a",                     // eye
    "M": "#a04030",                     // mouth
    "S": shirtColor,
    "P": "#2a2848",                     // pants
    "B": "#0d0a1a",                     // boots
  };
}

function paletteForBasket(weaveLight, weaveDark) {
  return {
    ".": null,
    "K": "#0d0a1a",
    "d": "#1a1018",                     // dark interior shadow
    "R": weaveDark,
    "w": weaveLight,
  };
}

const PAL_TORCH = {
  ".": null,
  "Y": "#ffd070",
  "f": "#ffa040",
  "F": "#e85a20",
  "b": "#3a2418",
  "B": "#1a0e08",
};

// === CANVAS ===
const canvas = document.getElementById("play");
const ctx = canvas.getContext("2d");
let layout = {};
let bgCache = null;            // pre-rendered floor + wall body (no animated torches)
let bgCtx = null;

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  computeLayout(w, h);
  // Reassign positions for tasks that fell outside new bounds
  for (const t of state.tasks) {
    if (t.ownerId === state.me && t.status === "active") {
      if (t.x == null || t.y == null) assignSpawn(t);
      else clampToZone(t);
    }
  }
  rebuildBgCache(w, h, dpr);
  save();
}

function rebuildBgCache(w, h, dpr) {
  bgCache = document.createElement("canvas");
  bgCache.width = Math.round(w * dpr);
  bgCache.height = Math.round(h * dpr);
  bgCtx = bgCache.getContext("2d");
  bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  bgCtx.imageSmoothingEnabled = false;
  drawFloorTo(bgCtx);
  drawWallTo(bgCtx);
}

function computeLayout(w, h) {
  const cx = w / 2;
  const sideMargin = Math.min(20, w * 0.02);
  layout = {
    w, h, cx,
    wallLeft:  cx - WALL_W / 2,
    wallRight: cx + WALL_W / 2,
    leftZone:  { left: sideMargin,                  right: cx - WALL_W/2 - 8,  top: 16, bottom: h - 16 },
    rightZone: { left: cx + WALL_W/2 + 8,           right: w - sideMargin,     top: 16, bottom: h - 16 },
  };

  const others = TEAM.filter(m => m.id !== state.me);
  const rz = layout.rightZone;
  const rzW = rz.right - rz.left;
  const rzH = rz.bottom - rz.top;

  // Decide basket orientation: side-by-side on wide screens, stacked vertically on narrow ones.
  const basketsStacked = rzW < BASKET_W * 2 + 60;

  // Allocate vertical space: teammates 56%, baskets 44%. Baskets stacked need a bit more.
  const peopleFrac = basketsStacked ? 0.50 : 0.58;
  const peopleH = rzH * peopleFrac;
  const basketsH = rzH - peopleH;

  // Teammate grid: 1 col on narrow right zones, 2 cols otherwise. Cell sizes capped.
  const cols = rzW < 220 ? 1 : Math.min(2, others.length);
  const rows = Math.ceil(others.length / cols);
  const cellW = Math.min(rzW / cols, 220);
  const cellH = Math.min(peopleH / Math.max(rows, 1), 130);
  const gridW = cellW * cols;
  const gridH = cellH * rows;
  const gridLeft = rz.left + (rzW - gridW) / 2;
  const gridTop = rz.top + Math.max(8, (peopleH - gridH) / 2);

  layout.teammates = others.map((m, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      id: m.id, name: m.name, color: m.color,
      x: gridLeft + cellW * col + cellW / 2,
      y: gridTop + cellH * row + cellH / 2,
    };
  });

  // Baskets — clamped so they're always fully visible (sprite + label fit inside the basket band).
  const basketsTop = rz.top + peopleH;
  if (basketsStacked) {
    const slotH = basketsH / 2;
    layout.baskets = [
      {
        id: "done", label: "DONE",
        x: rz.left + rzW / 2,
        y: basketsTop + slotH * 0.5,
        light: "#7ac84a", dark: "#3a7a2a", accent: "#5aa84a",
      },
      {
        id: "blocked", label: "BLOCKED",
        x: rz.left + rzW / 2,
        y: basketsTop + slotH * 1.5,
        light: "#e87340", dark: "#a03020", accent: "#c84a3a",
      },
    ];
  } else {
    const basketGap = Math.min(Math.max(rzW * 0.32, 120), 220);
    const basketY = basketsTop + basketsH / 2 - 10;
    layout.baskets = [
      { id: "done",    label: "DONE",    x: rz.left + rzW / 2 - basketGap / 2, y: basketY,
        light: "#7ac84a", dark: "#3a7a2a", accent: "#5aa84a" },
      { id: "blocked", label: "BLOCKED", x: rz.left + rzW / 2 + basketGap / 2, y: basketY,
        light: "#e87340", dark: "#a03020", accent: "#c84a3a" },
    ];
  }

  // My character — center of left zone (so orbs can drift around me in all directions)
  const lz = layout.leftZone;
  const lzW = lz.right - lz.left;
  layout.me = {
    id: state.me,
    name: memberById(state.me)?.name || "Me",
    color: memberById(state.me)?.color || "#888",
    x: lz.left + Math.min(Math.max(lzW * 0.28, 64), 160),
    y: lz.top + (lz.bottom - lz.top) / 2,
  };
}

// === SPRITE DRAW ===
function drawSprite(sprite, x, y, scale, palette) {
  for (let r = 0; r < sprite.length; r++) {
    const row = sprite[r];
    for (let c = 0; c < row.length; c++) {
      const col = palette[row[c]];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(Math.round(x + c * scale), Math.round(y + r * scale), scale, scale);
    }
  }
}

function drawCharacter(cx, cy, color, bob = 0) {
  drawSprite(SPRITE_CHAR,
    cx - (16 * SCALE) / 2,
    cy - (16 * SCALE) / 2 + bob,
    SCALE,
    paletteForChar(color));
  // Shadow ellipse beneath
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.ellipse(cx, cy + 8 * SCALE + bob * 0.3, 7 * SCALE, 2.5 * SCALE, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawBasket(cx, cy, light, dark) {
  drawSprite(SPRITE_BASKET,
    cx - BASKET_W / 2,
    cy - BASKET_H / 2,
    BASKET_SCALE,
    paletteForBasket(light, dark));
}

function drawTorch(cx, cy, flicker) {
  // The torch sprite is 5 wide x 9 tall; flame at top
  const sx = cx - (5 * SCALE) / 2;
  const sy = cy - (9 * SCALE) / 2;
  // Flicker: redraw flame portion with offset
  drawSprite(SPRITE_TORCH, sx, sy, SCALE, PAL_TORCH);
  // Glow halo
  const glowR = 30 + Math.sin(flicker) * 3;
  const grad = ctx.createRadialGradient(cx, cy - 2 * SCALE, 2, cx, cy - 2 * SCALE, glowR);
  grad.addColorStop(0, "rgba(255, 200, 80, 0.35)");
  grad.addColorStop(1, "rgba(255, 200, 80, 0)");
  ctx.fillStyle = grad;
  ctx.fillRect(cx - glowR, cy - glowR - 2 * SCALE, glowR * 2, glowR * 2);
}

// === FLOOR + WALL ===
// drawFloorTo / drawWallTo render the static background into the bgCache canvas.
// Torches are animated and stay in the main render loop.

function drawFloorTo(targetCtx) {
  const tile = 8 * SCALE;
  targetCtx.fillStyle = "#1a1830";
  targetCtx.fillRect(0, 0, layout.w, layout.h);
  for (let y = 0; y < layout.h; y += tile) {
    for (let x = 0; x < layout.w; x += tile) {
      if (x + tile > layout.wallLeft && x < layout.wallRight) continue;
      const variant = ((x / tile) + (y / tile)) | 0;
      const isAlt = (variant % 5) === 0;
      targetCtx.fillStyle = isAlt ? "#222040" : "#1d1b36";
      targetCtx.fillRect(x, y, tile, tile);
      targetCtx.fillStyle = "#0e0c20";
      targetCtx.fillRect(x, y + tile - SCALE, tile, SCALE);
      targetCtx.fillRect(x + tile - SCALE, y, SCALE, tile);
      if ((variant * 13) % 17 === 0) {
        targetCtx.fillStyle = "#2c2a48";
        targetCtx.fillRect(x + 3 * SCALE, y + 2 * SCALE, SCALE, SCALE);
      }
    }
  }
}

function drawWallTo(targetCtx) {
  const x = layout.wallLeft;
  const w = WALL_W;
  const brickH = 6 * SCALE;
  const brickW = 6 * SCALE;

  targetCtx.fillStyle = "#2a2848";
  targetCtx.fillRect(x, 0, w, layout.h);

  for (let y = 0; y < layout.h; y += brickH) {
    const stagger = (((y / brickH) | 0) % 2) ? brickW / 2 : 0;
    for (let bx = -brickW; bx < w + brickW; bx += brickW) {
      const px = x + bx + stagger;
      targetCtx.fillStyle = "#3a3658";
      targetCtx.fillRect(Math.max(x, px), y, Math.min(brickW - SCALE, x + w - px), brickH - SCALE);
      targetCtx.fillStyle = "#5a5680";
      targetCtx.fillRect(Math.max(x, px), y, Math.min(brickW - SCALE, x + w - px), SCALE);
    }
  }

  targetCtx.fillStyle = "#0d0a1a";
  targetCtx.fillRect(x, 0, SCALE, layout.h);
  targetCtx.fillRect(x + w - SCALE, 0, SCALE, layout.h);
}

function drawTorches() {
  drawTorch(layout.cx, layout.h * 0.22, state.t * 0.012);
  drawTorch(layout.cx, layout.h * 0.78, state.t * 0.012 + 1.3);
}

// === LABELS ===
function drawNameLabel(cx, cy, text, streak = 0) {
  ctx.font = '8px "Press Start 2P", monospace';
  ctx.textBaseline = "middle";

  const showFlame = streak > 0;
  const numText = showFlame ? String(streak) : "";

  ctx.textAlign = "left";
  const textW = ctx.measureText(text).width;
  const numW = showFlame ? ctx.measureText(numText).width : 0;
  const flameW = showFlame ? 10 : 0;     // sprite is 4 wide @ scale 2 = 8 + 2px pad
  const innerGap = showFlame ? 6 : 0;

  const padX = 6;
  const innerW = (showFlame ? flameW + 2 + numW + innerGap : 0) + textW;
  const w = padX * 2 + innerW;
  const h = 14;
  const x = cx - w / 2;
  const y = cy - h / 2;

  // Background tag with pixel-bevel
  ctx.fillStyle = "#0d0a1a";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#3a3658";
  ctx.fillRect(x, y, w, 2);
  ctx.fillRect(x, y + h - 2, w, 2);

  let cursor = x + padX;
  if (showFlame) {
    drawMiniFlame(cursor, y + h / 2);
    cursor += flameW;
    ctx.fillStyle = "#ffd070";
    ctx.fillText(numText, cursor, y + h / 2 + 1);
    cursor += numW + innerGap;
  }
  ctx.fillStyle = "#ede0c0";
  ctx.fillText(text, cursor, y + h / 2 + 1);
}

function drawMiniFlame(leftX, midY) {
  // Sprite is 4w x 6h at scale 2 = 8 x 12 screen px. Vertically center on midY.
  drawSprite(SPRITE_FLAME_MINI, leftX, midY - 6, 2, PAL_FLAME_MINI);
  // Subtle flicker — a bright pixel at the tip when the sine wave peaks
  if (Math.sin(state.t / 130 + leftX) > 0.55) {
    ctx.fillStyle = "rgba(255, 240, 180, 0.85)";
    ctx.fillRect(leftX + 4, midY - 7, 2, 2);
  }
}

// Halo + embers + light beam behind characters with active streaks.
function drawAura(cx, cy, streak) {
  if (streak < 7) return;
  const tier =
    streak >= 365 ? 4 :
    streak >= 100 ? 3 :
    streak >= 30  ? 2 : 1;
  const pulse = (Math.sin(state.t / 700 + cx * 0.01) + 1) * 0.5;        // 0..1
  // Cap radius for low tiers so 4 adjacent characters' auras don't merge into an orange wash.
  let radius = 36 + tier * 10 + pulse * 6;
  if (tier <= 2) radius = Math.min(radius, 44);

  const grad = ctx.createRadialGradient(cx, cy, 4, cx, cy, radius);
  const innerA = tier >= 3 ? 0.30 : tier === 2 ? 0.22 : 0.12;
  grad.addColorStop(0,    `rgba(255, 200, 100, ${innerA * 0.9})`);
  grad.addColorStop(0.45, `rgba(${tier >= 3 ? 255 : 232}, ${tier >= 3 ? 200 : 150}, 60, ${innerA * 0.4})`);
  grad.addColorStop(1,    "rgba(255, 200, 100, 0)");
  ctx.fillStyle = grad;
  ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

  // Drifting embers (tier 2+) — fade to nothing at end of life so they read as sparks not debris
  if (tier >= 2) {
    const emberCount = tier === 2 ? 4 : tier === 3 ? 6 : 8;
    const lifeMs = 2600;
    for (let i = 0; i < emberCount; i++) {
      const phase = ((state.t + i * (lifeMs / emberCount)) % lifeMs) / lifeMs;
      const angleSeed = i * 2.31 + cx * 0.013;
      const ex = cx + Math.sin(angleSeed + phase * 1.5) * (16 + (i % 3) * 4);
      const ey = cy + 12 - phase * 56;
      const alpha = Math.max(0, Math.min(1, 2 - phase * 2.4)) * 0.75;
      const sz = phase < 0.3 ? 2 : 1;
      ctx.fillStyle = `rgba(255, 210, 110, ${alpha})`;
      ctx.fillRect(ex | 0, ey | 0, sz, sz);
    }
  }

  // Light beam from above (tier 4 — Mythic)
  if (tier >= 4) {
    const beam = ctx.createLinearGradient(cx, 0, cx, cy + 10);
    beam.addColorStop(0,   "rgba(255, 240, 180, 0.04)");
    beam.addColorStop(0.5, "rgba(255, 240, 180, 0.26)");
    beam.addColorStop(1,   "rgba(255, 240, 180, 0)");
    ctx.fillStyle = beam;
    ctx.fillRect(cx - 18, 0, 36, cy + 10);
  }
}

// Title bar drawn below the character's feet.
function drawTitleLabel(cx, cyTarget, streak) {
  const title = streakTitle(streak);
  if (!title) return;
  // Clamp so the label stays inside the canvas (small viewports + 4-row teammate grids)
  const h = 12;
  const safeCy = Math.min(cyTarget, layout.h - h);
  if (safeCy + h / 2 > layout.h) return;

  ctx.font = '7px "Press Start 2P", monospace';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const w = ctx.measureText(title.text).width + 12;
  const x = cx - w / 2;
  const y = safeCy - h / 2;

  ctx.fillStyle = "rgba(13, 10, 26, 0.92)";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "rgba(58, 54, 88, 0.9)";
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y + h - 1, w, 1);

  let color = title.color;
  if (title.shimmer) {
    // Smooth lerp gold ↔ cream — no visible frame-snap
    const s = (Math.sin(state.t / 280) + 1) / 2;
    const r = 255;
    const g = Math.round(208 + s * 40);
    const b = Math.round(112 + s * 96);
    color = `rgb(${r}, ${g}, ${b})`;
  }
  ctx.fillStyle = color;
  ctx.fillText(title.text, cx, safeCy + 1);
}

function drawCountBadge(cx, cy, n) {
  if (!n) return;
  ctx.font = '8px "Press Start 2P", monospace';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const r = 10;
  ctx.fillStyle = "#e85a20";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#0d0a1a";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#ede0c0";
  ctx.fillText(String(n), cx, cy + 1);
}

// === ORBS ===
function wrapText(text, maxLen) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxLen) {
      if (cur) lines.push(cur);
      cur = w;
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawOrb(x, y, task, scale = 1, options = {}) {
  const color = memberById(task.createdBy)?.color || "#888";
  const r = ORB_R * scale;

  // outer dark ring
  ctx.fillStyle = shade(color, -60);
  ctx.beginPath();
  ctx.arc(x, y, r + 2, 0, Math.PI * 2);
  ctx.fill();

  // body gradient
  const grad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 2, x, y, r);
  grad.addColorStop(0, shade(color, 60));
  grad.addColorStop(0.55, color);
  grad.addColorStop(1, shade(color, -40));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  // highlight spot
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.beginPath();
  ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.18, 0, Math.PI * 2);
  ctx.fill();

  // due-date rim
  if (isOverdue(task)) {
    ctx.strokeStyle = "#e84a3a";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, r + 1, 0, Math.PI * 2);
    ctx.stroke();
  } else if (isDueToday(task)) {
    ctx.strokeStyle = "#e8b840";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, r + 1, 0, Math.PI * 2);
    ctx.stroke();
  }

  // title text
  if (scale >= 0.85) {
    ctx.font = '7px "Press Start 2P", monospace';
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const lines = wrapText(task.title, 9).slice(0, 3);
    const lineH = 9;
    const startY = y - ((lines.length - 1) * lineH) / 2;
    lines.forEach((line, i) => ctx.fillText(line.slice(0, 12), x, startY + i * lineH));
  }
}

// === PHYSICS ===
function assignSpawn(t) {
  const b = layout.leftZone;
  if (!b) return;
  t.x = b.left + ORB_R + 8 + Math.random() * Math.max(20, b.right - b.left - 2 * ORB_R - 16);
  t.y = b.top  + ORB_R + 8 + Math.random() * Math.max(20, b.bottom - b.top - 2 * ORB_R - 16) * 0.55;
  t.vx = (Math.random() - 0.5) * 0.6;
  t.vy = (Math.random() - 0.5) * 0.6;
}

function clampToZone(t) {
  const b = layout.leftZone;
  t.x = clamp(t.x, b.left + ORB_R, b.right - ORB_R);
  t.y = clamp(t.y, b.top  + ORB_R, b.bottom - ORB_R);
}

function step(dt) {
  const b = layout.leftZone;
  if (!b) return;
  for (const t of state.tasks) {
    if (t.status !== "active") continue;
    if (t.ownerId !== state.me) continue;
    if (state.drag && state.drag.taskId === t.id) continue;
    // Newly-arrived tasks (e.g. taken back from a basket) need a spawn position
    if (t.x == null || t.y == null) assignSpawn(t);

    // Gentle wander force + slight pull toward center — quiet enough to read as floating dust
    t.vx = (t.vx || 0) + (Math.random() - 0.5) * 0.025;
    t.vy = (t.vy || 0) + (Math.random() - 0.5) * 0.025;
    const ccx = (b.left + b.right) / 2;
    const ccy = (b.top + b.bottom) / 2;
    t.vx += (ccx - t.x) * 0.00004;
    t.vy += (ccy - t.y) * 0.00004;

    // Damping — high enough that motion settles to a slow drift
    t.vx *= 0.992;
    t.vy *= 0.992;

    // Soft speed cap — high ceiling so thrown orbs carry; drift stays well below this naturally.
    // When over the cap, decay gradually toward it rather than hard-clamping (preserves throw feel).
    const speed = Math.hypot(t.vx, t.vy);
    const driftCap = 6;
    if (speed > driftCap) {
      const factor = Math.max(driftCap / speed, 0.94);
      t.vx *= factor;
      t.vy *= factor;
    }

    t.x += t.vx;
    t.y += t.vy;

    // Wall bounces (never cross)
    if (t.x < b.left + ORB_R)   { t.x = b.left + ORB_R;   t.vx =  Math.abs(t.vx) * 0.6; }
    if (t.x > b.right - ORB_R)  { t.x = b.right - ORB_R;  t.vx = -Math.abs(t.vx) * 0.6; }
    if (t.y < b.top + ORB_R)    { t.y = b.top + ORB_R;    t.vy =  Math.abs(t.vy) * 0.6; }
    if (t.y > b.bottom - ORB_R) { t.y = b.bottom - ORB_R; t.vy = -Math.abs(t.vy) * 0.6; }
  }
}

// === DERIVED VIEWS ===
function tasksOnMyLeft() {
  return state.tasks.filter(t => t.ownerId === state.me && t.status === "active");
}
function tasksOnTeammate(id) {
  return state.tasks.filter(t => t.ownerId === id && t.status === "active");
}
function tasksInBasket(status) {
  return state.tasks.filter(t => t.status === status);
}

// === RENDER ===
function render() {
  // Reset per-frame hit registry for right-side (stack + basket) orbs
  state.rightOrbHits.length = 0;

  // Static background (floor + wall body) from cache; animated torches on top.
  if (bgCache) {
    ctx.drawImage(bgCache, 0, 0, layout.w, layout.h);
  }
  drawTorches();

  // Me + my floating orbs
  const bob = Math.sin(state.t / 360) * 2;
  const meStreak = getStreak(layout.me.id);
  drawAura(layout.me.x, layout.me.y, meStreak);
  drawCharacter(layout.me.x, layout.me.y, layout.me.color, bob);
  drawNameLabel(layout.me.x, layout.me.y - CHAR_H / 2 - 14, layout.me.name, meStreak);
  drawTitleLabel(layout.me.x, layout.me.y + CHAR_H / 2 + 12, meStreak);

  // Floating tasks on left
  for (const t of tasksOnMyLeft()) {
    if (state.drag && state.drag.taskId === t.id) continue;
    drawOrb(t.x, t.y, t);
  }

  // Teammates + their attached stacks
  for (const tm of layout.teammates) {
    const tbob = Math.sin(state.t / 360 + tm.x) * 2;
    const tmStreak = getStreak(tm.id);
    drawAura(tm.x, tm.y, tmStreak);
    drawCharacter(tm.x, tm.y, tm.color, tbob);
    drawNameLabel(tm.x, tm.y - CHAR_H / 2 - 14, tm.name, tmStreak);
    drawTitleLabel(tm.x, tm.y + CHAR_H / 2 + 12, tmStreak);

    // Hover highlight ring
    if (state.hoverTarget && state.hoverTarget.kind === "person" && state.hoverTarget.id === tm.id) {
      ctx.strokeStyle = "#ffd070";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(tm.x, tm.y + 2, CHAR_W * 0.6, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Stack of orbs piled to the right of the teammate — reads as carried loot
    const stack = tasksOnTeammate(tm.id);
    const visibleStack = stack.slice(0, 8);
    visibleStack.forEach((t, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const ox = tm.x + CHAR_W * 0.55 + col * 14;
      const oy = tm.y - 4 - row * 12 + tbob;
      drawOrb(ox, oy, t, 0.42 * getDropScale(t.id));
      state.rightOrbHits.push({ taskId: t.id, x: ox, y: oy, r: ORB_R * 0.42 + 4 });
    });
    if (stack.length > 0) {
      const badgeX = tm.x + CHAR_W * 0.55 + 16;
      const badgeY = tm.y - 4 - Math.floor((visibleStack.length - 1) / 2) * 12 - 16;
      drawCountBadge(badgeX, badgeY, stack.length);
    }
  }

  // Baskets + their contents
  for (const bk of layout.baskets) {
    drawBasket(bk.x, bk.y, bk.light, bk.dark);

    // Hover highlight
    if (state.hoverTarget && state.hoverTarget.kind === "bucket" && state.hoverTarget.id === bk.id) {
      ctx.strokeStyle = "#ffd070";
      ctx.lineWidth = 3;
      ctx.strokeRect(bk.x - BASKET_W / 2 - 2, bk.y - BASKET_H / 2 - 2, BASKET_W + 4, BASKET_H + 4);
    }

    // Orbs piled inside, peeking out of the open top — spaced for the bigger basket
    const items = tasksInBasket(bk.id);
    const visibleItems = items.slice(0, 9);
    const colStep = BASKET_W / 4;
    visibleItems.forEach((t, i) => {
      const row = Math.floor(i / 3);
      const col = i % 3;
      const ox = bk.x - colStep + col * colStep + (row % 2 ? colStep / 3 : 0);
      const oy = bk.y - 10 - row * 11;
      drawOrb(ox, oy, t, 0.48 * getDropScale(t.id));
      state.rightOrbHits.push({ taskId: t.id, x: ox, y: oy, r: ORB_R * 0.48 + 4 });
    });

    // Label below
    drawNameLabel(bk.x, bk.y + BASKET_H / 2 + 14, bk.label);
    if (items.length > 0) drawCountBadge(bk.x + BASKET_W / 2 + 4, bk.y - BASKET_H / 2 + 2, items.length);
  }

  // Dragged orb on top
  if (state.drag) {
    const t = state.tasks.find(x => x.id === state.drag.taskId);
    if (t) drawOrb(t.x, t.y, t, 1.1);
  }

  // Hover tooltip — full title above the orb under cursor when not dragging
  if (!state.drag && state.hoverOrbId) {
    const t = state.tasks.find(x => x.id === state.hoverOrbId);
    if (t && t.ownerId === state.me && t.status === "active") {
      drawHoverTooltip(t);
    }
  }
}

function drawHoverTooltip(t) {
  ctx.font = '8px "Press Start 2P", monospace';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const text = t.title.length > 36 ? t.title.slice(0, 33) + "..." : t.title;
  const w = ctx.measureText(text).width + 16;
  const h = 18;
  const x = clamp(t.x - w / 2, 8, layout.w - w - 8);
  const y = clamp(t.y - ORB_R - 22, 8, layout.h - h - 8);
  ctx.fillStyle = "#0d0a1a";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#3a3658";
  ctx.fillRect(x, y, w, 2);
  ctx.fillRect(x, y + h - 2, w, 2);
  ctx.fillRect(x, y, 2, h);
  ctx.fillRect(x + w - 2, y, 2, h);
  ctx.fillStyle = "#ede0c0";
  ctx.fillText(text, x + w / 2, y + h / 2 + 1);
}

// === MAIN LOOP ===
let lastT = performance.now();
function tick(now) {
  const dt = Math.min(50, now - lastT);
  lastT = now;
  state.t += dt;
  step(dt);
  render();
  requestAnimationFrame(tick);
}

// === INPUT ===
function pointerPos(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function pickOrbAt(x, y) {
  // Iterate in reverse render order so top orbs win
  const tasks = tasksOnMyLeft();
  for (let i = tasks.length - 1; i >= 0; i--) {
    const t = tasks[i];
    if (Math.hypot(t.x - x, t.y - y) <= ORB_R + 2) return t;
  }
  return null;
}

function pickRightOrbAt(x, y) {
  // Iterate in reverse so most-recently-drawn (topmost) hits first
  for (let i = state.rightOrbHits.length - 1; i >= 0; i--) {
    const h = state.rightOrbHits[i];
    if (Math.hypot(h.x - x, h.y - y) <= h.r) {
      return state.tasks.find(t => t.id === h.taskId) || null;
    }
  }
  return null;
}

function hitTestTarget(x, y) {
  // Teammates — generous hit radius so the player doesn't fight the target
  for (const tm of layout.teammates) {
    const r = CHAR_W * 0.9;
    if (Math.hypot(tm.x - x, tm.y - y) <= r) return { kind: "person", id: tm.id };
  }
  // Baskets — extended by orb radius so the orb center can land at the visual rim
  for (const bk of layout.baskets) {
    if (
      x >= bk.x - BASKET_W / 2 - ORB_R && x <= bk.x + BASKET_W / 2 + ORB_R &&
      y >= bk.y - BASKET_H / 2 - ORB_R && y <= bk.y + BASKET_H / 2 + ORB_R
    ) return { kind: "bucket", id: bk.id };
  }
  return null;
}

canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  const p = pointerPos(e);
  const t = pickOrbAt(p.x, p.y);
  if (t) {
    state.drag = {
      taskId: t.id,
      offX: p.x - t.x,
      offY: p.y - t.y,
      startX: p.x,
      startY: p.y,
      moved: false,
      path: [{ x: p.x, y: p.y, t: performance.now() }],
    };
    state.hoverOrbId = null;
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add("grabbing");
    return;
  }
  // Right-side orbs (on teammates or in baskets) are click-only — opens detail with take-back
  const rt = pickRightOrbAt(p.x, p.y);
  if (rt) {
    state.rightClick = { taskId: rt.id, startX: p.x, startY: p.y };
    canvas.setPointerCapture(e.pointerId);
  }
});

canvas.addEventListener("pointermove", (e) => {
  const p = pointerPos(e);
  if (state.drag) {
    const t = state.tasks.find(x => x.id === state.drag.taskId);
    if (!t) return;
    if (!state.drag.moved) {
      if (Math.hypot(p.x - state.drag.startX, p.y - state.drag.startY) > DRAG_THRESHOLD) {
        state.drag.moved = true;
      }
    }
    t.x = p.x - state.drag.offX;
    t.y = p.y - state.drag.offY;
    t.vx = 0; t.vy = 0;
    state.hoverTarget = hitTestTarget(t.x, t.y);
    // Track last few pointer samples to compute release velocity
    state.drag.path.push({ x: p.x, y: p.y, t: performance.now() });
    if (state.drag.path.length > 6) state.drag.path.shift();
  } else {
    // hover cursor + tooltip target
    const orb = pickOrbAt(p.x, p.y);
    canvas.classList.toggle("over-orb", !!orb);
    state.hoverOrbId = orb ? orb.id : null;
  }
});

canvas.addEventListener("pointerup", (e) => {
  // Resolve a pending right-side click first
  if (state.rightClick && !state.drag) {
    const p = pointerPos(e);
    const click = state.rightClick;
    state.rightClick = null;
    canvas.releasePointerCapture(e.pointerId);
    if (Math.hypot(p.x - click.startX, p.y - click.startY) < DRAG_THRESHOLD) {
      openDetail(click.taskId);
    }
    return;
  }
  if (!state.drag) return;
  const p = pointerPos(e);
  canvas.releasePointerCapture(e.pointerId);
  canvas.classList.remove("grabbing");
  const t = state.tasks.find(x => x.id === state.drag.taskId);
  const drag = state.drag;
  state.drag = null;
  state.hoverTarget = null;
  if (!t) return;

  if (!drag.moved) {
    openDetail(t.id);
    return;
  }

  const target = hitTestTarget(p.x, p.y);
  if (target) {
    handleDrop(t, target);
  } else {
    // Released without a target.
    if (t.x > layout.wallLeft) {
      // On the right side without hitting anything — boomerang home.
      assignSpawn(t);
    } else {
      // Stayed on my side — inherit pointer velocity so the release feels like a toss.
      const path = drag.path;
      if (path && path.length >= 2) {
        const last = path[path.length - 1];
        const earlier = path[Math.max(0, path.length - 4)];
        const dt_ms = Math.max(1, last.t - earlier.t);
        const fr = 16.67;  // 60fps frame
        t.vx = ((last.x - earlier.x) / dt_ms) * fr;
        t.vy = ((last.y - earlier.y) / dt_ms) * fr;
        const sp = Math.hypot(t.vx, t.vy);
        const throwCap = 6;
        if (sp > throwCap) { t.vx *= throwCap / sp; t.vy *= throwCap / sp; }
      }
      clampToZone(t);
    }
    save();
  }
});

canvas.addEventListener("pointercancel", () => {
  state.drag = null;
  state.rightClick = null;
  state.hoverTarget = null;
  canvas.classList.remove("grabbing");
});

function handleDrop(t, target) {
  const now = Date.now();
  if (target.kind === "person") {
    if (target.id === t.ownerId) { clampToZone(t); save(); return; }
    t.history.push({ from: t.ownerId, to: target.id, at: now, kind: "transfer" });
    t.ownerId = target.id;
    t.x = null; t.y = null; t.vx = 0; t.vy = 0;
  } else if (target.kind === "bucket") {
    t.history.push({ from: t.ownerId, to: target.id, at: now, kind: "status" });
    t.status = target.id; // "done" | "blocked"
  }
  t.updatedAt = now;
  state.dropAnim[t.id] = { start: state.t };
  save();
}

// Pull a task back to my left zone — either from a teammate (request-back) or a basket (reopen)
function takeBack(taskId) {
  const t = state.tasks.find(x => x.id === taskId);
  if (!t) return;
  const now = Date.now();
  const kind = t.status === "active" ? "request-back" : "reopen";
  t.history.push({ from: t.ownerId, to: state.me, at: now, kind });
  t.ownerId = state.me;
  t.status = "active";
  t.x = null; t.y = null; t.vx = 0; t.vy = 0;
  assignSpawn(t);
  t.updatedAt = now;
  state.dropAnim[t.id] = { start: state.t };
  save();
}

function getDropScale(taskId) {
  const a = state.dropAnim[taskId];
  if (!a) return 1;
  const elapsed = state.t - a.start;
  const dur = 320;
  if (elapsed >= dur) { delete state.dropAnim[taskId]; return 1; }
  const p = elapsed / dur;
  // Pop: scale up fast, settle with a slight bounce
  return 1 + Math.sin(p * Math.PI) * 0.45 * (1 - p * 0.4);
}

// === NEW TASK ===
function $(s) { return document.querySelector(s); }

function renderIdentity() {
  const sel = $("#identity");
  sel.innerHTML = TEAM.map(m =>
    `<option value="${m.id}" ${m.id === state.me ? "selected" : ""}>${m.name}</option>`
  ).join("");
  sel.onchange = (e) => {
    state.me = e.target.value;
    save();
    // Switching identity in phase 1 counts as a check-in for the newly-active user.
    // (Phase 2 with real auth won't have identity-switching; the load-time check-in handles it.)
    const prevCount = state.streaks[state.me]?.count || 0;
    const result = recordCheckin(state.me);
    updateStreakDisplay(result.bumped);
    updateChargeDisplay();
    announceCheckin(prevCount, result);
    computeLayout(layout.w, layout.h);
    for (const t of state.tasks) {
      if (t.ownerId === state.me && t.status === "active" && (t.x == null || t.y == null)) {
        assignSpawn(t);
      }
    }
    save();
  };
}

$("#new-task").addEventListener("click", () => {
  $("#task-form").reset();
  $("#task-dialog").showModal();
});
$("#cancel-task").addEventListener("click", () => $("#task-dialog").close());
$("#task-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const data = new FormData(e.target);
  const title = (data.get("title") || "").trim();
  if (!title) return;
  const now = Date.now();
  const task = {
    id: uid(),
    title,
    description: (data.get("description") || "").trim(),
    client: data.get("client") || null,
    dueDate: data.get("dueDate") || null,
    status: "active",
    ownerId: state.me,
    createdBy: state.me,
    history: [],
    x: null, y: null, vx: 0, vy: 0,
    createdAt: now, updatedAt: now,
  };
  assignSpawn(task);
  state.tasks.push(task);
  save();
  $("#task-dialog").close();
});

// === DETAIL ===
function openDetail(taskId) {
  const t = state.tasks.find(x => x.id === taskId);
  if (!t) return;
  const due = t.dueDate
    ? new Date(t.dueDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : "no due date";
  const creator = memberById(t.createdBy)?.name || t.createdBy;
  const history = t.history.length
    ? `<ul>${t.history.map(h => {
        const fromName = memberById(h.from)?.name || h.from;
        const isStatusKind = h.kind === "status";
        const toLabel = isStatusKind ? h.to.toUpperCase() : (memberById(h.to)?.name || h.to);
        const verb =
          h.kind === "request-back" ? " (took back)" :
          h.kind === "reopen"       ? " (reopened)"   : "";
        const when = new Date(h.at).toLocaleString();
        return `<li>${escapeHtml(fromName)} → ${escapeHtml(toLabel)}${verb}<br><span style="color:#777">${escapeHtml(when)}</span></li>`;
      }).join("")}</ul>`
    : `<em style="color:#777">no transfers yet</em>`;

  // Context-aware action button
  let backBtn = "";
  if (t.status === "done" || t.status === "blocked") {
    backBtn = `<button class="close" id="take-back">take back</button>`;
  } else if (t.ownerId !== state.me && t.status === "active") {
    const ownerName = memberById(t.ownerId)?.name || t.ownerId;
    backBtn = `<button class="close" id="take-back">request back from ${escapeHtml(ownerName)}</button>`;
  }

  const clientLine = t.client ? ` · CLIENT ${escapeHtml(t.client)}` : "";
  $("#detail-content").innerHTML = `
    <h3>${escapeHtml(t.title)}</h3>
    <div class="meta">FROM ${escapeHtml(creator)} · DUE ${escapeHtml(due)}${clientLine}</div>
    <div class="desc">${t.description ? escapeHtml(t.description) : '<em style="color:#777">no description</em>'}</div>
    <div class="history"><strong>HISTORY</strong>${history}</div>
    <div class="actions">
      <button class="delete" id="del-task">delete</button>
      ${backBtn}
      <button class="${backBtn ? '' : 'close'}" id="close-detail">close</button>
    </div>
  `;
  $("#detail-dialog").showModal();
  $("#del-task").onclick = () => {
    if (confirm("Delete this quest?")) {
      state.tasks = state.tasks.filter(x => x.id !== taskId);
      save();
      $("#detail-dialog").close();
    }
  };
  const tb = document.getElementById("take-back");
  if (tb) tb.onclick = () => {
    takeBack(taskId);
    $("#detail-dialog").close();
  };
  $("#close-detail").onclick = () => $("#detail-dialog").close();
}

// === LEDGER ===
const ledgerState = {
  sortBy: "updatedAt",
  sortDir: "desc",
  filterClient: "all",   // "all" | "Toggle" | "Unitar" | "City U" | "none"
  filterStatus: "all",   // "all" | "active" | "done" | "blocked"
};

function openLedger() {
  renderLedger();
  $("#ledger-dialog").showModal();
}

function ledgerFilteredSorted() {
  const filtered = state.tasks.filter(t => {
    if (ledgerState.filterClient !== "all") {
      const want = ledgerState.filterClient === "none" ? "" : ledgerState.filterClient;
      if ((t.client || "") !== want) return false;
    }
    if (ledgerState.filterStatus !== "all" && t.status !== ledgerState.filterStatus) return false;
    return true;
  });
  const k = ledgerState.sortBy;
  const dir = ledgerState.sortDir === "asc" ? 1 : -1;
  return filtered.sort((a, b) => {
    let av = a[k];
    let bv = b[k];
    if (k === "ownerId" || k === "createdBy") {
      av = memberById(av)?.name || "";
      bv = memberById(bv)?.name || "";
    }
    av = av ?? "";
    bv = bv ?? "";
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
}

function renderLedger() {
  const rows = ledgerFilteredSorted();

  const filterClientOpts = [
    `<option value="all" ${ledgerState.filterClient === "all" ? "selected" : ""}>All clients</option>`,
    ...CLIENTS.map(c => `<option value="${c}" ${ledgerState.filterClient === c ? "selected" : ""}>${c}</option>`),
    `<option value="none" ${ledgerState.filterClient === "none" ? "selected" : ""}>(none)</option>`,
  ].join("");

  const filterStatusOpts = ["all","active","done","blocked"].map(s =>
    `<option value="${s}" ${ledgerState.filterStatus === s ? "selected" : ""}>${s === "all" ? "All statuses" : s}</option>`
  ).join("");

  const arrow = (key) => ledgerState.sortBy === key
    ? `<span class="sort-arrow">${ledgerState.sortDir === "asc" ? "▲" : "▼"}</span>`
    : "";

  const head = `
    <thead>
      <tr>
        <th data-sort="status">Status${arrow("status")}</th>
        <th data-sort="title">Title${arrow("title")}</th>
        <th data-sort="client">Client${arrow("client")}</th>
        <th data-sort="ownerId">Owner${arrow("ownerId")}</th>
        <th data-sort="createdBy">By${arrow("createdBy")}</th>
        <th data-sort="dueDate">Due${arrow("dueDate")}</th>
        <th>History</th>
        <th data-sort="updatedAt">Updated${arrow("updatedAt")}</th>
      </tr>
    </thead>`;

  const body = rows.length
    ? `<tbody>${rows.map(renderLedgerRow).join("")}</tbody>`
    : "";

  $("#ledger-content").innerHTML = `
    <div id="ledger-toolbar">
      <button id="close-ledger">← BACK</button>
      <h2>TASK LEDGER</h2>
      <select id="filter-client">${filterClientOpts}</select>
      <select id="filter-status">${filterStatusOpts}</select>
      <button id="export-csv">⇩ EXPORT CSV</button>
    </div>
    <div id="ledger-table-wrap">
      ${rows.length
        ? `<table id="ledger-table">${head}${body}</table>`
        : `<div id="ledger-empty">No quests match the current filters.</div>`}
    </div>
  `;

  document.getElementById("close-ledger").onclick = () => $("#ledger-dialog").close();
  document.getElementById("filter-client").onchange = (e) => { ledgerState.filterClient = e.target.value; renderLedger(); };
  document.getElementById("filter-status").onchange = (e) => { ledgerState.filterStatus = e.target.value; renderLedger(); };
  document.getElementById("export-csv").onclick = exportCsv;

  document.querySelectorAll("#ledger-table th[data-sort]").forEach(th => {
    th.onclick = () => {
      const key = th.dataset.sort;
      if (ledgerState.sortBy === key) {
        ledgerState.sortDir = ledgerState.sortDir === "asc" ? "desc" : "asc";
      } else {
        ledgerState.sortBy = key;
        ledgerState.sortDir = "asc";
      }
      renderLedger();
    };
  });

  document.querySelectorAll("#ledger-table tbody tr[data-id]").forEach(tr => {
    tr.onclick = () => openDetail(tr.dataset.id);
  });
}

function renderLedgerRow(t) {
  const owner = memberById(t.ownerId)?.name || t.ownerId;
  const creator = memberById(t.createdBy)?.name || t.createdBy;
  const due = t.dueDate
    ? new Date(t.dueDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : "—";
  const updated = new Date(t.updatedAt).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
  });
  const historyTxt = t.history.length
    ? t.history.map(h => {
        const f = memberById(h.from)?.name || h.from;
        const to = h.kind === "status" ? h.to.toUpperCase() : (memberById(h.to)?.name || h.to);
        const tag =
          h.kind === "request-back" ? " (back)" :
          h.kind === "reopen"       ? " (reopen)" : "";
        return `${f}→${to}${tag}`;
      }).join("  ·  ")
    : "—";
  return `<tr data-id="${escapeHtml(t.id)}">
    <td><span class="badge ${t.status}">${t.status}</span></td>
    <td class="title-cell">${escapeHtml(t.title)}</td>
    <td>${escapeHtml(t.client || "—")}</td>
    <td>${escapeHtml(owner)}</td>
    <td>${escapeHtml(creator)}</td>
    <td>${escapeHtml(due)}</td>
    <td class="history-cell">${escapeHtml(historyTxt)}</td>
    <td>${escapeHtml(updated)}</td>
  </tr>`;
}

function exportCsv() {
  const headers = [
    "id","title","client","status","owner","createdBy",
    "dueDate","createdAt","updatedAt","description","history",
  ];
  const esc = (s) => {
    if (s == null) return "";
    const str = String(s);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };
  const lines = state.tasks.map(t => {
    const historyTxt = t.history.map(h => {
      const f = memberById(h.from)?.name || h.from;
      const to = h.kind === "status" ? h.to.toUpperCase() : (memberById(h.to)?.name || h.to);
      const when = new Date(h.at).toISOString();
      return `${f}->${to}@${when}(${h.kind})`;
    }).join(" | ");
    return [
      t.id,
      t.title,
      t.client || "",
      t.status,
      memberById(t.ownerId)?.name || t.ownerId,
      memberById(t.createdBy)?.name || t.createdBy,
      t.dueDate || "",
      new Date(t.createdAt).toISOString(),
      new Date(t.updatedAt).toISOString(),
      t.description || "",
      historyTxt,
    ].map(esc).join(",");
  });
  const csv = headers.join(",") + "\n" + lines.join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ttm-tasks-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

$("#open-ledger").addEventListener("click", openLedger);

// === TAVERN ===
function openTavern() { renderTavern(); $("#tavern-dialog").showModal(); }

function renderTavern() {
  const me = state.me;
  const streak = getStreak(me);
  const best = getBest(me);
  const charges = getCharges(me);
  const title = streakTitle(streak);

  const ladder = TITLE_TIERS.slice().reverse().map(t => {
    const isCurrent = title && title.text === t.text;
    const unlocked = streak >= t.min;
    const cls = isCurrent ? "current" : unlocked ? "unlocked" : "locked";
    const statusTxt = isCurrent ? "▶ current" : unlocked ? "unlocked" : `at ${t.min}d`;
    return `<div class="title-row ${cls}">
      <div class="req">${t.min}d+</div>
      <div class="name" style="color: ${t.color}">${t.text}</div>
      <div class="status">${statusTxt}</div>
    </div>`;
  }).join("");

  const party = TEAM.map(m => {
    const s = getStreak(m.id);
    const b = getBest(m.id);
    const tt = streakTitle(s);
    const isMe = m.id === me;
    return `<div class="party-row ${isMe ? "me" : ""}">
      <div class="avatar" style="background:${m.color}">${m.name.slice(0,2).toUpperCase()}</div>
      <div>
        <div class="name">${escapeHtml(m.name)}${isMe ? " · YOU" : ""}</div>
        <div class="title-tag">${tt ? tt.text : "—"}</div>
      </div>
      <div class="streak ${s === 0 ? "zero" : ""}">🔥 ${s}</div>
      <div class="best">BEST ${b}</div>
    </div>`;
  }).join("");

  const slots = Array.from({ length: MAX_CHARGES }, (_, i) =>
    `<div class="charge-slot ${i < charges ? "lit" : "unlit"}"></div>`
  ).join("");

  // Quest stats — local view (everything Zaid sees on his machine in phase 1)
  const myCreated = state.tasks.filter(t => t.createdBy === me).length;
  const myCompleted = state.tasks.filter(t =>
    t.history.some(h => h.from === me && h.kind === "status" && h.to === "done")
  ).length;
  const myHandedOff = state.tasks.filter(t =>
    t.history.some(h => h.from === me && h.kind === "transfer")
  ).length;

  $("#tavern-content").innerHTML = `
    <div id="tavern-toolbar">
      <button id="close-tavern">← BACK</button>
      <h2>TAVERN — HALL OF TROPHIES</h2>
    </div>
    <div id="tavern-body">
      <div class="tavern-panel">
        <h3>YOUR STREAK</h3>
        <div class="streak-big">
          <div class="num">${streak}</div>
          <div class="unit">${streak === 1 ? "day" : "days"}</div>
        </div>
        <div class="kv-grid">
          <div>BEST EVER<strong>${best}</strong></div>
          <div>CURRENT TITLE<strong style="color: ${title ? title.color : '#6a6680'}">${title ? title.text : "— none yet —"}</strong></div>
        </div>
      </div>

      <div class="tavern-panel">
        <h3>TORCH CHARGES</h3>
        <div class="charge-slots">${slots}</div>
        <p class="charge-blurb">
          MISS A DAY AND A TORCH BRIDGES IT.<br>
          EARN ONE AT DAY 7, 30, AND 100. MAX ${MAX_CHARGES} HELD.
        </p>
      </div>

      <div class="tavern-panel">
        <h3>YOUR QUESTS</h3>
        <div class="kv-grid" style="grid-template-columns: 1fr;">
          <div>CREATED<strong>${myCreated}</strong></div>
          <div>COMPLETED BY YOU<strong>${myCompleted}</strong></div>
          <div>HANDED OFF<strong>${myHandedOff}</strong></div>
        </div>
      </div>

      <div class="tavern-panel wide">
        <h3>TITLES</h3>
        <div class="title-ladder">${ladder}</div>
      </div>

      <div class="tavern-panel wide">
        <h3>THE PARTY</h3>
        <div class="party-list">${party}</div>
      </div>
    </div>
  `;

  $("#close-tavern").onclick = () => $("#tavern-dialog").close();
}

$("#streak-display").addEventListener("click", openTavern);

// Re-render ledger after detail dialog closes (in case the task was edited/deleted/taken-back)
$("#detail-dialog").addEventListener("close", () => {
  if ($("#ledger-dialog").open) renderLedger();
});

// === INIT ===
renderIdentity();
window.addEventListener("resize", resize);
resize();
// Daily check-in — loading the app is your "I'm here" signal.
const prevInit = state.streaks[state.me]?.count || 0;
const initialCheckin = recordCheckin(state.me);
updateStreakDisplay(initialCheckin.bumped);
updateChargeDisplay();
announceCheckin(prevInit, initialCheckin);
requestAnimationFrame((t) => { lastT = t; tick(t); });
