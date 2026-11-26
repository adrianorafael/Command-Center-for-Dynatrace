import { describe, expect, it } from "vitest";
import type { RoutingRule } from "../contracts";
import { evaluateCondition, firstMatchingRule, routeAlert, safeRegex } from "../routing/match";
import { alert, services, settings, teams } from "./test-utils";

const r = (id: string, p: Partial<RoutingRule>): RoutingRule => ({ id, name: id, enabled: true, match: "all", conditions: [], then: {}, ...p });

describe("routing", () => {
  const a = alert({ sourceId: "P-1", title: "Checkout payment errors", category: "ERROR", severity: 2, tags: ["env:prod", "team:payments"], fields: { "cc.service": "checkout", "k8s.namespace": "pay" } });

  it("operators, multi-valued fields and negate", () => {
    expect(evaluateCondition(a, { field: "title", op: "contains", value: "PAYMENT" })).toBe(true);
    expect(evaluateCondition(a, { field: "title", op: "equals", value: "checkout payment errors" })).toBe(true);
    expect(evaluateCondition(a, { field: "category", op: "in", value: "SLOWDOWN, error" })).toBe(true);
    expect(evaluateCondition(a, { field: "severity", op: "lte", value: "2" })).toBe(true);
    expect(evaluateCondition(a, { field: "severity", op: "gte", value: "3" })).toBe(false);
    expect(evaluateCondition(a, { field: "tag", op: "equals", value: "team:payments" })).toBe(true);
    expect(evaluateCondition(a, { field: "entity.name", op: "regex", value: "^host-[a-z]$" })).toBe(true);
    expect(evaluateCondition(a, { field: "fields.k8s.namespace", op: "equals", value: "pay" })).toBe(true);
    expect(evaluateCondition(a, { field: "rootCause.name", op: "exists" })).toBe(false);
    expect(evaluateCondition(a, { field: "rootCause.name", op: "exists", negate: true })).toBe(true);
    expect(evaluateCondition(a, { field: "tag", op: "equals", value: "env:dev", negate: true })).toBe(true);
  });
  it("invalid or huge regex never throws and never matches", () => {
    expect(safeRegex("(")).toBeNull();
    expect(evaluateCondition(a, { field: "title", op: "regex", value: "(" })).toBe(false);
    expect(evaluateCondition(a, { field: "title", op: "regex", value: "a".repeat(600) })).toBe(false);
  });
  it("first enabled match wins; all/any; catch-all", () => {
    const rules = [
      r("disabled", { enabled: false, then: { priority: "P1" } }),
      r("any", { match: "any", conditions: [{ field: "title", op: "contains", value: "nope" }, { field: "category", op: "equals", value: "ERROR" }], then: { priority: "P2" } }),
      r("all", { conditions: [{ field: "title", op: "contains", value: "checkout" }], then: { priority: "P1" } }),
      r("catch", { then: { priority: "P5" } }),
    ];
    expect(firstMatchingRule(a, rules)?.id).toBe("any");
    expect(firstMatchingRule(alert({ sourceId: "x", title: "zzz" }), rules)?.id).toBe("catch");
    expect(firstMatchingRule(alert({ sourceId: "x", title: "zzz" }), rules.slice(0, 3))).toBeUndefined();
  });
  it("route decision and priority derivation chain", () => {
    const s = settings();
    const ctx = { rules: [] as RoutingRule[], services, teams, settings: s };
    // cc.service resolves the service, its team and policy
    const d0 = routeAlert(a, ctx);
    expect(d0).toMatchObject({ serviceId: "checkout", teamId: "noc", policyId: "pol-noc", priority: "P2", prioritySource: "severity" });
    // rule priority beats everything
    const d1 = routeAlert(a, { ...ctx, rules: [r("x", { then: { priority: "P4", addTags: ["routed"], teamId: "noc" } })] });
    expect(d1).toMatchObject({ ruleId: "x", priority: "P4", prioritySource: "rule", addTags: ["routed"] });
    // cc.priority beats service/default
    expect(routeAlert({ ...a, fields: { "cc.priority": "1" } }, ctx)).toMatchObject({ priority: "P1", prioritySource: "alert" });
    // service default priority beats settings maps
    const svc = [{ ...services[0]!, defaultPriority: "P5" as const }];
    expect(routeAlert(a, { ...ctx, services: svc })).toMatchObject({ priority: "P5", prioritySource: "service" });
    // category map, then default
    expect(routeAlert(alert({ sourceId: "y", category: "AVAILABILITY" }), ctx)).toMatchObject({ priority: "P1", prioritySource: "category" });
    expect(routeAlert(alert({ sourceId: "z" }), ctx)).toMatchObject({ priority: "P3", prioritySource: "default", teamId: "noc", policyId: "pol-noc" });
    // suppress
    expect(routeAlert(a, { ...ctx, rules: [r("s", { then: { suppress: true } })] }).suppress).toBe(true);
  });
});
