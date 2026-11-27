/**
 * Console (routes `/` and `/incidents/:id`): KPI strip, filterable incident table, details panel, shortcuts.
 *
 * The Resolved and All tabs show only incidents created today (display time zone) unless a timeframe is picked in
 * "Created"; the bound comes from `createdBound` in filters.ts, which the tab counts use too.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Flex, PageLayout } from "@dynatrace/strato-components/layouts";
import { Button } from "@dynatrace/strato-components/buttons";
import { ProgressCircle } from "@dynatrace/strato-components/content";
import { FilterBar, TimeframeSelector } from "@dynatrace/strato-components/filters";
import { SearchInput, Select, ToggleButtonGroup } from "@dynatrace/strato-components/forms";
import { Text } from "@dynatrace/strato-components/typography";
import { RefreshAutoIcon, RefreshIcon } from "@dynatrace/strato-icons";
import Colors from "@dynatrace/strato-design-tokens/colors";
import type { Timeframe } from "@dynatrace/strato-components/core";
import { PRIORITIES } from "../../domain/contracts";
import { useAppData } from "../../hooks/AppDataContext";
import { readPrefs, writePrefs } from "../../hooks/prefs";
import { PageTitle } from "../../components/PageTitle";
import { PriorityChip } from "../../components/PriorityChip";
import { EngineHealthBanner } from "../../components/Banners";
import { ErrorMessage, SimpleEmpty } from "../../components/QueryState";
import { IconButton } from "../../components/IconButton";
import { browserTimeZone, formatTime, pickerToMs } from "../../components/format";
import { KpiStrip } from "./KpiStrip";
import { IncidentTable } from "./IncidentTable";
import { IncidentDetails } from "./IncidentDetails";
import { ActionModals, type ModalRequest } from "./ActionModals";
import { RowActionsPicker } from "./RowActionsPicker";
import type { RowActionId } from "./rowActions";
import {
  applyFilters,
  createdBound,
  DEFAULT_STATUS,
  includesResolved,
  isDefaultFilter,
  readFilters,
  SOURCE_LABEL,
  STATUS_VIEWS,
  statusViewCounts,
  statusViewOf,
  writeFilters,
  type ConsoleFilters,
  timeframeFromParam,
} from "./filters";
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
  // `?created=24h` (other pages' links, e.g. Integrations → Show events) opens with the last N hours picked in Created.
  const [timeframe, setTimeframe] = useState<Timeframe | null>(() => timeframeFromParam(params.get("created")));
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [modal, setModal] = useState<ModalRequest>();
  const prefs = useMemo(() => readPrefs(), []);
  const ackTargetMs = prefs.ackTargetMin * 60_000;
  const [inlineActions, setInlineActions] = useState<RowActionId[]>(prefs.consoleInlineActions);
  const [pickerOpen, setPickerOpen] = useState(false);
  const saveInlineActions = useCallback((next: RowActionId[]) => {
    setInlineActions(next);
    // Re-read so a preference changed elsewhere since this page mounted (e.g. in Settings) isn't overwritten.
    writePrefs({ ...readPrefs(), consoleInlineActions: next });
  }, []);
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

  const pickedFrom = timeframe ? pickerToMs(timeframe.from) : undefined;
  // "Today" is the display day: settings.ui.timeZone, else the browser's zone (same fallback as the time labels).
  const dayZone = tz || browserTimeZone();
  // `now` ticks every 15 s even with auto-refresh off, so the bound rolls over at local midnight.
  const bound = createdBound(filters.status, pickedFrom, now, dayZone);
  const createdAfter = bound.createdAfter;
  const all = useMemo(() => data?.incidents ?? [], [data]);
  const visible = useMemo(() => applyFilters(all, filters, currentUser.uid, createdAfter), [all, filters, currentUser.uid, createdAfter]);
  // Tab counts follow every other filter, so each tab says how many rows it would show.
  const statusCounts = useMemo(
    () => statusViewCounts(all, filters, currentUser.uid, pickedFrom, now, dayZone),
    [all, filters, currentUser.uid, pickedFrom, now, dayZone],
  );
  const active = activeId ? all.find((i) => i.id === activeId) : undefined;

  // Keyboard shortcuts (DESIGN §13), off while typing and switchable in Settings (WCAG 2.1.4).
  useEffect(() => {
    if (!prefs.keyboardShortcuts) return;
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t && (t.closest("input, textarea, select, [contenteditable='true'], [role='combobox'], [role='dialog']") || modal || pickerOpen)) return;
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
  }, [prefs.keyboardShortcuts, visible, activeId, active, cmd, setActive, refresh, modal, pickerOpen]);

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
      title={bound.today ? "No incidents created today match your filters" : "No incidents match your filters"}
      details={bound.today ? "Pick a timeframe in Created to see older incidents." : undefined}
      actions={
        <Button
          onClick={() => {
            setTimeframe(null);
            setFilters({ status: DEFAULT_STATUS, priority: [], team: [], assignee: [], ackby: [], service: [], source: [], escalation: [], q: "" });
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
  // Everyone who acknowledged an incident in the loaded data (from `all`, so a chosen person never drops out of the list).
  const ackers = useMemo(() => {
    const uids = new Set<string>();
    // The current user stays listed by name too (as in Assignee), so a shared `ackby=<uid>` link has a matching option.
    all.forEach((i) => i.acknowledgedBy && uids.add(i.acknowledgedBy));
    return [...uids].map((u) => ({ uid: u, name: userName(u) })).sort((a, b) => a.name.localeCompare(b.name));
  }, [all, userName]);
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
            onFilter={(patch) => setFilters({ status: DEFAULT_STATUS, priority: [], assignee: [], ackby: [], ...patch })}
          />
          {/* Search first, then FilterBar with the TimeframeSelector as its last pinned item (Strato TimeframeSelector
              "Where to position" + FilterBar "TimeframeSelector as filter control"). Outside the FilterBar the selector's
              root has align-self: start and floated 20 px above the labelled fields. */}
          <Flex gap={8} alignItems="flex-end" flexWrap="wrap">
            <SearchInput
              value={filters.q}
              onChange={(v) => setFilters({ q: v })}
              placeholder="Search title, ID, entity, tag"
              aria-label="Search incidents"
            />
            <Flex flexGrow={1} style={{ minWidth: 320 }}>
              <FilterBar
                onFilterChange={() => undefined}
                defaultPinnedState={{
                  priority: "pinned",
                  team: "pinned",
                  assignee: "pinned",
                  ackby: "pinned",
                  // FilterBar renders pinned items before pinned-optional ones; service is pinned so the timeframe stays last.
                  service: "pinned",
                  source: "optional",
                  escalation: "optional",
                  created: "pinned",
                }}
              >
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
                <FilterBar.Item name="ackby" label="Acknowledged by">
                  <Select multiple clearable name="ackby" value={filters.ackby} onChange={(v) => setFilters({ ackby: v ?? [] })}>
                    <Select.Filter />
                    <Select.Content>
                      <Select.Option value="me">Me</Select.Option>
                      {ackers.map((u) => (
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
          {/* Status tabs of the table, same pattern as the "Show" bar of War rooms. */}
          <Flex flexDirection="column" gap={4}>
            <Text textStyle="small-emphasized">Show</Text>
            <ToggleButtonGroup
              value={statusViewOf(filters.status) ?? ""}
              onChange={(v: string) => {
                const view = STATUS_VIEWS.find((x) => x.id === v);
                if (view) setFilters({ status: view.status });
              }}
            >
              {STATUS_VIEWS.map((v) => (
                <ToggleButtonGroup.Item key={v.id} value={v.id}>
                  {`${v.label}${pickedFrom === undefined && includesResolved(v.status) ? " today" : ""} (${statusCounts[v.id] ?? 0})`}
                </ToggleButtonGroup.Item>
              ))}
            </ToggleButtonGroup>
            {bound.today && (
              <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued }}>
                Today · pick a timeframe in Created to see older incidents
              </Text>
            )}
          </Flex>
          {/* DataTable.Toolbar renders only its own slots, so the gear is laid over the right end of the table's toolbar
              row (the table reserves room for it, see TOOLBAR_GEAR_SPACE) to sit beside the column settings. */}
          <div style={{ position: "relative" }}>
            <div style={{ position: "absolute", top: 0, right: 0, zIndex: 1 }}>
              <RowActionsPicker value={inlineActions} onChange={saveInlineActions} onOpenChange={setPickerOpen} />
            </div>
          <IncidentTable
            inlineActions={inlineActions}
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
          </div>
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
