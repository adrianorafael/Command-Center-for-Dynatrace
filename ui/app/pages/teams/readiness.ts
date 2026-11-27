/**
 * What a team needs before an alert reaches one of its people, as plain data (no React): the five setup steps
 * of the "Ready to page?" checklist, and what can still stop a message outside the team.
 */
import type { Team } from "../../domain/contracts";
import type { AppData } from "../../hooks/AppDataContext";
import { CHANNEL_LABEL } from "../../components/channelLabels";

/** Which setup step an item is about (also selects its fix button). */
export type ReadinessFix = "members" | "contacts" | "schedule" | "policy" | "routing";

/** One checklist line. */
export interface ReadinessItem {
  key: ReadinessFix;
  title: string;
  done: boolean;
  /** What is in place, or what is missing. */
  detail: string;
  fixLabel: string;
  /** True while an earlier step has to be done first: no button is offered. */
  blocked?: boolean;
  /** For "routing": what the fix button does. */
  routingFix?: "default-team" | "rule";
}

/** The five things a team needs before it can be paged, in the order to set them up. */
export function teamReadiness(team: Team, data: AppData, userName: (uid: string) => string): ReadinessItem[] {
  const paged = team.members.filter((m) => m.role !== "observer");
  const reachable = paged.filter((m) => (data.contacts.find((c) => c.uid === m.uid)?.methods.length ?? 0) > 0);
  const unreachable = paged.filter((m) => !reachable.includes(m)).map((m) => userName(m.uid));
  const schedules = data.schedules.filter((s) => s.teamId === team.id);
  const policy = data.policies.find((p) => p.id === team.defaultPolicyId);
  const services = data.services.filter((s) => s.teamId === team.id);
  const serviceIds = new Set(services.map((s) => s.id));
  // Enabled rules that send alerts here: directly, or through one of the team's services.
  const rules = data.rules.rules.filter(
    (r) => r.enabled && !r.then.suppress && (r.then.teamId === team.id || (!r.then.teamId && !!r.then.serviceId && serviceIds.has(r.then.serviceId))),
  );
  const isDefault = data.settings.defaults.teamId === team.id;
  const defaultTeam = data.teams.find((t) => t.id === data.settings.defaults.teamId);

  return [
    {
      key: "members",
      title: "People who get paged",
      done: paged.length > 0,
      detail:
        paged.length > 0
          ? `${paged.length} of ${team.members.length} ${team.members.length === 1 ? "member gets" : "members get"} paged (responders and team admins)`
          : team.members.length
            ? "Only observers so far: add a responder or team admin"
            : "No members yet",
      fixLabel: "Add people",
    },
    {
      key: "contacts",
      title: "Contact methods",
      done: paged.length > 0 && unreachable.length === 0,
      detail:
        paged.length === 0
          ? "Add people first"
          : unreachable.length === 0
            ? `All ${paged.length} have a contact method`
            : `${reachable.length} of ${paged.length} have a contact method. Missing: ${unreachable.join(", ")}`,
      fixLabel: "Add contact methods",
      blocked: paged.length === 0,
    },
    {
      key: "schedule",
      title: "On-call schedule",
      done: schedules.length > 0,
      detail: schedules.length ? `${schedules.map((s) => s.name).join(", ")}` : paged.length ? "No schedule decides who is on call for this team" : "Add people first",
      fixLabel: "Create schedule",
      blocked: paged.length === 0,
    },
    {
      key: "policy",
      title: "Escalation policy",
      done: !!policy,
      detail: policy ? `${policy.name} (team default)` : "No default policy: incidents for this team won't escalate",
      fixLabel: data.policies.some((p) => p.teamId === team.id) ? "Choose default policy" : "Create policy",
    },
    {
      key: "routing",
      title: "Alerts routed to this team",
      // A service alone routes nothing by itself: only events that name it in cc.service arrive.
      done: isDefault || rules.length > 0,
      detail: isDefault
        ? `Default team: receives every alert that no routing rule sends elsewhere${rules.length ? `, plus ${rules.length} routing ${rules.length === 1 ? "rule" : "rules"}` : ""}`
        : rules.length
          ? `${rules.length} routing ${rules.length === 1 ? "rule sends" : "rules send"} alerts here`
          : services.length
            ? `Only events that name ${services.map((x) => x.name).join(" or ")} in cc.service arrive. Problems that Davis detects on its own need a routing rule or the default team`
            : "No alert reaches this team yet",
      fixLabel: defaultTeam ? "Add routing rule" : "Receive all unrouted alerts",
      routingFix: defaultTeam ? "rule" : "default-team",
    },
  ];
}

/** A problem outside the team that can stop its pages, with the place to fix it. */
export interface DeliveryIssue {
  text: string;
  /** In-app path that fixes it. */
  to: string;
  action: string;
  /** True when nothing can be sent until this is fixed; false when only some channels are affected. */
  all: boolean;
}

/**
 * What still stops a message from leaving, outside the team itself: a channel the team uses without a provider
 * switched on, or an engine that has never run. Without this, "Ready to page" would promise too much.
 */
export function deliveryIssues(team: Team, data: AppData, demo: boolean): DeliveryIssue[] {
  const issues: DeliveryIssue[] = [];
  const paged = new Set(team.members.filter((m) => m.role !== "observer").map((m) => m.uid));
  const used = new Set(data.contacts.filter((c) => paged.has(c.uid)).flatMap((c) => c.methods.map((m) => m.channel)));
  const on = new Set(data.settings.providers.filter((p) => p.enabled).map((p) => p.channel));
  const off = [...used].filter((c) => !on.has(c));
  if (off.length)
    issues.push({
      text: `No provider is switched on for ${off.map((c) => CHANNEL_LABEL[c]).join(", ")}: these messages can't be sent yet.`,
      to: "/integrations?tab=outbound",
      action: "Open Integrations",
      all: off.length === used.size,
    });
  // Demo mode has no engine to install.
  if (!demo && !data.heartbeat)
    issues.push({ text: "The paging engine has not run yet: install its workflow.", to: "/integrations?tab=workflows", action: "Install the engine", all: true });
  return issues;
}
