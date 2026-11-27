import React, { useMemo } from "react";
import { Flex, Container } from "@dynatrace/strato-components/layouts";
import { AvatarGroup } from "@dynatrace/strato-components/content";
import { Text } from "@dynatrace/strato-components/typography";
import { RepeatIcon, StepIcon, WarningIcon } from "@dynatrace/strato-icons";
import Colors from "@dynatrace/strato-design-tokens/colors";
import type { EscalationPolicy } from "../../domain/contracts";
import { useAppData } from "../../hooks/AppDataContext";
import { allFirings, expandTargets } from "../../hooks/domain";
import { TargetView } from "../../components/EscalationProgress";
import { CHANNEL_LABEL } from "../../components/ChannelIcon";
import { initials } from "../../components/format";

function mmss(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Read-only steps list (team Escalation tab, policy list preview). */
export const PolicyView = ({ policy }: { policy: EscalationPolicy }) => (
  <Flex flexDirection="column" gap={8}>
    {policy.steps.map((s, i) => (
      <Flex key={i} gap={12} alignItems="center">
        <StepIcon />
        <Text textStyle="base-emphasized">Step {i + 1}</Text>
        <Text>after {s.delayMinutes} min ·</Text>
        <Flex gap={8} flexWrap="wrap">
          {s.targets.map((t, j) => (
            <TargetView key={j} target={t} />
          ))}
        </Flex>
        {s.channels?.length ? <Text textStyle="small">only {s.channels.map((c) => CHANNEL_LABEL[c]).join(", ")}</Text> : null}
      </Flex>
    ))}
    {policy.repeat > 0 && (
      <Flex gap={12} alignItems="center">
        <RepeatIcon />
        <Text>Repeats {policy.repeat}× if nobody acknowledges</Text>
      </Flex>
    )}
  </Flex>
);

/**
 * "If an incident is triggered now": who would be paged when, computed with the engine's
 * own firing schedule (allFirings) and target expansion (on-call at each firing time).
 */
export const PolicySimulation = ({ policy }: { policy: EscalationPolicy }) => {
  const { data, now, userName } = useAppData();
  const rows = useMemo(() => {
    if (!data) return [];
    return allFirings(policy, now).map((f) => ({
      f,
      who: expandTargets(f.step.targets, { schedules: data.schedules, teams: data.teams }, f.dueAt),
    }));
  }, [policy, data, now]);
  if (!policy.steps.length) return <Text>Add a step to see who would be paged.</Text>;
  // People the policy would page who cannot be reached yet (no contact method).
  const unreachable = [...new Set(rows.flatMap((r) => r.who.map((w) => w.uid)))].filter(
    (uid) => (data?.contacts.find((c) => c.uid === uid)?.methods.length ?? 0) === 0,
  );
  return (
    <Flex flexDirection="column" gap={12}>
      {unreachable.length > 0 && (
        <Container color="warning" padding={8}>
          <Flex gap={8} alignItems="center">
            <WarningIcon />
            <Text>
              No contact method yet: {unreachable.map(userName).join(", ")}. Add one in the team, or they can't be reached.
            </Text>
          </Flex>
        </Container>
      )}
      {rows.map(({ f, who }) => (
        <Flex key={f.ordinal} flexDirection="column" gap={4}>
          <Flex gap={12} alignItems="center">
            <Text fontStyle="code" style={{ minWidth: 48 }}>
              {mmss((f.dueAt - now) / 60_000)}
            </Text>
            <Text textStyle="base-emphasized">
              {f.pass > 0 ? `Repeat ${f.pass} · ` : ""}Step {f.stepIndex + 1}
            </Text>
            {f.step.channels?.length ? (
              <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued }}>
                only {f.step.channels.map((c) => CHANNEL_LABEL[c]).join(" + ")}
              </Text>
            ) : null}
          </Flex>
          {who.length ? (
            <Flex gap={8} alignItems="center" style={{ paddingLeft: 60 }}>
              <AvatarGroup>
                {who.map((w) => (
                  <AvatarGroup.Item key={w.uid} abbreviation={initials(userName(w.uid))} tooltipText={userName(w.uid)} />
                ))}
              </AvatarGroup>
              <Text textStyle="small">{who.map((w) => userName(w.uid)).join(", ")}</Text>
            </Flex>
          ) : (
            <Container color="warning" padding={8}>
              <Flex gap={8} alignItems="center">
                <WarningIcon />
                <Text>Step {f.stepIndex + 1} pages no one at that time (a schedule gap or an empty team).</Text>
              </Flex>
            </Container>
          )}
        </Flex>
      ))}
      {policy.steps.length === 1 && policy.repeat === 0 && (
        <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued }}>
          If nobody acknowledges, nothing else happens. Add a step or turn on Repeat to keep escalating.
        </Text>
      )}
    </Flex>
  );
};
