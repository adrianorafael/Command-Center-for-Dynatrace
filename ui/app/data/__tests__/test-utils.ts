/**
 * Test harness: runs a workflow task source (ES module text) inside node:vm with stubbed
 * automation-utils / credential-vault imports and a mocked fetch.
 */
import vm from "node:vm";

export interface FetchCall {
  url: string;
  init: { method?: string; headers?: Record<string, string>; body?: string; signal?: unknown };
}

export interface MockResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface HarnessOptions {
  tickResult?: unknown;
  results?: Record<string, unknown>;
  execution?: unknown;
  credentials?: Record<string, Record<string, string>>;
  respond?: (call: FetchCall) => MockResponse | Promise<MockResponse>;
  /** Remove getCredentialVaultEntryDetails from the stub (feature-detection test). */
  noVaultDetails?: boolean;
}

const IMPORT_RE = /^import\s+\{\s*([\w\s,]+)\}\s+from\s+"([^"]+)";\s*$/gm;

/** Strip imports + `export default`, so the module body can run as a function body. */
export function toFunctionBody(source: string): { body: string; imports: string[] } {
  const imports: string[] = [];
  const body = source
    .replace(IMPORT_RE, (_m, names: string) => {
      imports.push(...names.split(",").map((s) => s.trim()).filter(Boolean));
      return "";
    })
    .replace(/export default async function/, "return async function");
  return { body, imports };
}

/** Compile only (syntax check). Throws SyntaxError on invalid JS. */
export function compileScript(source: string): void {
  const { body, imports } = toFunctionBody(source);
  new vm.Script(`(function (${imports.join(", ")}) {\n${body}\n})`);
  if (/export\s/.test(body)) throw new Error("unexpected export left in script");
}

export async function runScript(source: string, opts: HarnessOptions = {}) {
  const calls: FetchCall[] = [];
  const vaultCalls: string[] = [];
  const stubs: Record<string, unknown> = {
    result: (name: string) => {
      if (name === "tick" && opts.tickResult !== undefined) return Promise.resolve(opts.tickResult);
      if (opts.results && name in opts.results) {
        const v = opts.results[name];
        return v instanceof Error ? Promise.reject(v) : Promise.resolve(v);
      }
      return Promise.reject(new Error(`no result for ${name}`));
    },
    execution: () => Promise.resolve(opts.execution ?? { params: {}, triggerType: "Schedule" }),
    credentialVaultEntriesClient: opts.noVaultDetails
      ? {}
      : {
          getCredentialVaultEntryDetails: ({ entryId }: { entryId: string }) => {
            vaultCalls.push(entryId);
            const c = opts.credentials?.[entryId];
            return c ? Promise.resolve(c) : Promise.reject(new Error("credential not found"));
          },
        },
  };
  const fetch = async (url: string, init: FetchCall["init"] = {}) => {
    const call = { url, init };
    calls.push(call);
    const r = (await opts.respond?.(call)) ?? { status: 200, body: { ok: true } };
    const status = r.status ?? 200;
    const text = typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {});
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (h: string) => r.headers?.[h.toLowerCase()] ?? null },
      text: () => Promise.resolve(text),
      json: () => Promise.resolve(JSON.parse(text) as unknown),
    };
  };
  const { body, imports } = toFunctionBody(source);
  const context = vm.createContext({
    fetch,
    AbortSignal,
    URLSearchParams,
    btoa: (s: string) => Buffer.from(s, "binary").toString("base64"),
  });
  const factory = vm.runInContext(`(function (${imports.join(", ")}) {\n${body}\n})`, context) as (
    ...args: unknown[]
  ) => () => Promise<unknown>;
  const main = factory(...imports.map((n) => stubs[n]));
  const output = await main();
  return { output, calls, vaultCalls };
}
