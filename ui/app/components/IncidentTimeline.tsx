import React, { useMemo, useState } from "react";
import { Flex, Container, Divider } from "@dynatrace/strato-components/layouts";
import { Text } from "@dynatrace/strato-components/typography";
import { Markdown } from "@dynatrace/strato-components/content";
import { ToggleButtonGroup } from "@dynatrace/strato-components/forms";
import { Tooltip } from "@dynatrace/strato-components/overlays";
import {
  AccountIcon,
  ArrowUpIcon,
  CheckmarkIcon,
  ConditionsIcon,
  CriticalFailedIcon,
  AiIcon,
  DescriptionIcon,
  EditIcon,
  EventIcon,
  MuteIcon,
  PauseIcon,
  RefreshIcon,
  StepIcon,
  SuccessIcon,
  TimelineEventIcon,
  WarningIcon,
} from "@dynatrace/strato-icons";
import Colors from "@dynatrace/strato-design-tokens/colors";
import type { Channel, TimelineEntry } from "../domain/contracts";
import { useAppData } from "../hooks/AppDataContext";
import { ChannelIcon } from "./ChannelIcon";
import { formatDateTime, formatDay, formatTime } from "./format";

type Filter = "all" | "actions" | "notifications" | "system";

const USER_TYPES = new Set(["acknowledged", "unacknowledged", "resolved", "reopened", "snoozed", "unsnoozed", "reassigned", "escalated", "priority", "note", "tag"]);
const NTF_TYPES = new Set(["notification_planned", "notification_sent", "notification_failed"]);

function category(t: TimelineEntry): Exclude<Filter, "all"> {
  if (NTF_TYPES.has(t.type)) return "notifications";
  if (USER_TYPES.has(t.type) && t.by !== "system" && t.by !== "source") return "actions";
  return "system";
}

function icon(t: TimelineEntry): React.ReactNode {
  const neutral = { color: Colors.Icon.Neutral.Default };
  switch (t.type) {
    case "created":
      return <EventIcon style={neutral} />;
    case "routed":
      return <ConditionsIcon style={neutral} />;
    case "acknowledged":
      return <CheckmarkIcon style={neutral} />;
    case "resolved":
      return <SuccessIcon style={{ color: Colors.Icon.Success.Default }} />;
    case "reopened":
    case "unacknowledged":
      return <RefreshIcon style={neutral} />;
    case "snoozed":
    case "unsnoozed":
      return <PauseIcon style={neutral} />;
    case "reassigned":
      return <AccountIcon style={neutral} />;
    case "escalated":
      return <ArrowUpIcon style={{ color: Colors.Icon.Primary.Default }} />;
    case "priority":
    case "tag":
      return <EditIcon style={neutral} />;
    case "note":
      return <DescriptionIcon style={neutral} />;
    case "notification_failed":
      return <CriticalFailedIcon style={{ color: Colors.Icon.Critical.Default }} />;
    case "notification_planned":
    case "notification_sent": {
      const ch = t.data?.channel;
      return typeof ch === "string" ? <ChannelIcon channel={ch as Channel} /> : <StepIcon style={neutral} />;
    }
    case "escalation_exhausted":
      return <WarningIcon style={{ color: Colors.Icon.Critical.Default }} />;
    case "suppressed":
      return <MuteIcon style={neutral} />;
    default:
      if (t.type.startsWith("davis") || t.by === "source") return <AiIcon style={neutral} />;
      if (t.type.startsWith("escalation")) return <StepIcon style={{ color: Colors.Icon.Primary.Default }} />;
      return <TimelineEventIcon style={neutral} />;
  }
}

const LABEL: Record<string, string> = {
  created: "Incident created",
  routed: "Routed",
  acknowledged: "acknowledged",
  unacknowledged: "undid the acknowledgement",
  resolved: "resolved",
  reopened: "reopened",
  snoozed: "snoozed",
  unsnoozed: "Snooze ended",
  reassigned: "reassigned",
  escalated: "escalated",
  priority: "changed the priority",
  note: "added a note",
  tag: "changed tags",
  notification_planned: "Notification planned",
  notification_sent: "Notification sent",
  notification_failed: "Notification failed",
  escalation_exhausted: "Escalation exhausted",
  suppressed: "Suppressed",
};

/** Composed vertical timeline, newest first, grouped by day (DESIGN §5.3). */
export const IncidentTimeline = ({ entries }: { entries: TimelineEntry[] }) => {
  const { userName, data } = useAppData();
  const tz = data?.settings.ui.timeZone;
  const [filter, setFilter] = useState<Filter>("all");

  const groups = useMemo(() => {
    const sorted = [...entries].filter((e) => filter === "all" || category(e) === filter).sort((a, b) => b.at - a.at);
    const out: { day: string; items: TimelineEntry[] }[] = [];
    sorted.forEach((e) => {
      const day = formatDay(e.at, tz);
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(e);
      else out.push({ day, items: [e] });
    });
    return out;
  }, [entries, filter, tz]);

  return (
    <Flex flexDirection="column" gap={12}>
      <ToggleButtonGroup value={filter} onChange={(v: string) => setFilter(v as Filter)}>
        <ToggleButtonGroup.Item value="all">All</ToggleButtonGroup.Item>
        <ToggleButtonGroup.Item value="actions">Actions</ToggleButtonGroup.Item>
        <ToggleButtonGroup.Item value="notifications">Notifications</ToggleButtonGroup.Item>
        <ToggleButtonGroup.Item value="system">System</ToggleButtonGroup.Item>
      </ToggleButtonGroup>
      {groups.length === 0 && <Text>No entries for this filter.</Text>}
      {groups.map((g) => (
        <Flex key={g.day} flexDirection="column" gap={8}>
          <Text textStyle="small-emphasized">{g.day}</Text>
          <Divider />
          {g.items.map((t, i) => {
            const actor = t.by !== "system" && t.by !== "source" && USER_TYPES.has(t.type);
            const primary = actor ? `${userName(t.by)} ${LABEL[t.type] ?? t.type}` : (LABEL[t.type] ?? t.type.replace(/_/g, " "));
            const body = (
              <Flex gap={12} alignItems="flex-start">
                <Flex style={{ width: 24, flexShrink: 0 }} justifyContent="center" paddingTop={2}>
                  {icon(t)}
                </Flex>
                <Flex flexDirection="column" gap={2} flexGrow={1} style={{ minWidth: 0 }}>
                  <Text textStyle="base-emphasized">{primary}</Text>
                  {t.type === "note" && t.detail ? (
                    <Markdown>{t.detail}</Markdown>
                  ) : (
                    t.detail && (
                      <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued }}>
                        {t.detail}
                      </Text>
                    )
                  )}
                </Flex>
                <Tooltip text={formatDateTime(t.at, tz)}>
                  <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued, flexShrink: 0 }}>
                    {formatTime(t.at, tz, true)}
                  </Text>
                </Tooltip>
              </Flex>
            );
            return t.type === "notification_failed" ? (
              <Container key={i} color="critical" padding={8}>
                {body}
              </Container>
            ) : (
              <React.Fragment key={i}>{body}</React.Fragment>
            );
          })}
        </Flex>
      ))}
    </Flex>
  );
};
