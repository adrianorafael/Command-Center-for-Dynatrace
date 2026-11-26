#!/usr/bin/env node
/**
 * Regenerates workflow-templates/command-center-engine.workflow.json from
 * ui/app/data/workflows/template.ts (bundled on the fly with the installed esbuild).
 * Usage: node scripts/gen-workflow-templates.mjs [--check]
 */
import { build } from "esbuild";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const out = join(root, "workflow-templates", "command-center-engine.workflow.json");
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
  const { engineTemplateJson } = await import(pathToFileURL(bundle).href);
  const json = engineTemplateJson();
  if (process.argv.includes("--check")) {
    const current = readFileSync(out, "utf8");
    if (current !== json) {
      console.error(`${out} is out of date — run: node scripts/gen-workflow-templates.mjs`);
      process.exit(1);
    }
    console.log("workflow template is up to date");
  } else {
    writeFileSync(out, json);
    console.log(`wrote ${out}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
