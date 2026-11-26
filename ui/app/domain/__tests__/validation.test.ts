import { describe, expect, it } from "vitest";
import { defaultSettings } from "../validation/defaults";
import { looksLikeSecret, validatePolicy, validateRules, validateSchedule, validateService, validateSettings, validateTeam, validateUserContact } from "../validation/validate";
import { contacts, policy, schedules, services, teams } from "./test-utils";

const paths = (e: { path: string }[]) => e.map((x) => x.path);

describe("validation", () => {
  it("valid fixtures pass", () => {
    expect(validateTeam(teams[0]!, { policies: [policy] })).toEqual([]);
    expect(validateSchedule(schedules[0]!, { teams })).toEqual([]);
    expect(validatePolicy(policy, { schedules, teams })).toEqual([]);
    expect(validateService(services[0]!, { teams, policies: [policy] })).toEqual([]);
    expect(validateUserContact(contacts[0]!)).toEqual([]);
    expect(validateSettings(defaultSettings())).toEqual([]);
  });
  it("catches common mistakes", () => {
    expect(paths(validateTeam({ ...teams[0]!, id: "Bad.Id", name: "", members: [{ uid: "a", role: "admin" }, { uid: "a", role: "admin" }] }))).toEqual(["id", "name", "members[1].uid"]);
    expect(paths(validateSchedule({ ...schedules[0]!, timeZone: "Mars/Base", layers: [{ ...schedules[0]!.layers[0]!, handoffTime: "25:00", participants: [], restrictions: [{ days: [], from: "09:00", to: "x" }] }], overrides: [{ id: "o", uid: "u", from: 2, to: 1 }] })))
      .toEqual(["timeZone", "layers[0].participants", "layers[0].handoffTime", "layers[0].restrictions[0].days", "layers[0].restrictions[0].to", "overrides[0].to"]);
    expect(paths(validatePolicy({ ...policy, repeat: -1, steps: [{ delayMinutes: 1.5, targets: [{ type: "schedule", scheduleId: "nope" }] }] }, { schedules })))
      .toEqual(["repeat", "steps[0].delayMinutes", "steps[0].targets[0]"]);
    expect(paths(validateRules({ schemaVersion: 1, rev: 1, rules: [{ id: "r1", name: "R", enabled: true, match: "all", conditions: [{ field: "title", op: "regex", value: "(" }, { field: "bogus", op: "equals", value: "x" }], then: {} }] })))
      .toEqual(["rules[0].conditions[0].value", "rules[0].conditions[1].field", "rules[0].then"]);
    expect(paths(validateUserContact({ ...contacts[0]!, methods: [{ id: "m1", channel: "sms", address: "0800" }], rules: [{ maxPriority: "P1", methodId: "zz", delayMinutes: 0 }] })))
      .toEqual(["methods[0].address", "rules[0].methodId"]);
  });
  it("providers: vault id format and no secrets in params", () => {
    const s = defaultSettings();
    s.providers[0] = { ...s.providers[0]!, enabled: true, credentialVaultId: "vault-1", params: { from: "+15550100000", url: "https://hooks.example.com/abc" } };
    expect(paths(validateSettings(s))).toEqual(["providers[0].credentialVaultId", "providers[0].params.url"]);
    expect(looksLikeSecret("+15550100000")).toBe(false);
    expect(looksLikeSecret("command_center_alert")).toBe(false);
  });
});
