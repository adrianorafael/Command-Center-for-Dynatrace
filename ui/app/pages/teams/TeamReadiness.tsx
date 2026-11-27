import React, { useState } from "react";
import { Button } from "@dynatrace/strato-components/buttons";
import { Flex, Surface } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { CircleIcon, SuccessIcon, WarningIcon } from "@dynatrace/strato-icons";
import Colors from "@dynatrace/strato-design-tokens/colors";
import type { Team } from "../../domain/contracts";
import type { AppData } from "../../hooks/AppDataContext";

export type ReadinessFix = "members" | "contacts" | "schedule" | "policy" | "routing";

export interface ReadinessItem {
  key: ReadinessFix;
  title: string;
  done: boolean;
  /** What is in place, or what is missing. */
  detail: string;
  fixLabel: string;
}

/** The five things a team needs before it can be paged, in the order to set them up. */
export function teamReadiness(team: Team, data: AppData, userName: (uid: string) => string): ReadinessItem[] {
  const paged = team.members.filter((m) => m.role !== "observer");
  const reachable = paged.filter((m) => (data.contacts.find((c) => c.uid === m.uid)?.methods.length ?? 0) > 0);
  const unreachable = paged.filter((m) => !reachable.includes(m)).map((m) => userName(m.uid));
  const schedules = data.schedules.filter((s) => s.teamId === team.id);
  const policy = data.policies.find((p) => p.id === team.defaultPolicyId);
  const services = data.services.filter((s) => s.teamId === team.id);
  const rules = data.rules.rules.filter((r) => r.enabled && r.then.teamId === team.id);
  const isDefault = data.settings.defaults.teamId === team.id;

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
            ? `All ${paged.length} can be notified`
            : `${reachable.length} of ${paged.length} can be notified. Missing: ${unreachable.join(", ")}`,
      fixLabel: "Add contact methods",
    },
    {
      key: "schedule",
      title: "On-call schedule",
      done: schedules.length > 0,
      detail: schedules.length ? `${schedules.map((s) => s.name).join(", ")}` : "No schedule decides who is on call for this team",
      fixLabel: "Create schedule",
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
      done: services.length > 0 || rules.length > 0 || isDefault,
      detail:
        services.length || rules.length || isDefault
          ? [
              services.length ? `${services.length} ${services.length === 1 ? "service" : "services"}` : "",
              rules.length ? `${rules.length} routing ${rules.length === 1 ? "rule" : "rules"}` : "",
              isDefault ? "default team in Settings" : "",
            ]
              .filter(Boolean)
              .join(", ")
          : "No service or routing rule sends alerts here yet",
      fixLabel: "Create service",
    },
  ];
}

/** "Ready to page?" checklist at the top of the team detail page. */
export const TeamReadiness = ({ items, onFix }: { items: ReadinessItem[]; onFix: (key: ReadinessFix) => void }) => {
  const done = items.filter((i) => i.done).length;
  const ready = done === items.length;
  const [expanded, setExpanded] = useState(false);
  return (
    ready && !expanded ? (
      <Surface padding={12}>
        <Flex alignItems="center" gap={8} justifyContent="space-between" flexWrap="wrap">
          <Flex alignItems="center" gap={8}>
            <SuccessIcon style={{ color: Colors.Icon.Success.Default }} />
            <Text>Ready to page: all {items.length} setup steps are done.</Text>
          </Flex>
          <Button size="condensed" variant="default" onClick={() => setExpanded(true)}>
            Show steps
          </Button>
        </Flex>
      </Surface>
    ) : (
    <Surface padding={16}>
      <Flex flexDirection="column" gap={12}>
        <Flex alignItems="center" gap={8} justifyContent="space-between" flexWrap="wrap">
          <Heading level={4}>Ready to page?</Heading>
          <Text textStyle="small">
            {done} of {items.length} steps done
          </Text>
        </Flex>
        {ready ? (
          <Flex alignItems="center" gap={8}>
            <SuccessIcon style={{ color: Colors.Icon.Success.Default }} />
            <Text>This team is ready to receive pages.</Text>
          </Flex>
        ) : (
          <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued }}>
            An alert reaches a person when it is routed to this team, the team's escalation policy targets its on-call schedule (or its members),
            and that person has a contact method. Work through the steps in order.
          </Text>
        )}
        <Flex flexDirection="column" gap={8}>
          {items.map((it, i) => (
            <Flex key={it.key} alignItems="center" gap={12}>
              <Flex style={{ width: 20, flexShrink: 0 }} justifyContent="center">
                {it.done ? (
                  <SuccessIcon style={{ color: Colors.Icon.Success.Default }} aria-label="Done" />
                ) : i === items.findIndex((x) => !x.done) ? (
                  <WarningIcon style={{ color: Colors.Icon.Warning.Default }} aria-label="Next step" />
                ) : (
                  <CircleIcon style={{ color: Colors.Icon.Neutral.Subdued }} aria-label="To do" />
                )}
              </Flex>
              <Flex flexDirection="column" gap={0} flexGrow={1} style={{ minWidth: 0 }}>
                <Text textStyle="base-emphasized">
                  {i + 1}. {it.title}
                </Text>
                <Text textStyle="small" style={{ color: it.done ? Colors.Text.Neutral.Subdued : Colors.Text.Neutral.Default }}>
                  {it.detail}
                </Text>
              </Flex>
              {!it.done && (
                <Button size="condensed" onClick={() => onFix(it.key)}>
                  {it.fixLabel}
                </Button>
              )}
            </Flex>
          ))}
        </Flex>
      </Flex>
    </Surface>
    )
  );
};
