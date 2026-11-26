#!/usr/bin/env node
/**
 * Offline preview of the built app (no tenant): serves dist/ui under /ui/ with SPA fallback and
 * an empty stub for the platform runtime loader the built index.html references
 * (/platform/runtime/runtime-loader.js). Without the runtime, @dynatrace-sdk/app-environment
 * reports 'dt.missing.environment.id', so the app switches itself into demo mode.
 *
 * Usage: npx dt-app build && node scripts/preview-server.mjs [--port 4173] [--dir dist/ui]
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const port = Number(opt("port", process.env.PORT ?? "4173"));
const root = resolve(opt("dir", "dist/ui"));

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
  ".ico": "image/x-icon",
};

async function fileIfExists(p) {
  try {
    const s = await stat(p);
    return s.isFile() ? p : undefined;
  } catch {
    return undefined;
  }
}

function send(res, status, type, body) {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = decodeURIComponent(url.pathname);

    if (path.startsWith("/platform/runtime/")) {
      return send(res, 200, TYPES[".js"], "/* runtime stub: offline preview */\n");
    }
    if (path === "/" || path === "/ui") {
      res.writeHead(302, { Location: `/ui/${url.search}` });
      return res.end();
    }
    if (!path.startsWith("/ui/")) return send(res, 404, "text/plain", "not found");

    const rel = normalize(path.slice("/ui/".length));
    const candidate = join(root, rel);
    if (candidate !== root && !candidate.startsWith(root + sep)) return send(res, 403, "text/plain", "forbidden");

    const file = (rel && (await fileIfExists(candidate))) || (extname(rel) ? undefined : join(root, "index.html"));
    if (!file) return send(res, 404, "text/plain", "not found");
    const body = await readFile(file);
    return send(res, 200, TYPES[extname(file)] ?? "application/octet-stream", body);
  } catch (e) {
    return send(res, 500, "text/plain", String(e && e.message ? e.message : e));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`preview: http://127.0.0.1:${port}/ui/?demo=1  (serving ${root})`);
});
