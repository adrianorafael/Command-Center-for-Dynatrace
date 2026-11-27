#!/usr/bin/env node
/**
 * Screenshots every route in demo mode against scripts/preview-server.mjs.
 *
 * Usage: node scripts/screenshot.mjs <outDir> [--base http://127.0.0.1:4173] [--routes /,/teams]
 *        [--incident <incident id for /incidents/:first>]
 *        [--chrome /usr/bin/google-chrome] [--theme light|dark]
 * Needs the `playwright` package (resolved with require; no browser download needed when a
 * Chrome binary is given). `/incidents/:first` is replaced by --incident, else by the first incident link found
 * on the console (rows that navigate by script have no link → '/incidents/unknown'). A route passes when no page error occurred and the page shows real content
 * (rendered text, beyond an empty AppRoot). Exits non-zero otherwise.
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const outDir = resolve(args.find((a, i) => !a.startsWith("--") && !(args[i - 1] ?? "").startsWith("--")) ?? "screenshots");
const base = opt("base", "http://127.0.0.1:4173");
const theme = opt("theme", "light");
const routes = opt(
  "routes",
  "/,/incidents/:first,/on-call,/teams,/schedules,/policies,/routing,/integrations,/settings,/reports,/help",
).split(",");
const chromePath = opt("chrome", existsSync("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : undefined);

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(chromePath ? { executablePath: chromePath } : {}),
  args: ["--no-sandbox"],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme });
const report = [];
let failed = false;
let firstIncident = opt("incident", undefined) ? `/incidents/${encodeURIComponent(opt("incident", ""))}` : undefined;

for (const route of routes) {
  const page = await context.newPage();
  const errors = [];
  const consoleErrors = [];
  const failedRequests = [];
  page.on("response", (r) => {
    if (r.status() >= 400) failedRequests.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });
  page.on("pageerror", (e) => errors.push(String(e.message ?? e)));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300));
  });
  let path = route;
  if (route.includes(":first")) {
    path = firstIncident ?? route.replace(":first", "unknown");
  }
  const url = `${base}/ui${path === "/" ? "/" : path}?demo=1`;
  // "load" + a bounded wait: the app polls (auto-refresh), so "networkidle" may never settle.
  await page.goto(url, { waitUntil: "load", timeout: 30_000 }).catch((e) => errors.push(`goto: ${e.message}`));
  await page
    .waitForFunction(() => (document.body.innerText || "").trim().length > 40, undefined, { timeout: 10_000 })
    .catch(() => undefined);
  await page.waitForTimeout(1000);
  if (route === "/" && !firstIncident) {
    firstIncident = await page
      .evaluate(() => {
        const a = [...document.querySelectorAll("a[href]")].find((x) => /\/incidents\/[^/?#]+/.test(x.getAttribute("href") || ""));
        const m = a ? /\/incidents\/[^/?#]+/.exec(a.getAttribute("href") || "") : null;
        return m ? m[0] : undefined;
      })
      .catch(() => undefined);
  }
  const rootInfo = await page
    .evaluate(() => {
      const el = document.getElementById("root") ?? document.body.firstElementChild;
      const text = (document.body.innerText || "").trim();
      return { children: el ? el.childElementCount : 0, textLength: text.length, text: text.slice(0, 200) };
    })
    .catch(() => ({ children: 0, textLength: 0, text: "" }));
  const name = route === "/" ? "console" : route.replace(/^\//, "").replace(/[^a-z0-9-]+/gi, "_");
  const file = join(outDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true }).catch((e) => errors.push(`screenshot: ${e.message}`));
  const ok = errors.length === 0 && rootInfo.children > 0 && rootInfo.textLength > 40;
  if (!ok) failed = true;
  report.push({ route, path, url, file, ok, rootChildren: rootInfo.children, textSample: rootInfo.text, errors, consoleErrors, failedRequests });
  console.log(`${ok ? "OK  " : "FAIL"} ${route} → ${file} (root children: ${rootInfo.children}, errors: ${errors.length})`);
  await page.close();
}

writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
process.exit(failed ? 1 : 0);
