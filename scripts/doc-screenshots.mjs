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
import { createRequire } from "node:module";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

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

/** file name (without .png) → route, plus an optional step run before the capture. */
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

for (const [name, route, prepare] of SHOTS) {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message ?? e)));
  const url = `${BASE}/ui${route}${route.includes("?") ? "&" : "?"}demo=1`;
  try {
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
    await page.screenshot({ path: file });
    const ok = errors.length === 0;
    failed ||= !ok;
    console.log(`${ok ? "OK  " : "FAIL"} ${name.padEnd(22)} ${route.padEnd(30)} ${(statSync(file).size / 1024).toFixed(0)} KB ${errors.join("; ")}`);
  } catch (e) {
    failed = true;
    console.log(`FAIL ${name.padEnd(22)} ${route.padEnd(30)} ${String(e.message ?? e).split("\n")[0]}`);
  }
  await page.close();
}

await browser.close();
process.exit(failed ? 1 : 0);
