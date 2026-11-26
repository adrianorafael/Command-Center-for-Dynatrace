import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Flex, PageLayout } from "@dynatrace/strato-components/layouts";
import { Button } from "@dynatrace/strato-components/buttons";
import { ProgressCircle } from "@dynatrace/strato-components/content";
import { FilterBar, TimeframeSelector } from "@dynatrace/strato-components/filters";
import { SearchInput, Select } from "@dynatrace/strato-components/forms";
import { Text } from "@dynatrace/strato-components/typography";
import { RefreshAutoIcon, RefreshIcon } from "@dynatrace/strato-icons";
import type { Timeframe } from "@dynatrace/strato-components/core";
import { PRIORITIES } from "../../domain/contracts";
import { useAppData } from "../../hooks/AppDataContext";
import { readPrefs } from "../../hooks/prefs";
import { PageTitle } from "../../components/PageTitle";
import { PriorityChip } from "../../components/PriorityChip";
import { STATUS_LABEL } from "../../components/StatusIndicator";
import { EngineHealthBanner } from "../../components/Banners";
import { ErrorMessage, SimpleEmpty } from "../../components/QueryState";
import { IconButton } from "../../components/IconButton";
import { formatTime, pickerToMs } from "../../components/format";
import { KpiStrip } from "./KpiStrip";
import { IncidentTable } from "./IncidentTable";
import { IncidentDetails } from "./IncidentDetails";
import { ActionModals, type ModalRequest } from "./ActionModals";
import { applyFilters, DEFAULT_STATUS, isDefaultFilter, readFilters, SOURCE_LABEL, writeFilters, type ConsoleFilters } from "./filters";
import { useIncidentCommands } from "./useIncidentCommands";

const REFRESH_OPTIONS = [
  { value: 0, label: "Off" },
  { value: 15, label: "15 s" },
  { value: 30, label: "30 s" },
  { value: 60, label: "1 min" },
  { value: 300, label: "5 min" },
];

/** Show the refresh spinner only for refreshes slower than ~500 ms (loading-saving standard). */
function useDelayedFlag(flag: boolean, delay = 500): boolean {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!flag) {
      const t = window.setTimeout(() => setShow(false), 200);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(() => setShow(true), delay);
    return () => window.clearTimeout(t);
  }, [flag, delay]);
  return show;
}

export const ConsolePage = () => {
  const { data, isLoading, isRefreshing, error, refresh, lastUpdated, refreshSec, setRefreshSec, currentUser, userName, now, demo } =
    useAppData();
  const { id: routeId } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => readFilters(params), [params]);
  const [timeframe, setTimeframe] = useState<Timeframe | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [modal, setModal] = useState<ModalRequest>();
  const prefs = useMemo(() => readPrefs(), []);
  const ackTargetMs = prefs.ackTargetMin * 60_000;
  const cmd = useIncidentCommands();
  const tz = data?.settings.ui.timeZone;
  const showSpinner = useDelayedFlag(isRefreshing && !isLoading);
  const regionRef = useRef<HTMLDivElement>(null);

  const activeId = routeId ? decodeURIComponent(routeId) : null;
  const setActive = useCallback(
    (id: string | null) => {
      const qs = params.toString();
      navigate({ pathname: id ? `/incidents/${encodeURIComponent(id)}` : "/", search: qs ? `?${qs}` : "" });
    },
    [navigate, params],
  );

  const setFilters = useCallback(
    (patch: Partial<ConsoleFilters>) => setParams((p) => writeFilters(p, { ...readFilters(p), ...patch }), { replace: true }),
    [setParams],
  );

  const createdAfter = timeframe ? pickerToMs(timeframe.from) : undefined;
  const all = useMemo(() => data?.incidents ?? [], [data]);
  const visible = useMemo(() => applyFilters(all, filters, currentUser.uid, createdAfter), [all, filters, currentUser.uid, createdAfter]);
  const active = activeId ? all.find((i) => i.id === activeId) : undefined;

  // Keyboard shortcuts (DESIGN §13), off while typing and switchable in Settings (WCAG 2.1.4).
  useEffect(() => {
    if (!prefs.keyboardShortcuts) return;
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t && (t.closest("input, textarea, select, [contenteditable='true'], [role='combobox'], [role='dialog']") || modal)) return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const idx = visible.findIndex((i) => i.id === activeId);
      if (ev.key === "j" || ev.key === "k") {
        const next = visible[Math.min(visible.length - 1, Math.max(0, idx + (ev.key === "j" ? 1 : -1)))];
        if (next) setActive(next.id);
      } else if (ev.key === "Escape" && activeId) setActive(null);
      else if (ev.key === "a" && active?.status === "triggered") void cmd.ack([active.id]);
      else if (ev.key === "r" && active && active.status !== "resolved") void cmd.resolve([active.id]);
      else if (ev.key === "x" && activeId) setSelected((s) => ({ ...s, [activeId]: !s[activeId] }));
      else if (ev.key === "/") {
        ev.preventDefault();
        regionRef.current?.querySelector<HTMLInputElement>("input[type='search'], input")?.focus();
      } else if (ev.key === "R" && ev.shiftKey) void refresh();
      else return;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prefs.keyboardShortcuts, visible, activeId, active, cmd, setActive, refresh, modal]);

  const noSources = data && all.length === 0;
  const empty = noSources ? (
    <SimpleEmpty
      title="Connect your first event source"
      details="Send events through the Dynatrace Events API or let Davis problems flow in."
      actions={
        <Flex gap={8}>
          <Button variant="emphasized" onClick={() => navigate("/integrations")}>
            Set up inbound integration
          </Button>
          {!demo && <Button onClick={() => navigate("/settings#general")}>Turn on demo mode</Button>}
        </Flex>
      }
    />
  ) : isDefaultFilter(filters) && !timeframe ? (
    <SimpleEmpty
      title="No open incidents"
      details="Everything is quiet. New Davis problems and ingested events appear here automatically."
      actions={<Button onClick={() => setFilters({ status: ["resolved"] })}>Show resolved</Button>}
    />
  ) : (
    <SimpleEmpty
      title="No incidents match your filters"
      actions={
        <Button
          onClick={() => {
            setTimeframe(null);
            setFilters({ status: DEFAULT_STATUS, priority: [], team: [], assignee: [], service: [], source: [], escalation: [], q: "" });
          }}
        >
          Clear filters
        </Button>
      }
    />
  );

  const people = useMemo(() => {
    const uids = new Set<string>();
    data?.teams.forEach((t) => t.members.forEach((m) => uids.add(m.uid)));
    return [...uids].map((u) => ({ uid: u, name: userName(u) })).sort((a, b) => a.name.localeCompare(b.name));
  }, [data, userName]);
  const maxSteps = Math.max(1, ...(data?.policies ?? []).map((p) => p.steps.length));

  return (
    <>
      <PageLayout.Content>
        <Flex flexDirection="column" gap={16} padding={16} ref={regionRef}>
          <PageTitle
            title="Console"
            subtitle="Incidents from Davis problems and ingested events, newest first"
            suffix={
              <Flex alignItems="center" gap={8}>
                {showSpinner && <ProgressCircle size="small" aria-label="Refreshing" />}
                {lastUpdated && <Text textStyle="small">Updated {formatTime(lastUpdated, tz, true)}</Text>}
                <Select
                  value={refreshSec}
                  onChange={(v) => setRefreshSec(Number(v ?? 0))}
                  aria-label="Auto-refresh"
                >
                  <Select.Prefix>
                    <RefreshAutoIcon />
                  </Select.Prefix>
                  <Select.Content>
                    {REFRESH_OPTIONS.map((o) => (
                      <Select.Option key={o.value} value={o.value}>
                        {o.label}
                      </Select.Option>
                    ))}
                  </Select.Content>
                </Select>
                <IconButton label="Refresh now" icon={<RefreshIcon />} onClick={() => void refresh()} />
              </Flex>
            }
          />
          <EngineHealthBanner />
          {error ? <ErrorMessage title="Couldn't load incidents. Check your connection and select Retry." error={error} onRetry={() => void refresh()} /> : null}
          <KpiStrip
            incidents={all}
            now={now}
            me={currentUser.uid}
            ackTargetMs={ackTargetMs}
            loading={isLoading}
            onFilter={(patch) => setFilters({ status: DEFAULT_STATUS, priority: [], assignee: [], ...patch })}
          />
          {/* Search first, then FilterBar with the TimeframeSelector as its last pinned item (Strato TimeframeSelector
              "Where to position" + FilterBar "TimeframeSelector as filter control"). Outside the FilterBar the selector's
              root has align-self: start and floated 20 px above the labelled fields. */}
          <Flex gap={8} alignItems="flex-end" flexWrap="wrap">
            <SearchInput
              value={filters.q}
              onChange={(v) => setFilters({ q: v })}
              placeholder="Search title, ID, entity"
              aria-label="Search incidents"
            />
            <Flex flexGrow={1} style={{ minWidth: 320 }}>
              <FilterBar
                onFilterChange={() => undefined}
                defaultPinnedState={{
                  status: "pinned",
                  priority: "pinned",
                  team: "pinned",
                  assignee: "pinned",
                  // FilterBar renders pinned items before pinned-optional ones; service is pinned so the timeframe stays last.
                  service: "pinned",
                  source: "optional",
                  escalation: "optional",
                  created: "pinned",
                }}
              >
                <FilterBar.Item name="status" label="Status">
                  <Select multiple clearable name="status" value={filters.status} onChange={(v) => setFilters({ status: v ?? [] })}>
                    <Select.Content>
                      {(Object.keys(STATUS_LABEL) as (keyof typeof STATUS_LABEL)[]).map((s) => (
                        <Select.Option key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </Select.Option>
                      ))}
                    </Select.Content>
                  </Select>
                </FilterBar.Item>
                <FilterBar.Item name="priority" label="Priority">
                  <Select multiple clearable name="priority" value={filters.priority} onChange={(v) => setFilters({ priority: v ?? [] })}>
                    <Select.Content>
                      {PRIORITIES.map((p) => (
                        <Select.Option key={p} value={p} textValue={p}>
                          <PriorityChip priority={p} size="condensed" />
                        </Select.Option>
                      ))}
                    </Select.Content>
                  </Select>
                </FilterBar.Item>
                <FilterBar.Item name="team" label="Team">
                  <Select multiple clearable name="team" value={filters.team} onChange={(v) => setFilters({ team: v ?? [] })}>
                    <Select.Content>
                      {(data?.teams ?? []).map((t) => (
                        <Select.Option key={t.id} value={t.id}>
                          {t.name}
                        </Select.Option>
                      ))}
                    </Select.Content>
                  </Select>
                </FilterBar.Item>
                <FilterBar.Item name="assignee" label="Assignee">
                  <Select multiple clearable name="assignee" value={filters.assignee} onChange={(v) => setFilters({ assignee: v ?? [] })}>
                    <Select.Filter />
                    <Select.Content>
                      <Select.Option value="me">Me</Select.Option>
                      <Select.Option value="unassigned">Unassigned</Select.Option>
                      {people.map((u) => (
                        <Select.Option key={u.uid} value={u.uid}>
                          {u.name}
                        </Select.Option>
                      ))}
                    </Select.Content>
                  </Select>
                </FilterBar.Item>
                <FilterBar.Item name="service" label="Service">
                  <Select multiple clearable name="service" value={filters.service} onChange={(v) => setFilters({ service: v ?? [] })}>
                    <Select.Filter />
                    <Select.Content>
                      {(data?.services ?? []).map((s) => (
                        <Select.Option key={s.id} value={s.id}>
                          {s.name}
                        </Select.Option>
                      ))}
                    </Select.Content>
                  </Select>
                </FilterBar.Item>
                <FilterBar.Item name="source" label="Source">
                  <Select multiple clearable name="source" value={filters.source} onChange={(v) => setFilters({ source: v ?? [] })}>
                    <Select.Content>
                      {Object.entries(SOURCE_LABEL).map(([k, l]) => (
                        <Select.Option key={k} value={k}>
                          {l}
                        </Select.Option>
                      ))}
                    </Select.Content>
                  </Select>
                </FilterBar.Item>
                <FilterBar.Item name="escalation" label="Escalation level">
                  <Select multiple clearable name="escalation" value={filters.escalation} onChange={(v) => setFilters({ escalation: v ?? [] })}>
                    <Select.Content>
                      <Select.Option value="none">Not started</Select.Option>
                      {Array.from({ length: maxSteps }, (_, i) => (
                        <Select.Option key={i} value={String(i + 1)}>
                          Step {i + 1}
                        </Select.Option>
                      ))}
                      <Select.Option value="exhausted">Exhausted</Select.Option>
                    </Select.Content>
                  </Select>
                </FilterBar.Item>
                <FilterBar.Item name="created" label="Created">
                  <TimeframeSelector value={timeframe} onChange={setTimeframe} />
                </FilterBar.Item>
              </FilterBar>
            </Flex>
          </Flex>
          <IncidentTable
            incidents={visible}
            loading={isLoading}
            activeId={activeId}
            onActivate={setActive}
            selected={selected}
            onSelect={setSelected}
            onModal={setModal}
            empty={empty}
            density={prefs.tableDensity}
            ackTargetMs={ackTargetMs}
          />
        </Flex>
      </PageLayout.Content>
      <PageLayout.Details
        collapsed={!activeId}
        onCollapsedChange={(c) => c && setActive(null)}
        defaultLayout="split"
        defaultWidth="40%"
        minWidth={420}
        resizable
      >
        {active ? (
          <>
            <PageLayout.Details.ControlBar />
            <IncidentDetails incident={active} onModal={setModal} />
          </>
        ) : activeId && data ? (
          <Flex padding={16}>
            <SimpleEmpty
              size="small"
              title="Incident not found"
              details="It may have been archived after it was resolved."
              actions={<Button onClick={() => setActive(null)}>Close</Button>}
            />
          </Flex>
        ) : null}
      </PageLayout.Details>
      <ActionModals request={modal} onClose={() => setModal(undefined)} />
    </>
  );
};
