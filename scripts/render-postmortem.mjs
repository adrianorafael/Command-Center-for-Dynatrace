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
 * as code. Deliberately plain: it does not imitate the Notebooks UI.
 *
 * By default the template's empty sections are then filled in by hand with EXAMPLE content for the demo war room
 * "wr-demo-checkout" (fillExample below): the incident times, titles, entities, affected users and the paging
 * history come from the demo seed, the people from the demo directory; the narrative (root cause, recovery,
 * action items) and the query result table are invented for the example and labelled as such on the page.
 * --template-only renders the generated template as is (empty sections, query without results).
 *
 * Usage: node scripts/render-postmortem.mjs [--out /path/postmortem.html] [--room wr-demo-checkout] [--template-only]
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
const TEMPLATE_ONLY = args.includes("--template-only");

const dir = mkdtempSync(join(tmpdir(), "cc-pm-"));
let mod;
try {
  const bundle = join(dir, "postmortem.mjs");
  await build({
    stdin: {
      contents: [
        'export { buildPostmortemNotebook } from "./ui/app/domain/warrooms";',
        'export { postmortemNotebookName } from "./ui/app/data/notebooks";',
        'export { demoSeed, demoUsers } from "./ui/app/data/demoPort";',
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
const { buildPostmortemNotebook, postmortemNotebookName, demoSeed, demoUsers } = mod;

// Same inputs as WarRoomModal → createNotebook: room title and the display ids of its incidents.
const NOW = Date.now();
const seed = demoSeed(NOW);
const room = seed.map((s) => s.value).find((v) => v && v.id === ROOM && Array.isArray(v.incidentIds));
if (!room) throw new Error(`demo war room "${ROOM}" not found`);
const incidents = new Map(
  seed
    .map((s) => s.value)
    .filter((v) => v && v.alert)
    .map((i) => [i.id, i]),
);
const ids = room.incidentIds.map((id) => incidents.get(id)?.alert.displayId).filter(Boolean);
const title = room.title.trim() || "War room";
let n = 0;
const notebook = buildPostmortemNotebook(title, ids, () => `section-${++n}`);
const name = postmortemNotebookName(title, ids);

/**
 * Example content for the demo war room, written as a team would after the incident. Returns section id → markdown
 * (markdown sections) or rows (the DQL section's example result), or null when no example exists for the room.
 */
function fillExample() {
  if (room.id !== "wr-demo-checkout") return null;
  const linked = room.incidentIds.map((id) => incidents.get(id)).filter(Boolean);
  const wan = linked.find((i) => i.alert.displayId === "P-00012");
  const search = linked.find((i) => i.alert.displayId === "P-00018");
  if (!wan || !search) return null;
  const users = new Map(demoUsers(NOW).map((u) => [u.uid, u.name]));
  const who = (uid) => users.get(uid) ?? uid;
  const t0 = Math.min(wan.alert.startedAt, search.alert.startedAt);
  const MIN = 60_000;
  const hhmm = (t) => new Date(t).toISOString().slice(11, 16);
  const day = new Date(t0).toISOString().slice(0, 10);
  const entity = (i) => i.alert.entities?.[0]?.name ?? "";
  // Paging history straight from the demo incidents' timelines (marked † in the table): the creation, then the
  // delivery outcomes grouped per incident and minute, e.g. "slack delivered, whatsapp failed (HTTP 503)".
  const paging = linked.flatMap((i) => {
    const rows = [];
    const byMinute = new Map();
    for (const e of i.timeline ?? []) {
      if (e.type === "created") rows.push({ at: e.at, text: `${i.alert.displayId} opened (${i.priority}): ${i.alert.title} on ${entity(i)} †` });
      if (e.type !== "notification_sent" && e.type !== "notification_failed") continue;
      const m = /^(\S+) → ([^:(]+?)(?: \(attempt (\d+)\))?(?:: (.*))?$/.exec(e.detail ?? "");
      if (!m) continue;
      const [, channel, person, attempt, error] = m;
      const key = hhmm(e.at);
      const g = byMinute.get(key) ?? { at: e.at, people: new Set(), parts: [] };
      g.people.add(person);
      const code = /HTTP \d{3}/.exec(error ?? "")?.[0];
      g.parts.push(
        `${channel} ${e.type === "notification_failed" ? `failed${code ? ` (${code})` : ""}` : "delivered"}${attempt ? ` on attempt ${attempt}` : ""}`,
      );
      byMinute.set(key, g);
    }
    for (const g of byMinute.values())
      rows.push({ at: g.at, text: `${i.alert.displayId}: paged ${[...g.people].join(", ")}: ${g.parts.join(", ")} †` });
    return rows;
  });
  const restored = t0 + 58 * MIN;
  const closed = t0 + 61 * MIN;
  const manual = [
    { at: t0 + 7 * MIN, text: `${who("user-0003")} acknowledges ${wan.alert.displayId} and ${search.alert.displayId}` },
    { at: t0 + 9 * MIN, text: `${who(room.openedBy)} opens the war room and links both incidents` },
    { at: t0 + 14 * MIN, text: `${who("user-0004")} moves GRU → IAD traffic to the secondary circuit` },
    { at: t0 + 17 * MIN, text: `${entity(search)} failure rate back to baseline` },
    { at: t0 + 39 * MIN, text: "Carrier confirms an overrunning maintenance window on the primary circuit" },
    { at: restored, text: "Primary circuit restored; traffic moved back" },
    { at: closed, text: `${wan.alert.displayId} and ${search.alert.displayId} closed in Dynatrace` },
  ];
  const timeline = [...paging, ...manual].sort((a, b) => a.at - b.at);
  const iso = (t) => new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
  return {
    Summary:
      `On ${day} at ${hhmm(t0)} UTC, packet loss on the GRU–IAD WAN link (\`${entity(wan)}\`) degraded traffic between the two sites. ` +
      `\`${entity(search)}\`, which reads its index replica in IAD, started failing requests ${Math.round((search.alert.startedAt - t0) / MIN)} minutes later. ` +
      `Traffic was moved to the secondary circuit after 14 minutes; the carrier restored the primary circuit after 58 minutes.`,
    Timeline: ["| Time (UTC) | Event |", "| --- | --- |", ...timeline.map((e) => `| ${hhmm(e.at)} | ${e.text.replace(/\|/g, "/")} |`)].join("\n"),
    "Root cause":
      "The carrier's planned maintenance on the primary GRU–IAD circuit overran its window and caused intermittent packet loss.\n\n" +
      `Nothing failed over automatically: the secondary circuit is only used when the primary is fully down, and \`${entity(search)}\` has no ` +
      "fallback to its local replica when cross-site calls fail.",
    Impact: [
      `- **${wan.alert.displayId}** (${wan.priority}): about ${wan.alert.affectedUsers} affected users while packet loss lasted (14 minutes until the traffic moved).`,
      `- **${search.alert.displayId}** (${search.priority}): about ${search.alert.affectedUsers} affected users; search requests failed for ${Math.round((t0 + 17 * MIN - search.alert.startedAt) / MIN)} minutes.`,
      "- No data loss. The first WhatsApp page failed (provider HTTP 503) and was retried a minute later.",
    ].join("\n"),
    "Action items": [
      `- [x] Move GRU → IAD traffic to the secondary circuit (${who("user-0004")})`,
      `- [ ] Fail over automatically when packet loss stays above 2 % for 2 minutes (${who("user-0004")})`,
      `- [ ] \`${entity(search)}\`: serve from the local replica when cross-site calls fail (${who("user-0007")})`,
      `- [ ] Subscribe NOC Core to the carrier's maintenance notices (${who(room.openedBy)})`,
      `- [ ] Add a voice call to step 1 of the NOC policy for P1 incidents (${who("user-0003")})`,
    ].join("\n"),
    dqlRows: [search, wan].map((i) => [i.alert.displayId, i.alert.title, "CLOSED", iso(i.alert.startedAt), iso(closed)]),
  };
}
const example = TEMPLATE_ONLY ? null : fillExample();
if (!TEMPLATE_ONLY && !example) console.error(`no example content for "${room.id}": rendering the template only`);

// Minimal markdown for the constructs the template uses: headings, paragraphs, _emphasis_, tables, task lists.
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const inline = (s) =>
  esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\b_([^_]+)_\b/g, "<em>$1</em>");
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
      const cells = (l) =>
        l
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((c) => c.trim());
      const [head, , ...body] = lines;
      out.push(
        `<table><thead><tr>${cells(head)
          .map((c) => `<th>${inline(c)}</th>`)
          .join("")}</tr></thead><tbody>` +
          body
            .map(
              (r) =>
                `<tr>${cells(r)
                  .map((c) => `<td>${inline(c) || "&nbsp;"}</td>`)
                  .join("")}</tr>`,
            )
            .join("") +
          "</tbody></table>",
      );
    } else if (lines.every((l) => /^\s*- /.test(l))) {
      out.push(
        `<ul>${lines
          .map((l) => {
            const t = /^\s*- \[( |x)\]\s?(.*)$/.exec(l);
            return t
              ? `<li class="task"><span class="box" aria-hidden="true">${t[1] === "x" ? "&#10003;" : ""}</span><span>${inline(t[2]) || "&nbsp;"}</span></li>`
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
    // Which template heading this section carries ("## Summary" → "Summary"); filled when the example has it.
    const heading = s.type === "markdown" ? (/^##\s+(.+)$/m.exec(s.markdown)?.[1] ?? "").trim() : "";
    const fill = example && s.type === "markdown" ? example[heading] : example && s.type === "dql" ? example.dqlRows : undefined;
    const tag = fill ? '<em class="tag">filled in by hand · example</em>' : "";
    const head = `<div class="kind"><span>${i + 1}</span>${kind}${s.type === "dql" && s.title ? ` · ${esc(s.title)}` : ""}${tag}</div>`;
    if (s.type === "markdown" && fill)
      return `<section>${head}${markdown(`## ${heading}\n\n${fill}`)}${
        heading === "Timeline" ? '<p class="note">† from the demo incidents\' timelines (Command Center); other rows written by hand.</p>' : ""
      }</section>`;
    if (s.type === "markdown") {
      const body = markdown(s.markdown);
      const empty = /^#+ .*$/.test(s.markdown.trim()) || /^\s*$/.test(s.markdown);
      return `<section>${head}${body}${empty ? '<p class="note">Renderer note: the template leaves this section empty for the team to fill in.</p>' : ""}</section>`;
    }
    if (s.type === "dql") {
      const tf = s.state?.input?.timeframe;
      if (fill) {
        const cols = ["display_id", "event.name", "event.status", "event.start", "event.end"];
        return (
          `<section class="dql">${head}<pre><code>${esc(s.state?.input?.value ?? "")}</code></pre>` +
          `<p class="caption">Example result (illustrative, not from a live query)</p>` +
          `<table class="result"><thead><tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>` +
          fill.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("") +
          `</tbody></table></section>`
        );
      }
      return (
        `<section class="dql">${head}<pre><code>${esc(s.state?.input?.value ?? "")}</code></pre>` +
        `<p class="note">Renderer note: timeframe ${esc(tf?.from ?? "")} → ${esc(tf?.to ?? "")}. Runs against Grail when the notebook is opened in Dynatrace; not executed here, no results shown.</p></section>`
      );
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
  /* Notes added by this renderer (not part of the notebook): set apart from the template's own text. */
  .note { margin-top: 10px; padding-top: 6px; border-top: 1px dashed var(--border); color: #7f8aa6; font: 11.5px/1.4 ui-monospace, Menlo, Consolas, monospace; }
  table { border-collapse: collapse; width: 100%; margin: 6px 0; font-size: 14px; }
  th, td { border: 1px solid var(--border); padding: 5px 10px; text-align: left; }
  ul { padding: 0 0 0 20px; margin: 6px 0; }
  ul:has(> li.task) { list-style: none; padding: 0; }
  li.task { display: flex; gap: 8px; align-items: center; }
  .box { width: 15px; height: 15px; border: 1.5px solid var(--dim); border-radius: 3px; display: inline-grid; place-items: center; font-size: 11px; }
  .tag { margin-left: auto; text-transform: none; letter-spacing: 0; font-size: 11.5px; color: #c9a75a; border: 1px solid #5a4a28; border-radius: 999px; padding: 0 8px; }
  .caption { margin: 8px 0 2px; font-size: 12px; color: #c9a75a; }
  table.result { font: 12.5px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  table.result th { color: var(--dim); font-weight: 500; }
  strong { font-weight: 600; }
  pre { margin: 6px 0; background: var(--code); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; overflow-x: auto; }
  code { font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #b9d0ff; }
</style>
</head>
<body>
<main class="wrap">
  ${
    example
      ? `<div class="banner"><b>Example post-mortem: the notebook Command Center generates, filled in by hand with demo content</b> ·
    sections and query come from the app's template (buildPostmortemNotebook); in Dynatrace it opens in Notebooks. Synthetic demo data.</div>`
      : `<div class="banner"><b>Post-mortem notebook content generated by Command Center</b> · rendered from the app's template
    (buildPostmortemNotebook) for a demo war room; in Dynatrace it opens in Notebooks. Synthetic demo data.</div>`
  }
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
