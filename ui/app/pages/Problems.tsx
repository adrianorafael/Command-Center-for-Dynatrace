import React, { useCallback, useEffect, useRef, useMemo, useState } from "react";
import { useProblems as useProblemsData } from "../hooks/useProblems";
import { useAckEvents } from "../hooks/useAckEvents";
import type {
  Problem,
  ProblemStatus,
  HistoryEvent,
  HistoryEventType,
  EscalationContact,
  FilterStatus,
} from "../types/problems";
import { parseTimeframeDate } from "../utils/timeframe";
import { getEnvironmentUrl, getCurrentUserDetails } from "@dynatrace-sdk/app-environment";
import { Container, Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Link, Text } from "@dynatrace/strato-components/typography";
import { Button } from "@dynatrace/strato-components/buttons";
import { Modal, Tooltip } from "@dynatrace/strato-components/overlays";
import { ProgressCircle } from "@dynatrace/strato-components/content";
import {
  DataTable,
  type DataTableColumnDef,
} from "@dynatrace/strato-components/tables";
import {
  FormField,
  Label,
  Select,
  SelectContent,
  SelectOption,
  TextArea,
  TextInput,
  type SelectOnChangeValue,
} from "@dynatrace/strato-components/forms";
import {
  SegmentSelector,
  SegmentsProvider,
  TimeframeSelector,
  TIMEFRAME_SELECTOR_PRESETS,
} from "@dynatrace/strato-components/filters";
import type { Timeframe, TimeValue } from "@dynatrace/strato-components/core";
import Colors from "@dynatrace/strato-design-tokens/colors";
import Borders from "@dynatrace/strato-design-tokens/borders";
import BoxShadows from "@dynatrace/strato-design-tokens/box-shadows";
import {
  AccountFilledIcon,
  CallIcon,
  CategoryIcon,
  ChatIcon,
  ClockIcon,
  DescriptionIcon,
  EventIcon,
  RefreshAutoIcon,
  SuccessIcon,
  UserEventsIcon,
} from "@dynatrace/strato-icons";

// ─── DQL error → user-friendly message ───────────────────────────────────────

const DQL_ERROR_MESSAGES: Record<string, string> = {
  TIMEFRAME_END_BEFORE_START:
    "The selected timeframe is invalid: start and end times must be different. Please select a wider timeframe.",
  INVALID_TIMEFRAME:
    "The selected timeframe is invalid: start and end times must be different. Please select a wider timeframe.",
};

function formatQueryError(error: Error | null): string {
  if (!error) return "";
  const msg = error.message;

  // Synthetic error from useProblems validation
  if (DQL_ERROR_MESSAGES[msg]) return DQL_ERROR_MESSAGES[msg];

  // Extract errorType from DQL API error string (e.g. errorType: "TIMEFRAME_END_BEFORE_START")
  const errorTypeMatch = msg.match(/errorType:\s*"([^"]+)"/);
  const errorType = errorTypeMatch?.[1];
  if (errorType && DQL_ERROR_MESSAGES[errorType]) return DQL_ERROR_MESSAGES[errorType];

  // Extract the human-readable errorMessage field from the DQL response
  const errorMessageMatch = msg.match(/errorMessage:\s*"((?:[^"\\]|\\.)*)"/);
  if (errorMessageMatch?.[1]) return errorMessageMatch[1].replace(/\\"/g, '"');

  // Fallback: return raw message
  return msg;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ENV_URL = getEnvironmentUrl().replace(/\/$/, "");

// ─── Timeframe defaults & helpers ────────────────────────────────────────────

// "Today" preset: { from: "@d", to: "now()" }
const TODAY_PRESET =
  (TIMEFRAME_SELECTOR_PRESETS as Array<{ from: string; to: string }>).find(
    (p) => p.from === "@d" && p.to === "now()"
  ) ?? null;

// ─── Dynatrace Logo ───────────────────────────────────────────────────────────

const DynatraceLogo = () => (
  <svg width="65" height="65" viewBox="0 0 73 73" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: "block", flexShrink: 0 }}>
    <path d="M24.736 6.39229C23.83 11.1739 22.7227 18.2708 22.1187 25.4684C21.0617 38.1523 21.716 46.6585 21.716 46.6585L3.84787 63.6207C3.84787 63.6207 2.48888 54.1078 1.78422 43.3869C1.38156 36.743 1.23056 30.9044 1.23056 27.3811C1.23056 27.1797 1.33123 26.9784 1.33123 26.7771C1.33123 26.5254 1.63322 24.1598 3.94853 21.9451C6.46517 19.5291 25.038 4.98297 24.736 6.39229Z" fill="#1496FF"/>
    <path d="M24.736 6.39226C23.83 11.1739 22.7227 18.2708 22.1187 25.4684C22.1187 25.4684 2.33788 23.1028 1.23056 27.8844C1.23056 27.6327 1.58289 24.7134 3.8982 22.4988C6.41484 20.0828 25.038 4.98294 24.736 6.39226Z" fill="#1284EA"/>
    <path d="M1.23057 26.7267C1.23057 27.0791 1.23057 27.4314 1.23057 27.834C1.4319 26.9784 1.78423 26.3744 2.48889 25.4181C3.94854 23.5558 6.31418 23.0524 7.2705 22.9518C12.1025 22.2974 19.2497 21.5424 26.4473 21.3411C39.1815 20.9385 47.5871 21.9954 47.5871 21.9954L65.4552 5.03329C65.4552 5.03329 56.0933 3.27164 45.4228 2.01332C38.4265 1.15766 32.2859 0.70467 28.8129 0.503339C28.5613 0.503339 26.095 0.201342 23.7797 2.41598C21.263 4.83196 8.47849 16.9622 3.34455 21.8444C1.02924 24.0591 1.23057 26.5254 1.23057 26.7267Z" fill="#B4DC00"/>
    <path d="M64.8009 48.4202C59.9689 49.0745 52.8217 49.8798 45.6241 50.1315C32.8899 50.5341 24.434 49.4771 24.434 49.4771L6.56584 66.4896C6.56584 66.4896 16.0284 68.3519 26.699 69.5599C33.2422 70.3149 39.0305 70.7176 42.5538 70.9189C42.8055 70.9189 43.2081 70.7176 43.4598 70.7176C43.7114 70.7176 46.1777 70.2646 48.4931 68.0499C51.0097 65.634 66.2102 48.2692 64.8009 48.4202Z" fill="#6F2DA8"/>
    <path d="M64.8009 48.4202C59.969 49.0745 52.8217 49.8798 45.6241 50.1315C45.6241 50.1315 46.9831 70.0129 42.2015 70.8686C42.4531 70.8686 45.7248 70.7176 48.0401 68.503C50.5567 66.087 66.2102 48.2692 64.8009 48.4202Z" fill="#591F91"/>
    <path d="M43.2584 70.9693C42.9061 70.9693 42.5538 70.9189 42.1511 70.9189C43.0571 70.7679 43.6611 70.4659 44.6174 69.7613C46.5301 68.4023 47.1341 66.0367 47.3354 65.0803C48.1911 60.2987 49.3487 53.2018 49.9024 46.0042C50.909 33.3203 50.305 24.8644 50.305 24.8644L68.1732 7.85194C68.1732 7.85194 69.4818 17.3145 70.2368 28.0354C70.6898 35.0317 70.8408 41.2226 70.8911 44.6452C70.8911 44.8969 71.0925 47.3632 68.7772 49.5778C66.2605 51.9938 53.476 64.1743 48.3924 69.0566C45.9764 71.2713 43.5101 70.9693 43.2584 70.9693Z" fill="#73BE28"/>
  </svg>
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<FilterStatus, string> = {
  ALL: "All problems",
  OPEN: "Open",
  CLOSED: "Closed",
  ACKNOWLEDGED: "Acknowledged",
  MAINTENANCE: "Maintenance",
};

const STATUS_CARD_ACCENT: Record<FilterStatus, string> = {
  ALL: Colors.Text.Primary.Default,
  OPEN: Colors.Text.Critical.Default,
  CLOSED: Colors.Text.Success.Default,
  ACKNOWLEDGED: Colors.Text.Warning.Default,
  MAINTENANCE: Colors.Text.Neutral.Default,
};

const FILTER_OPTIONS: FilterStatus[] = ["ALL", "OPEN", "CLOSED", "ACKNOWLEDGED", "MAINTENANCE"];

const HISTORY_EVENT_LABELS: Record<HistoryEventType, string> = {
  STARTED: "Problem started",
  ACKNOWLEDGED: "Acknowledged",
  UNACKNOWLEDGED: "Unacknowledged",
  CLOSED: "Closed",
  MAINTENANCE: "Marked as maintenance",
};

// ─── Icon button styles ───────────────────────────────────────────────────────

const ICON_BTN: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
};
const ICON_BTN_DEFAULT: React.CSSProperties = { ...ICON_BTN, color: Colors.Text.Primary.Default };
const ICON_BTN_WARNING: React.CSSProperties = { ...ICON_BTN, color: Colors.Text.Warning.Default };
const ICON_BTN_DISABLED: React.CSSProperties = { ...ICON_BTN, cursor: "default", color: Colors.Text.Neutral.Disabled };

// Shared icons — used in cards AND in the Status grid column
export const STATUS_ICON: Record<FilterStatus, React.ReactElement> = {
  ALL: <CategoryIcon />,
  OPEN: <EventIcon />,
  CLOSED: <SuccessIcon />,
  ACKNOWLEDGED: <UserEventsIcon />,
  MAINTENANCE: <ClockIcon />,
};

function countByStatus(problems: Problem[], status: FilterStatus): number {
  if (status === "ALL") return problems.length;
  return problems.filter((p) => p.status === status).length;
}

function formatCount(n: number): string {
  if (n === 0) return "--";
  return n <= 9 ? `0${n}` : String(n);
}

// ─── Status Filter Card ───────────────────────────────────────────────────────

interface StatusCardProps {
  label: string;
  count: number;
  active: boolean;
  status: FilterStatus;
  onClick: () => void;
}

const StatusCard = ({
  label,
  count,
  active,
  status,
  onClick,
}: StatusCardProps) => {
  const accentColor = STATUS_CARD_ACCENT[status];

  return (
    <button
      onClick={onClick}
      style={{
        // flex: 1 lets each card grow/shrink equally within the row — no wrapping
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: "12px",
        padding: "12px 16px",
        cursor: "pointer",
        borderTop: `1px solid ${active ? accentColor : Colors.Border.Neutral.Default}`,
        borderRight: `1px solid ${active ? accentColor : Colors.Border.Neutral.Default}`,
        borderBottom: `1px solid ${active ? accentColor : Colors.Border.Neutral.Default}`,
        borderLeft: `4px solid ${accentColor}`,
        borderRadius: Borders.Radius.Container.Default,
        background: Colors.Background.Surface.Default,
        boxShadow: active
          ? BoxShadows.Surface.Raised.Rest
          : BoxShadows.Surface.Flat.Rest,
        outline: "none",
        transition: "box-shadow 0.15s, border 0.15s",
        overflow: "hidden",
      }}
    >
      <span
        style={{
          color: accentColor,
          display: "flex",
          alignItems: "center",
          flexShrink: 0,
        }}
      >
        {React.cloneElement(STATUS_ICON[status], {
          width: 22,
          height: 22,
        } as React.SVGProps<SVGSVGElement>)}
      </span>
      <span
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: "1px",
          overflow: "hidden",
          minWidth: 0,
        }}
      >
        <span
          style={{
            fontSize: "24px",
            fontWeight: count === 0 ? 400 : 700,
            lineHeight: 1,
            color: accentColor,
          }}
        >
          {formatCount(count)}
        </span>
        <span
          style={{
            fontSize: "12px",
            color: accentColor,
            fontWeight: 700,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: "100%",
          }}
        >
          {label}
        </span>
      </span>
    </button>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

export const Problems = () => {
  const { name: currentUser, email: currentUserEmail } = getCurrentUserDetails();

  const [timeframe, setTimeframe] = useState<Timeframe | { from: string; to: string } | null>(TODAY_PRESET);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ackInitializedRef = useRef(false);
  const isAutoRefreshingRef = useRef(false);
  const lastFetchedRef = useRef<Problem[]>([]);

  const {
    problems: fetchedProblems,
    isLoading,
    isFetching,
    isError,
    error,
  } = useProblemsData(timeframe);

  // Simulates pressing "Apply" on the TimeframeSelector: spreads the current timeframe into a new
  // object reference, causing useProblems to recompute timestamps (now(), now()-Xh, etc.) and
  // rebuild the DQL query — exactly what happens when the user manually applies the timeframe.
  // useCallback ensures a stable reference so the autoRefresh effect can list it in the dep array.
  const applyTimeframe = useCallback(
    () => setTimeframe((prev: Timeframe | { from: string; to: string } | null) => prev ? { ...prev } : prev),
    [] // setTimeframe is stable by React guarantee
  );

  const { ackStates, ingestAck } = useAckEvents();

  const [localOverrides, setLocalOverrides] = useState<
    Record<string, Partial<Problem>>
  >({});

  // Initialize localOverrides from App State once, after ackStates are loaded
  useEffect(() => {
    if (ackInitializedRef.current || ackStates.length === 0) return;
    ackInitializedRef.current = true;
    const overrides: Record<string, Partial<Problem>> = {};
    for (const ack of ackStates) {
      overrides[ack.problemId] = {
        status: ack.action === "ACKNOWLEDGED" ? "ACKNOWLEDGED" : "OPEN",
        assignedTo: ack.action === "ACKNOWLEDGED" ? ack.assignedTo : "",
        history: ack.history as HistoryEvent[], // user events only; System events come from base
      };
    }
    setLocalOverrides(overrides);
  }, [ackStates]);

  // Update lastUpdated when isFetching transitions false → covers both initial load and background refetches
  const prevFetchingRef = useRef(isFetching);
  useEffect(() => {
    if (prevFetchingRef.current && !isFetching && !isError) {
      setLastUpdated(new Date());
    }
    prevFetchingRef.current = isFetching;
  }, [isFetching, isError]);

  // When new data arrives, persist it and clear the autoRefresh flag
  useEffect(() => {
    if (fetchedProblems.length > 0) {
      lastFetchedRef.current = fetchedProblems;
      isAutoRefreshingRef.current = false;
    }
  }, [fetchedProblems]);

  // During autoRefresh, serve last known data so the table never blanks.
  // During user interactions, serve actual fetchedProblems (empty = show spinner).
  const baseFetchedProblems = isAutoRefreshingRef.current
    ? lastFetchedRef.current
    : fetchedProblems;

  // Merge API data with local overrides (ack/unack performed by the user)
  const problems = useMemo<Problem[]>(
    () =>
      baseFetchedProblems.map((p) => {
        const override = localOverrides[p.id];
        if (!override) return p;
        // Status real do Dynatrace prevalece se o problema foi fechado ou está em manutenção
        const realStatusFinal = p.status === "CLOSED" || p.status === "MAINTENANCE";
        const userEvents = override.history ?? [];
        const merged: Problem = {
          ...p,
          ...override,
          status: realStatusFinal ? p.status : (override.status ?? p.status),
          assignedTo: realStatusFinal ? p.assignedTo : (override.assignedTo ?? p.assignedTo),
          history: [...p.history, ...userEvents],
        };
        return merged;
      }),
    [baseFetchedProblems, localOverrides]
  );
  const [activeFilter, setActiveFilter] = useState<FilterStatus>("ALL");
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>("ALL");
  const [selectedProblem, setSelectedProblem] = useState<Problem | null>(null);
  const [chatProblem, setChatProblem] = useState<Problem | null>(null);
  const [chatTitle, setChatTitle] = useState("");
  const [chatContent, setChatContent] = useState("");
  const [callProblem, setCallProblem] = useState<Problem | null>(null);
  const [assigneeModal, setAssigneeModal] = useState<{ name: string; email: string } | null>(null);

  // Unique list of other users (not current user) who acknowledged a problem
  const otherAssignees = useMemo(() => {
    const users = new Set(
      problems
        .map((p) => p.assignedTo)
        .filter((u) => u && u !== currentUser)
    );
    return Array.from(users).sort();
  }, [problems]);

  // Assignee filter only
  const problemsByAssignee = useMemo(() => {
    if (!assigneeFilter || assigneeFilter === "ALL") return problems;
    if (assigneeFilter === "NONE") return problems.filter((p) => !p.assignedTo);
    if (assigneeFilter === "MY") return problems.filter((p) => p.assignedTo === currentUser);
    return problems.filter((p) => p.assignedTo === assigneeFilter);
  }, [problems, assigneeFilter]);

  // Timeframe filtering is handled by the DQL query in the hook — here we only filter by assignee
  const problemsBase = problemsByAssignee;

  // Assignee + timeframe + status — feeds the DataTable
  const filteredProblems = useMemo(() => {
    return activeFilter === "ALL"
      ? problemsBase
      : problemsBase.filter((p) => p.status === activeFilter);
  }, [problemsBase, activeFilter]);

  // Whenever Dynatrace returns CLOSED/MAINTENANCE, remove any local override for that problem
  useEffect(() => {
    if (fetchedProblems.length === 0) return;
    setLocalOverrides((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const p of fetchedProblems) {
        if ((p.status === "CLOSED" || p.status === "MAINTENANCE") && next[p.id]) {
          delete next[p.id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [fetchedProblems]);

  // Auto-refresh: every 60s, simulate "Apply" on the current timeframe.
  useEffect(() => {
    if (autoRefresh) {
      applyTimeframe();
      const interval = setInterval(() => {
        isAutoRefreshingRef.current = true;
        applyTimeframe();
      }, 60_000);
      autoRefreshRef.current = interval;
      return () => clearInterval(interval);
    } else {
      if (autoRefreshRef.current !== null) {
        clearInterval(autoRefreshRef.current);
        autoRefreshRef.current = null;
      }
    }
  }, [autoRefresh, applyTimeframe]);

  const now = () => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  // handleAcknowledge / handleUnacknowledge are intentionally not wrapped in useCallback:
  // DataTable is not memoized with stable prop comparison, so useCallback would add overhead
  // without any benefit here.
  const handleAcknowledge = (problemId: string) => {
    const base = fetchedProblems.find((p) => p.id === problemId);
    if (!base || base.status === "CLOSED" || base.status === "MAINTENANCE") return;
    // Apenas eventos do usuário (não inclui eventos de System)
    // Only user events are tracked here; System events come from base
    const prevUserEvents = localOverrides[problemId]?.history ?? [];
    const newUserEvents: HistoryEvent[] = [
      ...prevUserEvents,
      { type: "ACKNOWLEDGED" as HistoryEventType, timestamp: now(), by: currentUser },
    ];
    setLocalOverrides((prev) => ({
      ...prev,
      [problemId]: { status: "ACKNOWLEDGED", assignedTo: currentUser, history: newUserEvents },
    }));
    // Fire-and-forget: local state is already updated optimistically; persistence errors are logged in useAckEvents
    ingestAck(problemId, "ACKNOWLEDGED", currentUser, newUserEvents);
  };

  const handleUnacknowledge = (problemId: string) => {
    const base = fetchedProblems.find((p) => p.id === problemId);
    if (!base || base.status === "CLOSED" || base.status === "MAINTENANCE") return;
    // Only user events are tracked here; System events come from base
    const prevUserEvents = localOverrides[problemId]?.history ?? [];
    const newUserEvents: HistoryEvent[] = [
      ...prevUserEvents,
      { type: "UNACKNOWLEDGED" as HistoryEventType, timestamp: now(), by: currentUser },
    ];
    setLocalOverrides((prev) => ({
      ...prev,
      [problemId]: { status: "OPEN", assignedTo: "", history: newUserEvents },
    }));
    // Fire-and-forget: local state is already updated optimistically; persistence errors are logged in useAckEvents
    ingestAck(problemId, "OPEN", currentUser, newUserEvents);
  };

  const columns: DataTableColumnDef<Problem>[] = [
    {
      id: "id",
      header: "Problem #",
      accessor: "displayId",
      width: 130,
      sortType: "text",
      cell: ({ value, rowData }) => {
        const problem = rowData as Problem;
        const displayText = (value as string) || problem.id;
        return (
          <DataTable.DefaultCell>
            <Link
              href={`${ENV_URL}/ui/apps/dynatrace.davis.problems/problem/${problem.id}?from=%40d&to=now%28%29`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {displayText}
            </Link>
          </DataTable.DefaultCell>
        );
      },
    },
    {
      id: "started",
      header: "Started",
      accessor: "started",
      width: 185,
      sortType: "text",
      sortDescFirst: true,
    },
    {
      id: "summary",
      header: "Summary",
      accessor: "summary",
      width: "3fr",
      sortType: "text",
    },
    {
      id: "rootCause",
      header: "Root cause",
      accessor: "rootCause",
      width: "2fr",
      sortType: "text",
    },
    {
      id: "events",
      header: "Events",
      alignment: "center",
      accessor: "events",
      width: 80,
      sortType: "number",
      sortDescFirst: true,
    },
    {
      id: "assignedTo",
      header: "Assigned to",
      accessor: "assignedTo",
      width: "1fr",
      sortType: "text",
      cell: ({ value }) => {
        const user = value as string;
        if (!user) {
          return (
            <DataTable.DefaultCell>
              <span style={{ color: Colors.Text.Neutral.Subdued }}>—</span>
            </DataTable.DefaultCell>
          );
        }
        return (
          <DataTable.DefaultCell>
            <button
              onClick={() => setAssigneeModal({
                name: user === currentUser ? currentUser : user,
                email: user === currentUser ? currentUserEmail : "—",
              })}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                color: Colors.Text.Primary.Default,
                textDecoration: "underline",
                font: "inherit",
              }}
            >
              {user === currentUser ? "Me" : user}
            </button>
          </DataTable.DefaultCell>
        );
      },
    },
    {
      id: "status",
      header: "Status",
      accessor: "status",
      width: 120,
      sortType: "text",
      cell: ({ value }) => (
        <DataTable.DefaultCell>
          {STATUS_LABELS[value as ProblemStatus]}
        </DataTable.DefaultCell>
      ),
    },
    {
      id: "action",
      header: "Action",
      alignment: "center",
      accessor: "id",
      width: 160,
      disableSorting: true,
      cell: ({ rowData }) => {
        const problem = rowData as Problem;
        return (
          <DataTable.DefaultCell>
            <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
              {problem.status === "OPEN" ? (
                <Tooltip text="Acknowledge">
                  <button
                    onClick={() => handleAcknowledge(problem.id)}
                    style={ICON_BTN_DEFAULT}
                  >
                    <UserEventsIcon size={16} />
                  </button>
                </Tooltip>
              ) : problem.status === "ACKNOWLEDGED" ? (
                <Tooltip text="Unacknowledge">
                  <button
                    onClick={() => handleUnacknowledge(problem.id)}
                    style={ICON_BTN_WARNING}
                  >
                    <UserEventsIcon size={16} />
                  </button>
                </Tooltip>
              ) : (
                <button
                  disabled
                  style={ICON_BTN_DISABLED}
                >
                  <UserEventsIcon size={16} />
                </button>
              )}
              <Tooltip text="View history">
                <button
                  onClick={() => setSelectedProblem(problem)}
                  style={ICON_BTN_DEFAULT}
                >
                  <DescriptionIcon size={16} />
                </button>
              </Tooltip>
              <Tooltip text="Send message">
                <button
                  onClick={() => { setChatProblem(problem); setChatTitle(""); setChatContent(""); }}
                  style={ICON_BTN_DEFAULT}
                >
                  <ChatIcon size={16} />
                </button>
              </Tooltip>
              <Tooltip text="Escalate call">
                <button
                  onClick={() => setCallProblem(problem)}
                  style={ICON_BTN_DEFAULT}
                >
                  <CallIcon size={16} />
                </button>
              </Tooltip>
            </span>
          </DataTable.DefaultCell>
        );
      },
    },
  ];

  return (
    <SegmentsProvider>
    <Flex flexDirection="column" paddingTop={12} paddingRight={32} paddingBottom={32} paddingLeft={32} gap={24}>
      <Flex justifyContent="flex-end" alignItems="center" gap={8}>
        <SegmentSelector aria-label="Segment" />
        <TimeframeSelector
          value={timeframe}
          onChange={(val) => setTimeframe(val)}
          clearable
        >
          <TimeframeSelector.Presets>
            {TIMEFRAME_SELECTOR_PRESETS.map((preset) => (
              <TimeframeSelector.PresetItem key={`${preset.from}-${preset.to}`} value={preset} />
            ))}
          </TimeframeSelector.Presets>
        </TimeframeSelector>
        <Tooltip text={autoRefresh ? "Auto-refresh on (1 min)" : "Auto-refresh off"}>
          <button
            onClick={() => setAutoRefresh((prev) => !prev)}
            style={{
              background: "none",
              border: "none",
              padding: "4px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              color: autoRefresh ? Colors.Text.Primary.Default : Colors.Text.Neutral.Subdued,
            }}
            aria-label="Toggle auto-refresh"
          >
            <RefreshAutoIcon size={20} />
          </button>
        </Tooltip>
        {lastUpdated && (
          <span style={{ fontSize: "11px", color: Colors.Text.Neutral.Subdued, textAlign: "left", lineHeight: 1.4 }}>
            Última atualização:<br />{lastUpdated.toLocaleDateString()} {lastUpdated.toLocaleTimeString()}
          </span>
        )}
      </Flex>

      <Container style={{ background: "rgb(17, 17, 34)", padding: "5px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "65px 1fr 65px", alignItems: "center" }}>
          <DynatraceLogo />
          <Heading level={2} style={{ color: "#ffffff", textAlign: "center" }}>Command Center</Heading>
          <span />
        </div>
      </Container>

      {/* Single no-wrap row: cards + assignee filter */}
      <div
        style={{
          display: "flex",
          flexWrap: "nowrap",
          alignItems: "stretch",
          gap: "12px",
          width: "100%",
          minWidth: 0,
        }}
      >
        {/* Status cards — each takes equal share of available space */}
        {FILTER_OPTIONS.map((status) => (
          <StatusCard
            key={status}
            label={STATUS_LABELS[status]}
            count={countByStatus(problemsBase, status)}
            active={activeFilter === status}
            status={status}
            onClick={() => setActiveFilter(status)}
          />
        ))}

        {/* Assignee filter — no card styling, just label + select */}
        <Flex
          flexDirection="column"
          justifyContent="center"
          gap={4}
          style={{ flexShrink: 0, minWidth: "220px", alignSelf: "flex-end" }}
        >
          <Text
            as="label"
            style={{
              fontSize: "12px",
              fontWeight: 600,
              color: Colors.Text.Neutral.Default,
            }}
          >
            Acknowledged by
          </Text>
          <Select<string>
            value={assigneeFilter}
            onChange={(val: SelectOnChangeValue<string, false>) =>
              setAssigneeFilter(val ?? "ALL")
            }
            aria-label="Filter by assignee"
          >
            <SelectContent>
              <SelectOption value="ALL">All users</SelectOption>
              <SelectOption value="NONE">Unassigned</SelectOption>
              <SelectOption value="MY">My</SelectOption>
              {otherAssignees.map((user) => (
                <SelectOption key={user} value={user}>
                  {user}
                </SelectOption>
              ))}
            </SelectContent>
          </Select>
        </Flex>
      </div>

      {/* Error feedback */}
      {isError && (
        <Flex flexDirection="column" gap={4}
          style={{ padding: "12px 16px", background: Colors.Background.Container.Critical.Default,
            borderRadius: Borders.Radius.Container.Default }}>
          <Flex justifyContent="space-between" alignItems="center">
            <Text style={{ color: Colors.Text.Critical.Default, fontWeight: 700 }}>Failed to load problems.</Text>
            <Button variant="default" size="condensed" onClick={applyTimeframe}>Retry</Button>
          </Flex>
          {error && (
            <Text style={{ color: Colors.Text.Critical.Default, fontSize: "13px" }}>
              {formatQueryError(error)}
            </Text>
          )}
        </Flex>
      )}

      {/* Problems table */}
      {isLoading && baseFetchedProblems.length === 0 ? (
        <Flex justifyContent="center" paddingTop={32} paddingBottom={32}>
          <ProgressCircle aria-label="Loading problems" />
        </Flex>
      ) : (
        <DataTable
          columns={columns}
          data={filteredProblems}
          fullWidth
          resizable
          sortable
          defaultSortBy={[{ id: "started", desc: true }]}
          variant={{ verticalAlignment: "center" }}
          rowThresholds={[
            {
              type: "pill",
              color: STATUS_CARD_ACCENT.OPEN,
              comparator: (row: Problem) => row.status === "OPEN",
            },
          ]}
        >
          <DataTable.Pagination defaultPageSize={20} />
        </DataTable>
      )}

      {/* Problem history modal */}
      <Modal
        title={selectedProblem ? `${selectedProblem.displayId || selectedProblem.id} — History` : ""}
        show={selectedProblem !== null}
        onDismiss={() => setSelectedProblem(null)}
        size="medium"
      >
        {selectedProblem && (
          <Flex flexDirection="column" gap={0}>
            {/* Header row */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "180px 1fr 1fr",
              padding: "8px 12px",
              background: Colors.Background.Container.Neutral.Default,
              borderBottom: `1px solid ${Colors.Border.Neutral.Default}`,
            }}>
              <Text as="span" style={{ fontWeight: 700, fontSize: "12px" }}>Timestamp</Text>
              <Text as="span" style={{ fontWeight: 700, fontSize: "12px" }}>Event</Text>
              <Text as="span" style={{ fontWeight: 700, fontSize: "12px" }}>By</Text>
            </div>
            {selectedProblem.history.map((evt, i) => (
              <div
                key={i}
                style={{
                  display: "grid",
                  gridTemplateColumns: "180px 1fr 1fr",
                  padding: "10px 12px",
                  borderBottom: `1px solid ${Colors.Border.Neutral.Default}`,
                  background: i % 2 === 0
                    ? Colors.Background.Surface.Default
                    : Colors.Background.Container.Neutral.Default,
                }}
              >
                <Text as="span" style={{ fontSize: "13px" }}>{evt.timestamp}</Text>
                <Text as="span" style={{ fontSize: "13px" }}>
                  {HISTORY_EVENT_LABELS[evt.type]}
                </Text>
                <Text as="span" style={{ fontSize: "13px" }}>{evt.by}</Text>
              </div>
            ))}
          </Flex>
        )}
      </Modal>
      {/* Chat modal */}
      <Modal
        title={chatProblem ? `${chatProblem.displayId || chatProblem.id} — Send Message` : ""}
        show={chatProblem !== null}
        onDismiss={() => setChatProblem(null)}
        size="small"
      >
        {chatProblem && (
          <Flex flexDirection="column" gap={16}>
            <FormField>
              <Label>Title</Label>
              <TextInput
                value={chatTitle}
                onChange={(value) => setChatTitle(value)}
                placeholder="Message title"
              />
            </FormField>
            <FormField>
              <Label>Content</Label>
              <TextArea
                value={chatContent}
                onChange={(value) => setChatContent(value)}
                placeholder="Message content"
                rows={6}
              />
            </FormField>
            <Flex justifyContent="flex-end">
              <Button
                variant="accent"
                onClick={() => setChatProblem(null)}
                disabled={!chatTitle.trim() || !chatContent.trim()}
              >
                Send
              </Button>
            </Flex>
          </Flex>
        )}
      </Modal>

      {/* Escalation call modal */}
      <Modal
        title={callProblem ? `${callProblem.displayId || callProblem.id} — Escalation Contact` : ""}
        show={callProblem !== null}
        onDismiss={() => setCallProblem(null)}
        size="small"
      >
        {callProblem && (
          <Flex flexDirection="row" alignItems="center" gap={12} paddingTop={8} paddingBottom={8}>
            <AccountFilledIcon size={32} style={{ color: Colors.Text.Primary.Default, flexShrink: 0 }} />
            <Flex flexDirection="column" gap={4}>
              <Text style={{ fontWeight: 700 }}>
                {(!callProblem.escalationContact.name || callProblem.escalationContact.name === "—") ? "Contact undefined" : callProblem.escalationContact.name}
              </Text>
              <Text style={{ color: Colors.Text.Neutral.Default }}>
                {(!callProblem.escalationContact.phone || callProblem.escalationContact.phone === "—") ? "no phone number" : callProblem.escalationContact.phone}
              </Text>
            </Flex>
          </Flex>
        )}
      </Modal>
      {/* Assignee detail modal */}
      <Modal
        title="Assigned user"
        show={assigneeModal !== null}
        onDismiss={() => setAssigneeModal(null)}
        size="small"
      >
        {assigneeModal && (
          <Flex flexDirection="row" alignItems="center" gap={12} paddingTop={8} paddingBottom={8}>
            <AccountFilledIcon size={32} style={{ color: Colors.Text.Primary.Default, flexShrink: 0 }} />
            <Flex flexDirection="column" gap={4}>
              <Text style={{ fontWeight: 700 }}>{assigneeModal.name}</Text>
              <Text style={{ color: Colors.Text.Neutral.Default }}>
                {(!assigneeModal.email || assigneeModal.email === "—") ? "no email" : assigneeModal.email}
              </Text>
            </Flex>
          </Flex>
        )}
      </Modal>
    </Flex>
    </SegmentsProvider>
  );
};
