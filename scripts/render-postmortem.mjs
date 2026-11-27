#!/usr/bin/env node
/**
 * Renders the post-mortem notebook content that Command Center generates for a war room as a static, dark-themed
 * HTML page, for the documentation screenshot docs/screenshots/postmortem-notebook.png.
 *
 * The real notebook is a Dynatrace Notebooks document (opened in the Notebooks app, which cannot run offline). This
 * page lays out exactly what the app writes into it: the builder ui/app/domain/warrooms.ts → buildPostmortemNotebook
 * is bundled on the fly with the installed esbuild and called with the open demo war room (synthetic demo data from
 * ui/app/data/demoPort.ts), the title and incident numbers the war room modal passes, and the notebook name from
 * ui/app/data/notebooks.ts → postmortemNotebookName. Markdown sections are rendered as text; DQL sections are shown
 * as code (not executed, no results). Deliberately plain: it does not imitate the Notebooks UI.
 *
 * Usage: node scripts/render-postmortem.mjs [--out /path/postmortem.html] [--room wr-demo-checkout]
 * Prints the path of the written HTML file.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const ROOM = opt("room", "wr-demo-checkout");

const dir = mkdtempSync(join(tmpdir(), "cc-pm-"));
let mod;
try {
  const bundle = join(dir, "postmortem.mjs");
  await build({
    stdin: {
      contents: [
        'export { buildPostmortemNotebook } from "./ui/app/domain/warrooms";',
        'export { postmortemNotebookName } from "./ui/app/data/notebooks";',
        'export { demoSeed } from "./ui/app/data/demoPort";',
      ].join("\n"),
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: bundle,
    logLevel: "error",
  });
  mod = await import(pathToFileURL(bundle).href);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
const { buildPostmortemNotebook, postmortemNotebookName, demoSeed } = mod;

// Same inputs as WarRoomModal → createNotebook: room title and the display ids of its incidents.
const seed = demoSeed(Date.now());
const room = seed.map((s) => s.value).find((v) => v && v.id === ROOM && Array.isArray(v.incidentIds));
if (!room) throw new Error(`demo war room "${ROOM}" not found`);
const incidents = new Map(seed.map((s) => s.value).filter((v) => v && v.alert).map((i) => [i.id, i]));
const ids = room.incidentIds.map((id) => incidents.get(id)?.alert.displayId).filter(Boolean);
const title = room.title.trim() || "War room";
let n = 0;
const notebook = buildPostmortemNotebook(title, ids, () => `section-${++n}`);
const name = postmortemNotebookName(title, ids);

// Minimal markdown for the constructs the template uses: headings, paragraphs, _emphasis_, tables, task lists.
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const inline = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\b_([^_]+)_\b/g, "<em>$1</em>");
function markdown(src) {
  const out = [];
  const blocks = src.split(/\n{2,}/);
  for (const raw of blocks) {
    const b = raw.replace(/\s+$/, "");
    if (!b.trim()) continue;
    const lines = b.split("\n");
    const h = /^(#{1,6})\s+(.*)$/.exec(lines[0]);
    if (h && lines.length === 1) {
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
    } else if (lines.every((l) => l.trim().startsWith("|"))) {
      const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const [head, , ...body] = lines;
      out.push(
        `<table><thead><tr>${cells(head).map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>` +
          body.map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c) || "&nbsp;"}</td>`).join("")}</tr>`).join("") +
          "</tbody></table>",
      );
    } else if (lines.every((l) => /^\s*- /.test(l))) {
      out.push(
        `<ul>${lines
          .map((l) => {
            const t = /^\s*- \[( |x)\]\s?(.*)$/.exec(l);
            return t
              ? `<li class="task"><span class="box" aria-hidden="true">${t[1] === "x" ? "&#10003;" : ""}</span>${inline(t[2]) || "&nbsp;"}</li>`
              : `<li>${inline(l.replace(/^\s*- /, ""))}</li>`;
          })
          .join("")}</ul>`,
      );
    } else {
      out.push(`<p>${lines.map(inline).join("<br>")}</p>`);
    }
  }
  return out.join("\n");
}

const sections = notebook.sections
  .map((s, i) => {
    const kind = s.type === "dql" ? "DQL query" : "Markdown";
    const head = `<div class="kind"><span>${i + 1}</span>${kind}${s.type === "dql" && s.title ? ` · ${esc(s.title)}` : ""}</div>`;
    if (s.type === "markdown") {
      const body = markdown(s.markdown);
      const empty = /^#+ .*$/.test(s.markdown.trim()) || /^\s*$/.test(s.markdown);
      return `<section>${head}${body}${empty ? '<p class="hint">(left empty for the team to fill in)</p>' : ""}</section>`;
    }
    if (s.type === "dql") {
      const tf = s.state?.input?.timeframe;
      return `<section class="dql">${head}<pre><code>${esc(s.state?.input?.value ?? "")}</code></pre>` +
        `<p class="hint">Timeframe ${esc(tf?.from ?? "")} → ${esc(tf?.to ?? "")}. Runs against Grail when the notebook is opened in Dynatrace; not executed here, no results shown.</p></section>`;
    }
    return `<section>${head}<pre><code>${esc(JSON.stringify(s, null, 2))}</code></pre></section>`;
  })
  .join("\n");

const html = `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Post-mortem notebook content</title>
<style>
  :root { --bg: #0b0f1a; --card: #121829; --border: #243049; --text: #e6ebf5; --dim: #9aa6bf; --blue: #4f8cff; --code: #0e1424; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .wrap { max-width: 980px; margin: 0 auto; padding: 28px 24px 36px; }
  .banner { border: 1px dashed var(--border); border-radius: 10px; padding: 10px 14px; color: var(--dim); font-size: 13px; margin-bottom: 18px; }
  .banner b { color: var(--text); font-weight: 600; }
  .meta { display: flex; flex-wrap: wrap; gap: 8px 18px; color: var(--dim); font-size: 13px; margin: 0 0 18px; }
  .meta b { color: var(--text); font-weight: 600; }
  section { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 12px 18px 14px; margin: 0 0 12px; }
  .kind { display: flex; align-items: center; gap: 8px; font-size: 12px; letter-spacing: .02em; text-transform: uppercase; color: var(--dim); margin-bottom: 4px; }
  .kind span { display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; background: var(--border); color: var(--text); font-size: 11px; }
  h1 { font-size: 24px; margin: 6px 0 6px; } h2 { font-size: 18px; margin: 6px 0 4px; }
  p { margin: 4px 0; } em { color: var(--dim); }
  .hint { color: var(--dim); font-size: 12.5px; font-style: italic; }
  table { border-collapse: collapse; width: 100%; margin: 6px 0; font-size: 14px; }
  th, td { border: 1px solid var(--border); padding: 5px 10px; text-align: left; }
  ul { list-style: none; padding: 0; margin: 6px 0; }
  li.task { display: flex; gap: 8px; align-items: center; }
  .box { width: 15px; height: 15px; border: 1.5px solid var(--dim); border-radius: 3px; display: inline-grid; place-items: center; font-size: 11px; }
  pre { margin: 6px 0; background: var(--code); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; overflow-x: auto; }
  code { font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #b9d0ff; }
</style>
</head>
<body>
<main class="wrap">
  <div class="banner"><b>Post-mortem notebook content generated by Command Center</b> · rendered from the app's template
    (buildPostmortemNotebook) for a demo war room; in Dynatrace it opens in Notebooks. Synthetic demo data.</div>
  <div class="meta">
    <span>Notebook name <b>${esc(name)}</b></span>
    <span>Document type <b>notebook</b> · content version <b>${esc(notebook.version)}</b></span>
    <span>Default timeframe <b>${esc(notebook.defaultTimeframe?.from)} → ${esc(notebook.defaultTimeframe?.to)}</b></span>
    <span>Sections <b>${notebook.sections.length}</b></span>
  </div>
${sections}
</main>
</body>
</html>
`;

const out = resolve(opt("out", join(tmpdir(), "command-center-postmortem.html")));
writeFileSync(out, html);
console.log(out);
