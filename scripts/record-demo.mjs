#!/usr/bin/env node
/**
 * Records the product-tour video of Command Center in demo mode (synthetic data), dark theme.
 *
 * A scripted, re-runnable walk through every area of the app with a visible cursor that moves at a human pace
 * (eased, slightly curved paths, hover before click, typing per character). Output is a raw recording plus the
 * material scripts/edit-demo.sh needs to cut the final video:
 *
 *   <work>/raw.webm        Playwright recordVideo of the whole tour (1440x900)
 *   <work>/chapters.json   chapter list with start/end offsets (seconds) into raw.webm, titles and subtitles
 *   <work>/cards/*.png     title card, end card and one lower-third overlay per chapter (rendered here with Chrome)
 *
 * Usage:
 *   npx dt-app build && node scripts/preview-server.mjs --port 4310 &      # offline preview, demo mode
 *   NODE_PATH=$(npm root -g) node scripts/record-demo.mjs [--base http://127.0.0.1:4310] [--work /tmp/cc-demo]
 *        [--chrome /usr/bin/google-chrome] [--only console,teams] [--pace 0.9]
 *   bash scripts/edit-demo.sh [/tmp/cc-demo]                                 # → docs/media/
 *
 *   --only   record only these chapters (comma-separated ids) to iterate quickly; each starts from its own route.
 *   --pace   multiplies every pause and mouse move (default 0.9, about 2:40 of final video; 0.4 for a fast dry run).
 *
 * Before the take, a throw-away tab visits every route so lazy-loaded chunks are cached (no spinners on camera).
 * Before "Services" the page reloads off camera: the demo fixtures are dated at load time, and after about 3 minutes
 * the app would show a "Paging engine is not running" toast.
 *
 * Dark theme: Strato's useCurrentTheme() asks the platform user preferences first; the offline preview has no
 * platform runtime, so it falls back to the `prefers-color-scheme` media query. The browser context is created with
 * `colorScheme: "dark"`, which makes that query match, and the script checks `<html data-theme="dark">`.
 *
 * Robustness: every interaction is a soft step. A missing element logs a warning and the tour continues; the run
 * ends with a list of skipped steps (exit code 0, so a partial take can still be inspected). Selectors use roles,
 * visible text and hrefs only. Needs the `playwright` package (resolved through NODE_PATH or locally).
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve("playwright", { paths: [process.cwd(), ...(process.env.NODE_PATH ?? "").split(":").filter(Boolean)] }));

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = opt("base", "http://127.0.0.1:4310").replace(/\/$/, "");
const WORK = resolve(opt("work", join(tmpdir(), "command-center-demo")));
const CHROME = opt("chrome", existsSync("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : undefined);
const ONLY = opt("only", "").split(",").filter(Boolean);
const PACE = Number(opt("pace", "0.9"));
const VIEW = { width: 1440, height: 900 };
const VERSION = JSON.parse(readFileSync(join(ROOT, "app.config.json"), "utf8")).app.version;

// ---------------------------------------------------------------------------------------------------------------
// Deterministic randomness: the same take every run (jitter, arcs and typing rhythm).
let seed = 20261127;
const rand = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const between = (a, b) => a + (b - a) * rand();
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2); // easeInOutCubic

// ---------------------------------------------------------------------------------------------------------------
// Cursor overlay, injected into every document: an arrow that follows real mouse events, plus a click ripple.
// It sits in the top layer of z-index on <html>, ignores pointer events and is never part of the app.
const CURSOR_SCRIPT = `(() => {
  const install = () => {
    if (document.getElementById('__demo_cursor')) return;
    const style = document.createElement('style');
    style.textContent = \`
      #__demo_cursor{position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;
        transform:translate(var(--x,720px),var(--y,450px));transition:none;filter:drop-shadow(0 2px 3px rgba(0,0,0,.55));}
      #__demo_cursor svg{display:block;transform-origin:3px 2px;transition:transform .12s ease}
      #__demo_cursor.down svg{transform:scale(.86)}
      .__demo_ripple{position:fixed;z-index:2147483646;pointer-events:none;width:44px;height:44px;margin:-22px 0 0 -22px;
        border-radius:50%;border:2px solid rgba(110,180,255,.95);background:rgba(20,150,255,.18);
        animation:__demo_ripple .55s ease-out forwards}
      @keyframes __demo_ripple{from{transform:scale(.3);opacity:1}to{transform:scale(1.25);opacity:0}}\`;
    document.documentElement.appendChild(style);
    const c = document.createElement('div');
    c.id = '__demo_cursor';
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 26 26"><path d="M3 2 L3 21 L8.2 16.4 L11.6 24 L15 22.5 L11.7 15 L18.5 15 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(c);
    const pos = window.__demoCursorPos || { x: 720, y: 450 };
    const place = (x, y) => { c.style.setProperty('--x', x + 'px'); c.style.setProperty('--y', y + 'px'); window.__demoCursorPos = { x, y }; };
    place(pos.x, pos.y);
    addEventListener('mousemove', (e) => place(e.clientX, e.clientY), true);
    addEventListener('mousedown', (e) => {
      c.classList.add('down');
      const r = document.createElement('div');
      r.className = '__demo_ripple'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
      document.documentElement.appendChild(r); setTimeout(() => r.remove(), 700);
    }, true);
    addEventListener('mouseup', () => c.classList.remove('down'), true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
})();`;

// ---------------------------------------------------------------------------------------------------------------
// Human-like interaction helpers. `page` and `cursor` are module state for brevity.
let page;
const cursor = { x: VIEW.width / 2, y: VIEW.height / 2 };
const skipped = [];
const pause = (ms) => page.waitForTimeout(Math.round(ms * PACE));

/** Eased, slightly arced move from the current position; duration grows with distance (no teleporting). */
async function moveTo(x, y) {
  x = Math.max(4, Math.min(VIEW.width - 4, x));
  y = Math.max(4, Math.min(VIEW.height - 4, y));
  const from = { ...cursor };
  const dist = Math.hypot(x - from.x, y - from.y);
  if (dist < 2) return;
  const duration = Math.min(1150, 260 + dist * 0.6) * PACE;
  const steps = Math.max(6, Math.round(duration / 16));
  const bend = (rand() - 0.5) * Math.min(140, dist * 0.22);
  const cx = (from.x + x) / 2 + (-(y - from.y) / dist) * bend;
  const cy = (from.y + y) / 2 + ((x - from.x) / dist) * bend;
  for (let i = 1; i <= steps; i++) {
    const t = ease(i / steps);
    const px = (1 - t) * (1 - t) * from.x + 2 * (1 - t) * t * cx + t * t * x;
    const py = (1 - t) * (1 - t) * from.y + 2 * (1 - t) * t * cy + t * t * y;
    await page.mouse.move(px, py);
    await page.waitForTimeout(duration / steps);
  }
  cursor.x = x;
  cursor.y = y;
}

/** Smooth wheel scroll at the current cursor position (scrolls whichever container is under the cursor). */
async function wheel(deltaY) {
  const steps = Math.max(6, Math.round(Math.abs(deltaY) / 40));
  let done = 0;
  for (let i = 1; i <= steps; i++) {
    const target = deltaY * ease(i / steps);
    await page.mouse.wheel(0, target - done);
    done = target;
    await page.waitForTimeout(22 * PACE);
  }
  await pause(350);
}

/** First visible match of a locator, scrolled into view by wheel (towards the middle of the viewport) when needed. */
async function reveal(locator, { timeout = 6000 } = {}) {
  const el = locator.first();
  await el.waitFor({ state: "visible", timeout });
  for (let attempt = 0; attempt < 4; attempt++) {
    const box = await el.boundingBox();
    if (!box) throw new Error("no bounding box");
    // Fully on screen is enough (the app header is fixed, so its links count as visible).
    if (box.y >= 0 && box.y + box.height <= VIEW.height - 30) return box;
    // Park the cursor over the element's column (inside the viewport), then scroll like a person would.
    await moveTo(Math.min(Math.max(box.x + box.width / 2, 60), VIEW.width - 60), between(420, 520));
    const delta = box.y + box.height / 2 - VIEW.height * 0.5;
    await wheel(Math.max(-1400, Math.min(1400, delta)));
  }
  return el.boundingBox();
}

/** Move onto an element (slightly off-centre, like a hand would) and rest there. */
async function hover(locator, rest = 700) {
  const box = await reveal(locator);
  await moveTo(box.x + box.width * between(0.35, 0.6), box.y + box.height * between(0.4, 0.6));
  await pause(rest);
  return box;
}

/** Hover, hesitate briefly, then press and release with the real mouse. */
async function click(locator, after = 900) {
  await hover(locator, between(220, 380));
  await page.mouse.down();
  await page.waitForTimeout(70 + rand() * 40);
  await page.mouse.up();
  await pause(after);
}

/**
 * Click something that changes the screen; the chapter caption appears from that moment. With `expect` (a path
 * such as "/teams"), a click that did not navigate there is reported and recovered with a direct load, so a changed
 * UI cannot silently record the wrong screen.
 */
async function go(locator, after = 1400, expect) {
  await click(locator, 250);
  if (expect) {
    const ok = await page
      .waitForURL((u) => u.pathname.replace(/\/$/, "").endsWith(`/ui${expect}`), { timeout: 4000 })
      .then(() => true, () => false);
    if (!ok) {
      skipped.push(`${current?.id ?? "?"}: click did not reach ${expect} (loaded it directly)`);
      console.warn(`  ! click did not reach ${expect}; loading it directly`);
      await open(expect);
    }
  }
  markCaption();
  await pause(after - 250);
}

/** Type at a human rhythm, one character at a time. */
async function type(text) {
  for (const ch of text) {
    await page.keyboard.type(ch);
    await page.waitForTimeout((ch === " " ? between(110, 190) : between(60, 140)) * PACE);
  }
}

/** Soft step: log and continue if the UI changed under the script. */
async function step(name, fn) {
  try {
    await fn();
  } catch (e) {
    const msg = String(e?.message ?? e).split("\n")[0];
    skipped.push(`${current?.id ?? "?"}: ${name} — ${msg}`);
    console.warn(`  ! skipped "${name}": ${msg}`);
  }
}

/** Load a route in demo mode and wait until the app has rendered real content. */
async function open(route) {
  await page.goto(`${BASE}/ui${route === "/" ? "/" : route}?demo=1`, { waitUntil: "load" });
  await page.waitForFunction(() => (document.body.innerText || "").trim().length > 200, undefined, { timeout: 15000 });
  await page.waitForTimeout(1500);
  await page.mouse.move(cursor.x, cursor.y);
}

const nav = (path) => page.locator(`a[href$="/ui${path}"]`);
const tab = (name) => page.getByRole("tab", { name });
const btn = (name, exact = true) => page.getByRole("button", { name, exact });
const text = (t, exact = false) => page.getByText(t, { exact });

// ---------------------------------------------------------------------------------------------------------------
// The storyline. Each chapter: id, caption (lower third), start route (for --only) and its steps.
const CHAPTERS = [
  {
    id: "console",
    title: "Console",
    subtitle: "Davis problems and ingested events become incidents, triaged in one table",
    route: "/",
    async run() {
      await step("KPI tiles", async () => {
        for (const kpi of ["Triggered", "Open P1", "MTTA today", "Open incidents"]) await hover(text(kpi, true), 650);
      });
      await step("search", async () => {
        await click(page.getByPlaceholder(/Search/i), 300);
        await type("checkout");
        await pause(1800);
        await page.keyboard.press("Control+A");
        await pause(200);
        await page.keyboard.press("Backspace");
        await pause(900);
      });
      await step("scan rows", async () => {
        // The first rows of the table, whatever they are: rows further down may not be rendered (virtualised).
        const rows = page.getByRole("row");
        await hover(rows.nth(1), 500);
        await hover(rows.nth(3), 600);
      });
      await step("open a triggered incident", () => click(text("Packet loss between GRU and IAD"), 1600));
    },
  },
  {
    id: "incident",
    title: "Incident",
    subtitle: "Timeline, escalation progress and every notification, then acknowledge",
    route: "/incidents/dp-p-00012",
    async run() {
      await step("timeline", async () => {
        // The details header grew (Acknowledged by), so bring the first timeline entries into view first.
        const first = text(/^Notification (sent|planned|failed)$/).first();
        await first.scrollIntoViewIfNeeded({ timeout: 6000 });
        await hover(first, 900);
        await hover(text(/^Notification (failed|planned)$/).nth(1), 1200);
      });
      await step("escalation tab", () => click(tab("Escalation"), 2200));
      await step("notifications tab", () => click(tab(/^Notifications/), 2400));
      await step("acknowledge", async () => {
        // The detail panel's button has a visible label; the table's row actions are icon-only.
        await click(btn("Acknowledge").filter({ hasText: "Acknowledge" }), 2400);
      });
      await step("close panel", () => click(btn("Close details"), 900));
    },
  },
  {
    id: "on-call",
    title: "On-call",
    subtitle: "Who is on call now and next, schedules with layers, rotations and overrides",
    route: "/on-call",
    async run() {
      await step("nav", () => go(nav("/on-call"), 1500, "/on-call"));
      await step("now", async () => {
        await hover(text("NOC primary").first(), 900);
      });
      await step("schedules tab", () => click(tab("Schedules"), 1300));
      await step("coverage", () => hover(text("Coverage next 7 days"), 800));
      await step("open editor", () => click(page.locator('a[href$="/on-call/schedules/sched-noc"]'), 1800));
      await step("layers", async () => {
        await moveTo(700, 500);
        await wheel(520);
        await pause(1400);
        await wheel(520);
        await pause(1600);
      });
    },
  },
  {
    id: "teams",
    title: "Teams",
    subtitle: "People from Dynatrace IAM, contact methods and a “Ready to page?” checklist",
    route: "/teams",
    async run() {
      await step("nav", () => go(nav("/teams"), 1400, "/teams"));
      await step("open team", () => click(page.locator('a[href$="/ui/teams/noc-core"]'), 1500));
      await step("show checklist", async () => {
        const show = btn("Show steps");
        if (await show.count()) await click(show, 900);
      });
      await step("checklist", async () => {
        await hover(text("Ready to page?"), 600);
        await hover(text("2. Contact methods"), 700);
        await hover(text("4. Escalation policy"), 900);
      });
      await step("contact methods", async () => {
        await hover(text("Contact methods", true).last(), 500);
        await click(page.getByText("Edit", { exact: true }).first(), 1800);
        await hover(text("Add contact method"), 900);
        await click(btn("Cancel"), 900);
      });
    },
  },
  {
    id: "escalations",
    title: "Escalations",
    subtitle: "Delayed steps, forced channels, repeats and a simulation of who is paged when",
    route: "/escalations",
    async run() {
      await step("nav", () => go(nav("/escalations"), 1400, "/escalations"));
      await step("open policy", () => click(page.locator('a[href$="/ui/escalations/pol-noc"]'), 1500));
      await step("steps", async () => {
        await hover(text("Step 1", true).first(), 700);
        await hover(text("Step 2", true).first(), 700);
      });
      await step("simulation", async () => {
        await reveal(text("Simulation", true));
        await moveTo(700, 520);
        await wheel(320);
        await hover(text("Repeat 1 · Step 1").first(), 1600);
      });
    },
  },
  {
    id: "services",
    reloadBefore: true,
    title: "Services & routing",
    subtitle: "Ordered routing rules, first match wins: test a rule before it pages anyone",
    route: "/services",
    async run() {
      await step("nav", () => go(nav("/services"), 1400, "/services"));
      await step("rules tab", () => click(tab(/^Routing rules/), 1600));
      await step("rules", () => hover(text("catch-all").first(), 900));
      await step("test tab", () => click(tab("Test a rule"), 1200));
      await step("run test", () => click(btn("Run test"), 2600));
    },
  },
  {
    id: "war-rooms",
    title: "War rooms",
    subtitle: "Meeting link, incidents and notebooks together, with a post-mortem notebook",
    route: "/war-rooms",
    async run() {
      await step("nav", () => go(nav("/war-rooms"), 1600, "/war-rooms"));
      await step("rows", async () => {
        await hover(page.getByRole("row").nth(1), 1000);
        await hover(page.getByRole("row").nth(2), 1200);
      });
    },
  },
  {
    id: "integrations",
    title: "Integrations",
    subtitle: "Inbound from Dynatrace APIs, outbound providers, the engine workflows",
    route: "/integrations",
    async run() {
      await step("nav", () => go(nav("/integrations"), 1500, "/integrations"));
      await step("snippets", async () => {
        await click(tab("PowerShell"), 900);
        await click(tab("Python"), 1100);
      });
      await step("outbound tab", () => click(tab("Outbound"), 1300));
      await step("providers", async () => {
        await moveTo(700, 560);
        await wheel(380);
        await pause(1200);
      });
      await step("workflows tab", async () => {
        await reveal(tab("Workflows"));
        await click(tab("Workflows"), 1300);
      });
      await step("engines", async () => {
        await hover(text("Command Center · Engine", true), 1100);
        await hover(text("Command Center · Engine on problem"), 1800);
      });
    },
  },
  {
    id: "reports",
    title: "Reports",
    subtitle: "MTTA and MTTR, volume by priority and team, delivery and on-call load",
    route: "/reports",
    async run() {
      await step("nav", () => go(nav("/reports"), 1800, "/reports"));
      await step("charts", async () => {
        await moveTo(560, 470);
        await pause(800);
        await moveTo(980, 500);
        await pause(700);
        await wheel(600);
        await pause(1300);
        await wheel(600);
        await pause(1300);
      });
    },
  },
  {
    id: "settings",
    title: "Settings",
    subtitle: "Sources, defaults, engine limits, retention, export and import",
    route: "/settings",
    async run() {
      await step("open", () => go(btn("Settings"), 1500, "/settings"));
      await step("sections", async () => {
        await click(page.locator('a[href="#engine"]'), 1400);
        await click(page.locator('a[href="#retention"]'), 1200);
        await click(page.locator('a[href="#configuration"]'), 1500);
      });
    },
  },
  {
    id: "help",
    title: "Help",
    subtitle: "The guide, inbound snippets and troubleshooting, inside the app",
    route: "/help",
    async run() {
      await step("open", async () => {
        // The header's Help button opens a menu; "Get started" leads to the in-app help page.
        await click(btn("Help"), 700);
        const item = page.getByRole("menuitem", { name: /Get started/ });
        if (await item.count()) await go(item, 1600, "/help");
        else {
          await open("/help");
          markCaption();
        }
      });
      await step("read", async () => {
        await moveTo(760, 520);
        await wheel(500);
        await pause(1200);
        await wheel(500);
        await pause(1500);
      });
    },
  },
];

// ---------------------------------------------------------------------------------------------------------------
// Title card, end card and lower thirds, rendered as 1440x900 PNGs with the same Chrome (Inter is used when
// installed; system UI fonts otherwise). Lower thirds have a transparent background for ffmpeg's overlay.
const ICON = `data:image/svg+xml;base64,${readFileSync(join(ROOT, "docs/icon.svg")).toString("base64")}`;
const CARD_CSS = `
  *{margin:0;box-sizing:border-box} html,body{width:${VIEW.width}px;height:${VIEW.height}px}
  body{font-family:Inter,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#eef0f8;-webkit-font-smoothing:antialiased}
  .stage{width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;
    background:radial-gradient(900px 520px at 50% 18%,rgba(20,150,255,.22),transparent 65%),
      radial-gradient(700px 420px at 85% 95%,rgba(138,79,208,.18),transparent 70%),#0b0c17}
  .stage img{width:112px;height:112px;margin-bottom:30px}
  .k{font-size:15px;letter-spacing:.16em;text-transform:uppercase;color:#b4dc00;font-weight:600;margin-bottom:18px}
  h1{font-size:64px;font-weight:800;letter-spacing:-.02em;line-height:1.05}
  h1 span{background:linear-gradient(120deg,#1496ff,#b4dc00 60%,#8a4fd0);-webkit-background-clip:text;color:transparent}
  p{font-size:24px;color:#a9adc6;margin-top:22px;max-width:980px;line-height:1.45}
  .chips{display:flex;gap:12px;margin-top:34px}
  .chips b{font-weight:500;font-size:16px;color:#cfd3ea;border:1px solid #2a2d48;background:#14162a;padding:8px 16px;border-radius:999px}
  .lt{position:absolute;left:36px;bottom:36px;display:flex;align-items:stretch;border-radius:14px;overflow:hidden;
    background:rgba(11,12,23,.9);border:1px solid rgba(255,255,255,.08);box-shadow:0 18px 40px rgba(0,0,0,.45)}
  .lt i{width:6px;background:linear-gradient(#1496ff,#b4dc00)}
  .lt div{padding:16px 24px 17px 20px}
  .lt small{display:block;font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#7f86ad;font-weight:600}
  .lt strong{display:block;font-size:28px;font-weight:700;margin-top:3px}
  .lt span{display:block;font-size:17px;color:#b9bdd6;margin-top:3px}`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

async function renderCards(browser, chapters) {
  const dir = join(WORK, "cards");
  mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({ viewport: VIEW, colorScheme: "dark" });
  const p = await ctx.newPage();
  const shot = async (name, body, transparent = false) => {
    await p.setContent(`<!doctype html><html><head><style>${CARD_CSS}</style></head><body${transparent ? ' style="background:transparent"' : ""}>${body}</body></html>`);
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: join(dir, name), omitBackground: transparent });
  };
  await shot(
    "title.png",
    `<div class="stage"><img src="${ICON}" alt=""><div class="k">Product tour · v${esc(VERSION)}</div>
     <h1>Command Center<br><span>for Dynatrace</span></h1>
     <p>A NOC event console with on-call teams, schedules and escalation policies, inside Dynatrace.</p>
     <div class="chips"><b>Demo mode</b><b>Synthetic data</b><b>Dark theme</b></div></div>`,
  );
  await shot(
    "end.png",
    `<div class="stage"><img src="${ICON}" alt=""><h1>Command Center<br><span>for Dynatrace</span></h1>
     <p>Source on GitHub · github.com/adrianorafael/Command-Center-for-Dynatrace</p>
     <div class="chips"><b>Demo app</b><b>No affiliation with Dynatrace</b><b>v${esc(VERSION)}</b></div></div>`,
  );
  for (const [i, c] of chapters.entries()) {
    await shot(
      `lt-${c.id}.png`,
      `<div class="lt"><i></i><div><small>${String(i + 1).padStart(2, "0")} / ${String(chapters.length).padStart(2, "0")}</small>
       <strong>${esc(c.title)}</strong><span>${esc(c.subtitle)}</span></div></div>`,
      true,
    );
  }
  await ctx.close();
}

// ---------------------------------------------------------------------------------------------------------------
let current;
let chapterStart = 0;
let captionAt;
let clock = () => 0;
/** Remember when the current chapter's own screen appeared (seconds after the chapter start), once. */
function markCaption() {
  if (captionAt === undefined) captionAt = clock() - chapterStart;
}

async function main() {
  const chapters = ONLY.length ? CHAPTERS.filter((c) => ONLY.includes(c.id)) : CHAPTERS;
  if (!chapters.length) throw new Error(`--only matched no chapter; ids: ${CHAPTERS.map((c) => c.id).join(", ")}`);
  rmSync(join(WORK, "video"), { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });

  const browser = await chromium.launch({ headless: true, ...(CHROME ? { executablePath: CHROME } : {}), args: ["--no-sandbox"] });
  const context = await browser.newContext({
    viewport: VIEW,
    colorScheme: "dark",
    reducedMotion: "no-preference",
    recordVideo: { dir: join(WORK, "video"), size: VIEW },
  });
  await context.addInitScript(CURSOR_SCRIPT);
  // Warm the HTTP cache with every route (lazy-loaded chunks) in a throw-away tab, so the take shows no spinners.
  // Each page has its own video file; only the main page's video is kept.
  page = await context.newPage();
  for (const c of CHAPTERS) await open(c.route).catch(() => undefined);
  await page.close();
  page = await context.newPage();
  const t0 = Date.now();
  const at = () => (Date.now() - t0) / 1000;
  clock = at;
  const marks = [];


  // Full tour: start on the console. --only: every chapter starts from its own route.
  if (!ONLY.length) await open("/");
  const theme = await page.evaluate(() => document.documentElement.getAttribute("data-theme")).catch(() => null);
  if (!ONLY.length && theme !== "dark") console.warn(`! <html data-theme> is "${theme}", expected "dark"`);

  for (const c of chapters) {
    current = c;
    if (ONLY.length) await open(c.route);
    console.log(`▶ ${c.id}`);
    // Midway, reload while no frame of the tour is kept: the demo fixtures are dated at load time, and after
    // about 3 minutes the app would rightly warn that the (sample) paging engine stopped running.
    if (c.reloadBefore && !ONLY.length) {
      await page.reload({ waitUntil: "load" });
      await page.waitForFunction(() => (document.body.innerText || "").trim().length > 200, undefined, { timeout: 15000 });
      await page.waitForTimeout(1500);
      await page.mouse.move(cursor.x, cursor.y);
    }
    // A dialog left open by a failed step would poison every later chapter.
    if (await page.locator('[role="dialog"]').first().isVisible().catch(() => false)) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    }
    const start = at();
    chapterStart = start;
    captionAt = undefined;
    await c.run();
    await pause(500);
    marks.push({
      id: c.id,
      title: c.title,
      subtitle: c.subtitle,
      start: +start.toFixed(2),
      end: +at().toFixed(2),
      caption: +(captionAt ?? 0.5).toFixed(2), // seconds into the chapter when its lower third may appear
    });
  }
  await pause(800);

  const video = page.video();
  await context.close();
  const raw = join(WORK, "raw.webm");
  renameSync(await video.path(), raw);
  writeFileSync(join(WORK, "chapters.json"), JSON.stringify({ version: VERSION, viewport: VIEW, chapters: marks }, null, 2));
  await renderCards(browser, chapters);
  await browser.close();

  console.log(`\nraw video  ${raw}\nchapters   ${join(WORK, "chapters.json")}\ncards      ${join(WORK, "cards")} (${readdirSync(join(WORK, "cards")).length} files)`);
  console.log(`length     ${marks.at(-1).end.toFixed(1)} s recorded, ${marks.reduce((s, m) => s + m.end - m.start, 0).toFixed(1)} s in chapters`);
  if (skipped.length) console.log(`\nSkipped steps (${skipped.length}):\n  - ${skipped.join("\n  - ")}`);
  else console.log("All steps ran.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
