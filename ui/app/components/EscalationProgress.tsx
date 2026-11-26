import React from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { ProgressBar, ProgressCircle, AvatarGroup } from "@dynatrace/strato-components/content";
import { Text } from "@dynatrace/strato-components/typography";
import { CircleIcon, GroupIcon, RepeatIcon, SuccessIcon, CalendarIcon } from "@dynatrace/strato-icons";
import Colors from "@dynatrace/strato-design-tokens/colors";
import type { EscalationPolicy, EscalationTarget, Incident } from "../domain/contracts";
import { CHANNEL_LABEL } from "./ChannelIcon";
import { formatDuration, formatTime, initials } from "./format";
import { useAppData } from "../hooks/AppDataContext";

/** Offset (ms after escalation start) at which each step fires in one cycle. */
export function stepOffsets(policy: EscalationPolicy): number[] {
  let acc = 0;
  return policy.steps.map((s) => (acc += s.delayMinutes * 60_000));
}

export function cycleLength(policy: EscalationPolicy): number {
  const offs = stepOffsets(policy);
  return offs.length ? offs[offs.length - 1] : 0;
}

/** Compact cell: "Step 2 of 4" + progress bar; exhausted in critical. */
export const EscalationCell = ({ incident, policy }: { incident: Incident; policy?: EscalationPolicy }) => {
  const total = policy?.steps.length ?? 0;
  if (!policy || total === 0) return <Text style={{ color: Colors.Text.Neutral.Subdued }}>No policy</Text>;
  const e = incident.escalation;
  if (e.exhausted)
    return (
      <ProgressBar value={total} max={total} density="condensed" color="critical" aria-label="Escalation exhausted">
        <ProgressBar.Label>Exhausted</ProgressBar.Label>
      </ProgressBar>
    );
  const step = Math.max(0, e.lastStepIndex + 1);
  return (
    <ProgressBar value={step} max={total} density="condensed" aria-label={`Step ${step} of ${total}`}>
      <ProgressBar.Label>{step === 0 ? "Not started" : `Step ${step} of ${total}`}</ProgressBar.Label>
    </ProgressBar>
  );
};

export const TargetView = ({ target }: { target: EscalationTarget }) => {
  const { data, userName } = useAppData();
  if (target.type === "user")
    return (
      <AvatarGroup>
        <AvatarGroup.Item abbreviation={initials(userName(target.uid))} tooltipText={userName(target.uid)} />
      </AvatarGroup>
    );
  if (target.type === "team") {
    const t = data?.teams.find((x) => x.id === target.teamId);
    return (
      <Flex alignItems="center" gap={4}>
        <GroupIcon />
        <Text>{t?.name ?? "Unknown team"} (all responders)</Text>
      </Flex>
    );
  }
  const s = data?.schedules.find((x) => x.id === target.scheduleId);
  return (
    <Flex alignItems="center" gap={4}>
      <CalendarIcon />
      <Text>On call: {s?.name ?? "Unknown schedule"}</Text>
    </Flex>
  );
};

/** Full read-only progress view for the details panel (DESIGN §5.3). */
export const EscalationSteps = ({
  incident,
  policy,
  now,
  timeZone,
}: {
  incident: Incident;
  policy?: EscalationPolicy;
  now: number;
  timeZone?: string;
}) => {
  if (!policy) return <Text>No escalation policy applies to this incident.</Text>;
  const e = incident.escalation;
  const offs = stepOffsets(policy);
  const paused = incident.status !== "triggered";
  const total = policy.steps.length;
  const current = e.lastStepIndex;
  const nextIdx = current + 1 < total ? current + 1 : undefined;
  const nextAt = nextIdx !== undefined ? e.startedAt + offs[nextIdx] : undefined;
  return (
    <Flex flexDirection="column" gap={12}>
      <ProgressBar value={Math.max(0, current + 1)} max={Math.max(1, total)} color={e.exhausted ? "critical" : "primary"}>
        <ProgressBar.Label>{e.exhausted ? "Exhausted" : `Step ${Math.max(0, current + 1)} of ${total}`}</ProgressBar.Label>
        <ProgressBar.Value>
          {paused
            ? `Paused (${incident.status})`
            : nextAt !== undefined
              ? nextAt > now
                ? `next in ${formatDuration(nextAt - now)}`
                : "next step due"
              : "last step"}
        </ProgressBar.Value>
      </ProgressBar>
      {paused && incident.status !== "resolved" && (
        <Text textStyle="small">Escalation stops automatically while an incident is acknowledged or snoozed.</Text>
      )}
      <Flex flexDirection="column" gap={8}>
        {policy.steps.map((s, i) => {
          const done = i <= current;
          const isCurrent = i === current + 1 && !paused && !e.exhausted;
          const icon = done ? (
            <SuccessIcon style={{ color: Colors.Icon.Success.Default }} />
          ) : isCurrent ? (
            <ProgressCircle size="small" aria-label="Current step" />
          ) : (
            <CircleIcon style={{ color: Colors.Icon.Neutral.Subdued }} />
          );
          const firesAt = e.startedAt + offs[i];
          return (
            <Flex key={i} gap={12} alignItems="flex-start">
              <Flex style={{ width: 24, flexShrink: 0 }} justifyContent="center">
                {icon}
              </Flex>
              <Flex flexDirection="column" gap={4} style={done || isCurrent ? undefined : { color: Colors.Text.Neutral.Subdued }}>
                <Text textStyle={isCurrent ? "base-emphasized" : "base"}>
                  Step {i + 1} · {s.channels?.length ? s.channels.map((c) => CHANNEL_LABEL[c]).join(", ") : "Notification rules"} ·{" "}
                  {done ? `fired ${formatTime(firesAt, timeZone)}` : `after ${s.delayMinutes} min`}
                </Text>
                <Flex gap={8} flexWrap="wrap">
                  {s.targets.map((t, j) => (
                    <TargetView key={j} target={t} />
                  ))}
                </Flex>
              </Flex>
            </Flex>
          );
        })}
        {policy.repeat > 0 && (
          <Flex gap={12} alignItems="center">
            <Flex style={{ width: 24 }} justifyContent="center">
              <RepeatIcon />
            </Flex>
            <Text>
              Repeats {Math.max(0, policy.repeat - e.repeatsDone)} more {policy.repeat - e.repeatsDone === 1 ? "time" : "times"}
            </Text>
          </Flex>
        )}
      </Flex>
    </Flex>
  );
};
