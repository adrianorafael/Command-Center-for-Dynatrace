import { describe, expect, it } from "vitest";
import type { Incident } from "../contracts";
import { createIncident } from "../incidents/actions";
import { contactChoices, providerFor } from "../notifications/plan";
import { incidentUrl, renderMessage, TEXT_LIMITS } from "../notifications/templates";
import { routeAlert } from "../routing/match";
import { atLeastAsUrgent, lessUrgentThan, parsePriority } from "../priority";
import { activeQuietHours } from "../suppression";
import { alert, contacts, services, settings, T0, teams } from "./test-utils";

function inc(title = "CPU saturation"): Incident {
  const a = alert({ sourceId: "P-00042", displayId: "P-00042", title, description: "# Root cause\n**host-a** is *busy* [link](https://example.com)" });
  return { ...createIncident(a, routeAlert(a, { rules: [], services, teams, settings: settings() }), T0), priority: "P1" };
}

describe("priority helpers", () => {
  it("boundaries", () => {
    expect(atLeastAsUrgent("P1", "P3")).toBe(true);
    expect(atLeastAsUrgent("P3", "P3")).toBe(true);
    expect(atLeastAsUrgent("P4", "P3")).toBe(false);
    expect(lessUrgentThan("P3", "P3")).toBe(false);
    expect(lessUrgentThan("P4", "P3")).toBe(true);
    expect(parsePriority("p2")).toBe("P2");
    expect(parsePriority(4)).toBe("P4");
    expect(parsePriority("high")).toBeUndefined();
  });
  it("quiet hours apply only to strictly less urgent incidents", () => {
    const team = { ...teams[0]!, quietHours: [{ timeZone: "UTC", days: [1], from: "00:00", to: "24:00", minPriority: "P3" as const, mode: "hold" as const }] };
    expect(activeQuietHours(team, "P3", T0)).toBeUndefined();
    expect(activeQuietHours(team, "P4", T0)?.mode).toBe("hold");
    expect(activeQuietHours(team, "P4", T0 + 86_400_000)).toBeUndefined(); // Tuesday
  });
});

describe("templates", () => {
  it("SMS ≤ 300 chars, keeps the link, includes id and priority", () => {
    const url = incidentUrl("dp-p-00042", "https://env.example.com/ui/apps/my.command.center");
    const m = renderMessage(inc("x".repeat(1000)), "sms", { incidentUrl: url, serviceName: "Checkout" });
    expect(m.text.length).toBeLessThanOrEqual(TEXT_LIMITS.sms);
    expect(m.text).toContain(url);
    expect(m.text).toContain("P1 P-00042");
    expect(m.speech).toBeUndefined();
  });
  it("voice gets a speech text without URL; chat strips markdown", () => {
    const v = renderMessage(inc(), "voice", { incidentUrl: "/x" });
    expect(v.speech).toContain("priority 1");
    expect(v.speech).toContain("P 0 0 0 4 2");
    expect(v.speech).not.toContain("http");
    const s = renderMessage(inc(), "slack", { incidentUrl: "/x", teamName: "NOC Core" });
    expect(s.text).toContain("Details: Root cause host-a is busy link");
    expect(s.text).toContain("NOC Core");
    expect(s.subject).toContain("[P1] P-00042");
    for (const ch of Object.keys(TEXT_LIMITS) as (keyof typeof TEXT_LIMITS)[]) {
      expect(renderMessage(inc("y".repeat(9000)), ch, { incidentUrl: "/x" }).text.length).toBeLessThanOrEqual(TEXT_LIMITS[ch]);
    }
  });
});

describe("contact choices", () => {
  const step = { delayMinutes: 0, targets: [] };
  it("rules by priority, one per channel, delays", () => {
    const c = contactChoices(contacts[0], step, "P1");
    expect(c.map((x) => [x.channel, x.delayMs])).toEqual([["sms", 0], ["voice", 300_000]]);
    expect(contactChoices(contacts[0], step, "P3").map((x) => x.channel)).toEqual(["sms"]);
    expect(contactChoices(contacts[1], step, "P3").map((x) => x.channel)).toEqual(["slack"]); // no rules → all methods
    expect(contactChoices(contacts[0], { ...step, channels: ["voice", "telegram"] }, "P5").map((x) => x.channel)).toEqual(["voice"]);
    expect(contactChoices(contacts[0], step, "P1", ["slack"])).toEqual([]);
    expect(contactChoices(undefined, step, "P1")).toEqual([]);
  });
  it("first enabled provider per channel", () => {
    const s = settings();
    s.providers = [{ id: "a", name: "A", channel: "sms", kind: "twilio", enabled: false, params: {} }, { id: "b", name: "B", channel: "sms", kind: "webhook", enabled: true, params: {} }];
    expect(providerFor(s, "sms")?.id).toBe("b");
    expect(providerFor(s, "voice")).toBeUndefined();
  });
});
