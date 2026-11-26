/**
 * Domain core public API (pure TypeScript — no React, no Dynatrace SDK, time injected as `now`).
 */

export * from "./contracts";
export * from "./ids";
export * from "./keys";
export * from "./priority";
export * from "./time/tz";
export * from "./alerts/normalize";
export * from "./alerts/dedup";
export * from "./routing/match";
export * from "./schedule/resolve";
export * from "./schedule/timeline";
export * from "./escalation/targets";
export * from "./escalation/machine";
export * from "./incidents/actions";
export * from "./notifications/templates";
export * from "./notifications/plan";
export * from "./suppression";
export * from "./engine/tick";
export * from "./engine/delivery";
export * from "./reports/metrics";
export * from "./validation/defaults";
export * from "./validation/validate";
export * from "./demo/fixtures";
