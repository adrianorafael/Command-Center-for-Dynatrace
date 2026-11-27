#!/usr/bin/env node
/**
 * Regenerates the importable workflow templates from ui/app/data/workflows/template.ts
 * (bundled on the fly with the installed esbuild):
 *   workflow-templates/command-center-engine.workflow.json             the engine (interval trigger)
 *   workflow-templates/command-center-engine-on-problem.workflow.json  optional: the engine on a Problem trigger
 * Usage: node scripts/gen-workflow-templates.mjs [--check]
 */
import { build } from "esbuild";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const dir = mkdtempSync(join(tmpdir(), "cc-wf-"));
try {
  const bundle = join(dir, "template.mjs");
  await build({
    entryPoints: [join(root, "ui/app/data/workflows/template.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: bundle,
    logLevel: "error",
  });
  const { engineTemplateJson, onProblemTemplateJson } = await import(pathToFileURL(bundle).href);
  const files = [
    ["command-center-engine.workflow.json", engineTemplateJson()],
    ["command-center-engine-on-problem.workflow.json", onProblemTemplateJson()],
  ];
  let stale = false;
  for (const [name, json] of files) {
    const out = join(root, "workflow-templates", name);
    if (process.argv.includes("--check")) {
      let current = "";
      try {
        current = readFileSync(out, "utf8");
      } catch {
        // missing file: reported as out of date below
      }
      if (current !== json) {
        console.error(`${out} is out of date — run: node scripts/gen-workflow-templates.mjs`);
        stale = true;
      }
    } else {
      writeFileSync(out, json);
      console.log(`wrote ${out}`);
    }
  }
  if (process.argv.includes("--check")) {
    if (stale) process.exit(1);
    console.log("workflow templates are up to date");
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
