import { describe, expect, it } from "vitest";
import { dedupKeyFor, fnv1a, incidentIdFor, randomId, sanitizeId, seededRng } from "../ids";
import { isValidKey, notificationKey, parseNotificationKey, withAttempt, KEY, newActionKey, incidentIdFromActionKey } from "../keys";

describe("ids & keys", () => {
  it("sanitises to [a-z0-9._-]", () => {
    expect(sanitizeId("Hello World/ÄÖ:42")).toBe("hello-world-42");
    expect(sanitizeId("")).toBe("x");
    expect(sanitizeId("--a..b--")).toBe("a..b");
  });
  it("caps long ids with a hash suffix and keeps them distinct", () => {
    const a = sanitizeId("x".repeat(500) + "a", 50);
    const b = sanitizeId("x".repeat(500) + "b", 50);
    expect(a.length).toBeLessThanOrEqual(50);
    expect(a).not.toBe(b);
  });
  it("fnv1a is stable", () => {
    expect(fnv1a("")).toBe("811c9dc5");
    expect(fnv1a("a")).toBe("e40c292c");
    expect(fnv1a("user-0001")).toMatch(/^[0-9a-f]{8}$/);
  });
  it("incident ids have no dots and stay short", () => {
    const id = incidentIdFor({ source: "davis-event", sourceId: "4869410437100314995_1795729143750" });
    expect(id).toBe("de-4869410437100314995_1795729143750");
    const long = incidentIdFor({ source: "generic-event", sourceId: "A.B.".repeat(100) });
    expect(long).not.toContain(".");
    expect(long.length).toBeLessThanOrEqual(64);
    expect(dedupKeyFor("davis-problem", "P-2611261")).toBe("davis-problem.p-2611261");
  });
  it("keys are valid and ≤200 chars", () => {
    const inc = incidentIdFor({ source: "generic-event", sourceId: "Z".repeat(1000) });
    const k = KEY.notification(notificationKey({ incidentId: inc, cycle: 99, step: 999, uid: "u".repeat(300), channel: "whatsapp", attempt: 3 }));
    expect(isValidKey(k)).toBe(true);
    expect(isValidKey("Bad Key")).toBe(false);
    expect(isValidKey("a".repeat(201))).toBe(false);
    const ak = newActionKey(inc, 1700000000000, seededRng(1));
    expect(isValidKey(ak)).toBe(true);
    expect(incidentIdFromActionKey(ak)).toBe(inc);
  });
  it("parses notification keys and swaps attempts", () => {
    const key = notificationKey({ incidentId: "dp-p-1", cycle: 2, step: 3, uid: "user-0001", channel: "sms", attempt: 1 });
    expect(parseNotificationKey(key)).toMatchObject({ incidentId: "dp-p-1", cycle: 2, step: 3, channel: "sms", attempt: 1 });
    expect(withAttempt(key, 2).endsWith(".sms.2")).toBe(true);
  });
  it("random ids use the injected rng", () => {
    expect(randomId(seededRng(7))).toBe(randomId(seededRng(7)));
    expect(randomId(() => 0.999999, 3)).toBe("zzz");
  });
});
