#!/usr/bin/env node
/**
 * Re-captures the documentation screenshots (docs/screenshots/*.png) in demo mode, dark theme, 1440x900 viewport.
 *
 * The file names are referenced by README.md, docs/guides/en/* and docs/index.html: keep them stable. Each entry in
 * SHOTS maps a file name to a route (and an optional preparation step); add a row to add a screenshot.
 *
 * Usage:
 *   npx dt-app build && node scripts/preview-server.mjs --port 4310 &
 *   NODE_PATH=$(npm root -g) node scripts/doc-screenshots.mjs [--base http://127.0.0.1:4310] [--out docs/screenshots]
 *        [--scale 1] [--only console,team] [--chrome /usr/bin/google-chrome]
 *
 *   --scale  deviceScaleFactor (1 → 1440x900 PNGs, about 0.1–0.3 MB each; 2 → 2880x1800, roughly 3x the bytes).
 *
 * Dark theme: the offline preview has no platform runtime, so Strato's theme falls back to the
 * `prefers-color-scheme` media query; the context is created with `colorScheme: "dark"` and every shot checks
 * `<html data-theme="dark">`. Exits non-zero when a route fails to render or is not dark.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve("playwright", { paths: [process.cwd(), ...(process.env.NODE_PATH ?? "").split(":").filter(Boolean)] }));

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const BASE = opt("base", "http://127.0.0.1:4310").replace(/\/$/, "");
const OUT = resolve(opt("out", "docs/screenshots"));
const SCALE = Number(opt("scale", "1"));
const ONLY = opt("only", "").split(",").filter(Boolean);
const CHROME = opt("chrome", existsSync("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : undefined);

/** Opens the edit modal of the open demo war room (picked by its meeting link) and fails when it does not appear. */
async function openWarRoomModal(page, { createPostmortem = false } = {}) {
  const row = page.getByRole("row").filter({ hasText: "noc-bridge-checkout" });
  await row.getByRole("button", { name: "Edit", exact: true }).click();
  const dialog = page.getByRole("dialog").filter({ hasText: "Edit war room" });
  await dialog.waitFor({ timeout: 5_000 });
  if (createPostmortem) {
    // Demo mode: links a sample post-mortem notebook (no document is created); wait for its row to appear.
    await dialog.getByRole("button", { name: "Create post-mortem notebook" }).click();
    await dialog.getByText("Post-mortem:", { exact: false }).first().waitFor({ timeout: 5_000 });
  }
  await page.waitForTimeout(600);
}

/** The post-mortem notebook content, rendered to a static page by scripts/render-postmortem.mjs (no app route). */
function postmortemUrl() {
  const file = join(tmpdir(), "command-center-postmortem.html");
  execFileSync(process.execPath, [join(import.meta.dirname, "render-postmortem.mjs"), "--out", file], { stdio: "ignore" });
  return pathToFileURL(file).href;
}

/**
 * file name (without .png) → route, plus an optional step run before the capture and options:
 * `url` (a function returning an absolute URL, instead of an app route) and `fullPage`.
 */
const SHOTS = [
  ["console", "/"],
  ["incident", "/incidents/dp-p-00008"],
  ["oncall", "/on-call"],
  ["schedule-editor", "/on-call/schedules/sched-noc"],
  ["teams", "/teams"],
  [
    "team",
    "/teams/noc-core",
    async (page) => {
      // Show the "Ready to page?" checklist when the team page collapses it.
      const show = page.getByRole("button", { name: "Show steps", exact: true });
      if (await show.count()) await show.first().click();
    },
  ],
  ["escalations", "/escalations"],
  ["policy-editor", "/escalations/pol-noc"],
  ["services", "/services"],
  ["routing", "/services?tab=rules"],
  ["war-rooms", "/war-rooms"],
  ["war-room-edit", "/war-rooms", (page) => openWarRoomModal(page, { createPostmortem: true })],
  ["postmortem-notebook", "", undefined, { url: postmortemUrl, fullPage: true }],
  ["integrations", "/integrations"],
  ["integrations-outbound", "/integrations?tab=outbound"],
  ["integrations-workflow", "/integrations?tab=workflows"],
  ["reports", "/reports"],
  ["settings", "/settings"],
  ["help", "/help"],
].filter(([name]) => !ONLY.length || ONLY.includes(name));

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(CHROME ? { executablePath: CHROME } : {}), args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: SCALE, colorScheme: "dark" });
let failed = false;

for (const [name, route, prepare, options = {}] of SHOTS) {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message ?? e)));
  let url = `${BASE}/ui${route}${route.includes("?") ? "&" : "?"}demo=1`;
  try {
    if (options.url) url = options.url();
    await page.goto(url, { waitUntil: "load", timeout: 30_000 });
    // The app polls App State, so "networkidle" may never settle: wait for real content, then let charts animate.
    await page.waitForFunction(() => (document.body.innerText || "").trim().length > 200, undefined, { timeout: 15_000 });
    await page.waitForTimeout(1500);
    if (prepare) await prepare(page);
    await page.mouse.move(1439, 899); // no hover state on the capture
    await page.waitForTimeout(700);
    const theme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    if (theme !== "dark") errors.push(`theme is "${theme}", expected "dark"`);
    const file = join(OUT, `${name}.png`);
    await page.screenshot({ path: file, fullPage: !!options.fullPage });
    const ok = errors.length === 0;
    failed ||= !ok;
    console.log(`${ok ? "OK  " : "FAIL"} ${name.padEnd(22)} ${(route || "(static page)").padEnd(30)} ${(statSync(file).size / 1024).toFixed(0)} KB ${errors.join("; ")}`);
  } catch (e) {
    failed = true;
    console.log(`FAIL ${name.padEnd(22)} ${(route || "(static page)").padEnd(30)} ${String(e.message ?? e).split("\n")[0]}`);
  }
  await page.close();
}

await browser.close();
process.exit(failed ? 1 : 0);
