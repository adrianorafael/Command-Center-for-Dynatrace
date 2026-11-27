#!/usr/bin/env node
/**
 * Regenerates the in-app documentation modules from the markdown guides, one module per language:
 *   docs/guides/en/*.md                    → ui/app/pages/help/guides/generated/en.ts
 *   ui/app/pages/help/guides/pt-BR/*.md    → ui/app/pages/help/guides/generated/pt-BR.ts
 *   ui/app/pages/help/guides/es/*.md       → ui/app/pages/help/guides/generated/es.ts
 * The markdown is the source of truth; the transform lives in ui/app/pages/help/guides/content.ts (bundled on the fly
 * with the installed esbuild, like gen-workflow-templates.mjs), so the drift test runs the very same code.
 * Usage: node scripts/gen-help-content.mjs [--check]
 */
import { build } from "esbuild";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const check = process.argv.includes("--check");
const dir = mkdtempSync(join(tmpdir(), "cc-help-"));
try {
  const bundle = join(dir, "content.mjs");
  await build({
    entryPoints: [join(root, "ui/app/pages/help/guides/content.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: bundle,
    logLevel: "error",
  });
  const { LANGUAGES, GUIDE_IDS, SOURCE_DIRS, GENERATED_FILES, transformGuides, renderLanguageModule } = await import(
    pathToFileURL(bundle).href
  );
  let stale = false;
  for (const lang of LANGUAGES) {
    const sources = Object.fromEntries(
      GUIDE_IDS.map((id) => [id, readFileSync(join(root, SOURCE_DIRS[lang], `${id}.md`), "utf8")]),
    );
    const code = renderLanguageModule(lang, SOURCE_DIRS[lang], transformGuides(sources));
    const out = join(root, GENERATED_FILES[lang]);
    if (check) {
      let current = "";
      try {
        current = readFileSync(out, "utf8");
      } catch {
        // missing file: reported as out of date below
      }
      if (current !== code) {
        console.error(`${out} is out of date — run: node scripts/gen-help-content.mjs`);
        stale = true;
      }
    } else {
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, code);
      console.log(`wrote ${out} (${Buffer.byteLength(code)} bytes)`);
    }
  }
  if (check) {
    if (stale) process.exit(1);
    console.log("help content is up to date");
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
