import { describe, expect, it } from "vitest";
import { buildDemoData } from "../demo/fixtures";
import { isValidKey, KEY } from "../keys";
import { validatePolicy, validateRules, validateSchedule, validateService, validateSettings, validateTeam, validateUserContact } from "../validation/validate";
import { tick } from "../engine/tick";

const NOW = Date.UTC(2026, 10, 26, 15, 0, 0);

describe("demo fixtures", () => {
  const d = buildDemoData(NOW);
  it("is rich and deterministic", () => {
    expect(d.teams.map((t) => t.name)).toEqual(["NOC Core", "Payments SRE", "Platform", "Database"]);
    expect(d.directory).toHaveLength(10);
    expect(d.incidents.length).toBeGreaterThanOrEqual(22);
    const statuses = new Set(d.incidents.map((i) => i.status));
    expect(statuses).toEqual(new Set(["triggered", "acknowledged", "snoozed", "resolved"]));
    expect(new Set(d.incidents.map((i) => i.priority)).size).toBeGreaterThanOrEqual(4);
    expect(d.notifications.length).toBeGreaterThan(20);
    expect(new Set(d.notifications.map((n) => n.status))).toContain("sent");
    expect(d.notifications.some((n) => n.status === "failed")).toBe(true);
    expect(d.notifications.some((n) => n.status === "timeout")).toBe(true);
    expect(d.notifications.some((n) => n.attempt === 2)).toBe(true);
    expect(d.rollups.length).toBeGreaterThanOrEqual(15);
    expect(d.actions.length).toBeGreaterThanOrEqual(1);
    expect(d.incidents.some((i) => i.suppressed === "maintenance")).toBe(true);
    expect(d.incidents.some((i) => i.suppressed === "rule")).toBe(true);
    expect(JSON.stringify(buildDemoData(NOW))).toBe(JSON.stringify(d));
  });
  it("is synthetic only", () => {
    const json = JSON.stringify(d);
    const emails: string[] = json.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
    expect(emails.every((e) => e.endsWith("@example.com"))).toBe(true);
    expect(json).not.toMatch(/\b(HOST|SERVICE|PROCESS_GROUP|APPLICATION|KUBERNETES_CLUSTER)-[0-9A-F]{16}\b/);
    expect(json).not.toMatch(/\b[a-z]{3}[0-9]{5}\b/);
    expect(d.settings.providers.filter((p) => p.enabled).every((p) => /^CREDENTIALS_VAULT-0{15}\d$/.test(p.credentialVaultId ?? ""))).toBe(true);
  });
  it("passes validation and produces valid keys", () => {
    const ctx = { teams: d.teams, schedules: d.schedules, policies: d.policies, services: d.services };
    expect(validateSettings(d.settings, ctx)).toEqual([]);
    for (const t of d.teams) expect(validateTeam(t, ctx)).toEqual([]);
    for (const s of d.schedules) expect(validateSchedule(s, ctx)).toEqual([]);
    for (const p of d.policies) expect(validatePolicy(p, ctx)).toEqual([]);
    for (const s of d.services) expect(validateService(s, ctx)).toEqual([]);
    expect(validateRules(d.rules, ctx)).toEqual([]);
    for (const c of d.contacts) expect(validateUserContact(c)).toEqual([]);
    for (const i of d.incidents) expect(isValidKey(KEY.incident(i.id))).toBe(true);
    for (const n of d.notifications) expect(isValidKey(KEY.notification(n.key))).toBe(true);
    for (const a of d.actions) expect(isValidKey(a.key)).toBe(true);
  });
  it("a tick over the demo state at the same instant plans nothing new", () => {
    const out = tick({ now: NOW, settings: d.settings, teams: d.teams, schedules: d.schedules, policies: d.policies, services: d.services, rules: d.rules, contacts: d.contacts, incidents: d.incidents, pendingActions: [], ledger: d.notifications, alerts: [] });
    expect(Object.values(out.batches).flat()).toHaveLength(0);
  });
});
