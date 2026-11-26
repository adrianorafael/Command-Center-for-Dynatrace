import React, { useMemo, useState } from "react";
import { Link as RouterLink, useNavigate, useSearchParams } from "react-router-dom";
import { Flex, Grid, PageLayout, Surface } from "@dynatrace/strato-components/layouts";
import { Button } from "@dynatrace/strato-components/buttons";
import { Tabs, Tab } from "@dynatrace/strato-components/navigation";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import { Heading, Link, Paragraph, Text } from "@dynatrace/strato-components/typography";
import { FormField, Label, Select, Switch, TextArea } from "@dynatrace/strato-components/forms";
import { PlayIcon, PlusIcon, SuccessIcon, XmarkIcon, LockIcon } from "@dynatrace/strato-icons";
import Colors from "@dynatrace/strato-design-tokens/colors";
import type { Timeseries } from "@dynatrace/strato-components/charts";
import { PRIORITIES, SCHEMA_VERSION, type Alert, type Priority, type RoutingRule, type Service } from "../../domain/contracts";
import { useAppData, nextRev } from "../../hooks/AppDataContext";
import { evaluateCondition, newId, routeAlert, ruleMatches } from "../../hooks/domain";
import { CellEmpty, CellText, LIST_TABLE_VARIANT } from "../../components/tableKit";
import { PageTitle } from "../../components/PageTitle";
import { QueryState, SimpleEmpty } from "../../components/QueryState";
import { PriorityChip } from "../../components/PriorityChip";
import { Health } from "../../components/StatusIndicator";
import { ConfirmModal } from "../../components/ConfirmModal";
import { IconButton } from "../../components/IconButton";
import { RuleSheet, conditionText, rulesSummary } from "./RuleSheet";

const TABS = ["services", "rules", "test", "mapping"] as const;
const DAY = 86_400_000;

// ─── Services list ──────────────────────────────────────────────────────────

interface ServiceRow {
  id: string;
  name: string;
  team: string;
  policy: string;
  rules: number;
  open: Partial<Record<Priority, number>>;
  openTotal: number;
  noise: Timeseries;
  service: Service;
}

const ServicesTab = ({ onNew }: { onNew: () => void }) => {
  const { data, now, mutate } = useAppData();
  const navigate = useNavigate();
  const [toDelete, setToDelete] = useState<Service>();
  const rows = useMemo<ServiceRow[]>(
    () =>
      (data?.services ?? []).map((s) => {
        const incs = (data?.incidents ?? []).filter((i) => i.serviceId === s.id);
        const open: Partial<Record<Priority, number>> = {};
        incs.filter((i) => i.status !== "resolved").forEach((i) => (open[i.priority] = (open[i.priority] ?? 0) + 1));
        const start = Math.floor(now / DAY) * DAY - 6 * DAY;
        const days = Array.from({ length: 7 }, () => 0);
        incs.forEach((i) => {
          const k = Math.floor((i.createdAt - start) / DAY);
          if (k >= 0 && k < 7) days[k]++;
        });
        return {
          id: s.id,
          name: s.name,
          team: data?.teams.find((t) => t.id === s.teamId)?.name ?? "–",
          policy: data?.policies.find((p) => p.id === s.policyId)?.name ?? "Team default",
          rules: (data?.rules.rules ?? []).filter((r) => r.then.serviceId === s.id).length,
          open,
          openTotal: Object.values(open).reduce((a, b) => a + (b ?? 0), 0),
          noise: { name: "Incidents", datapoints: days.map((v, k) => ({ start: new Date(start + k * DAY), end: new Date(start + (k + 1) * DAY), value: v })) },
          service: s,
        };
      }),
    [data, now],
  );
  const columns: DataTableColumnDef<ServiceRow>[] = [
    {
      id: "name",
      header: "Service",
      accessor: "name",
      width: 200,
      cell: ({ rowData }) => (
        <Link as={RouterLink} to={`/services/${rowData.id}`}>
          {rowData.name}
        </Link>
      ),
    },
    { id: "team", header: "Team", accessor: "team", width: 150 },
    { id: "policy", header: "Escalation policy", accessor: "policy", width: 200, cell: ({ rowData }) => <CellText>{rowData.policy}</CellText> },
    { id: "rules", header: "Rules", accessor: "rules", width: 80, sortType: "number" },
    {
      id: "open",
      header: "Open incidents",
      accessor: "openTotal",
      sortType: "number",
      width: 220,
      cell: ({ rowData }) =>
        rowData.openTotal ? (
          <Flex gap={4} flexWrap="wrap">
            {PRIORITIES.filter((p) => rowData.open[p]).map((p) => (
              <PriorityChip key={p} priority={p} size="condensed" count={rowData.open[p]} />
            ))}
          </Flex>
        ) : (
          <CellEmpty>None</CellEmpty>
        ),
    },
    {
      id: "noise",
      header: "Noise last 7 days",
      accessor: "noise",
      columnType: "sparkline",
      width: 200,
      config: { variant: "bar", yAxis: { min: 0 }, xAxis: { min: "data-min", max: "data-max" } },
    },
  ];
  if (data && rows.length === 0)
    return (
      <SimpleEmpty
        title="No services yet"
        details="Services group alerts for a part of your system and decide the owning team and escalation policy."
        actions={
          <Button variant="accent" color="primary" onClick={onNew}>
            New service
          </Button>
        }
      />
    );
  return (
    <>
      <DataTable data={rows} columns={columns} rowId={(r) => r.id} fullWidth sortable variant={LIST_TABLE_VARIANT}>
        <DataTable.RowActions>
          {(row) => {
            const r = row as ServiceRow;
            return (
              <Flex gap={4}>
                <Button size="condensed" onClick={() => navigate(`/services/${r.id}`)}>
                  Edit
                </Button>
                <Button size="condensed" color="critical" onClick={() => setToDelete(r.service)}>
                  Delete
                </Button>
              </Flex>
            );
          }}
        </DataTable.RowActions>
      </DataTable>
      <ConfirmModal
        show={!!toDelete}
        title={`Delete ${toDelete?.name ?? "service"}?`}
        onDismiss={() => setToDelete(undefined)}
        onConfirm={() => (toDelete ? mutate((s) => s.deleteService(toDelete.id), "Service deleted").catch(() => undefined) : undefined)}
      >
        Routing rules that point to this service stop assigning it. Existing incidents keep their service.
      </ConfirmModal>
    </>
  );
};

// ─── Routing rules ──────────────────────────────────────────────────────────

interface RuleRow extends RoutingRule {
  pos: number;
  summary: string;
  thenText: string;
  matched24: number;
}

export function emptyRule(serviceId?: string): RoutingRule {
  return { id: newId("rule"), name: "", enabled: true, match: "all", conditions: [{ field: "title", op: "contains", value: "" }], then: serviceId ? { serviceId } : {} };
}

export const RulesTab = ({ onlyService }: { onlyService?: string }) => {
  const { data, now, mutate } = useAppData();
  const [editing, setEditing] = useState<RoutingRule>();
  const [toDelete, setToDelete] = useState<RoutingRule>();
  const rules = useMemo(() => data?.rules.rules ?? [], [data]);
  const rows = useMemo<RuleRow[]>(
    () =>
      rules
        .map((r, i) => {
          const parts = [
            r.then.suppress ? "Suppress" : "",
            r.then.serviceId ? (data?.services.find((s) => s.id === r.then.serviceId)?.name ?? r.then.serviceId) : "",
            r.then.teamId ? (data?.teams.find((t) => t.id === r.then.teamId)?.name ?? "") : "",
            r.then.priority ?? "",
            r.then.policyId ? `policy ${data?.policies.find((p) => p.id === r.then.policyId)?.name ?? ""}` : "",
          ].filter(Boolean);
          return {
            ...r,
            pos: i + 1,
            summary: rulesSummary(r),
            thenText: `→ ${parts.join(", ") || "tags only"}`,
            matched24: (data?.incidents ?? []).filter((x) => x.ruleId === r.id && x.createdAt > now - DAY).length,
          };
        })
        .filter((r) => !onlyService || r.then.serviceId === onlyService),
    [rules, data, now, onlyService],
  );
  const saveRules = (list: RoutingRule[], msg: string) => {
    if (!data) return Promise.resolve();
    return mutate((s) => s.saveRules(nextRev({ ...data.rules, schemaVersion: SCHEMA_VERSION, rules: list })), msg);
  };
  const columns: DataTableColumnDef<RuleRow>[] = [
    { id: "pos", header: "#", accessor: "pos", width: 48 },
    { id: "name", header: "Name", accessor: "name", width: 200, cell: ({ rowData }) => <Text textStyle="base-emphasized">{rowData.name}</Text> },
    {
      id: "conditions",
      header: "Conditions",
      accessor: "summary",
      width: "1fr",
      minWidth: 260,
      cell: ({ rowData }) => <CellText code>{rowData.summary}</CellText>,
    },
    { id: "then", header: "Actions", accessor: "thenText", width: 300, cell: ({ rowData }) => <CellText>{rowData.thenText}</CellText> },
    {
      id: "enabled",
      header: "Enabled",
      accessor: (r) => (r.enabled ? "Yes" : "No"),
      width: 90,
      cell: ({ rowData }) => (rowData.enabled ? <Health status="ideal">On</Health> : <Health status="neutral">Off</Health>),
    },
    { id: "matched", header: "Matched 24 h", accessor: "matched24", width: 120 },
  ];
  return (
    <Flex flexDirection="column" gap={12}>
      <Flex justifyContent="space-between" alignItems="center" gap={8} flexWrap="wrap">
        <Paragraph>Rules are evaluated top to bottom. The first enabled rule that matches wins. Drag rows to reorder.</Paragraph>
        <Button onClick={() => setEditing(emptyRule(onlyService))}>
          <Button.Prefix>
            <PlusIcon />
          </Button.Prefix>
          New rule
        </Button>
      </Flex>
      <DataTable
        data={rows}
        columns={columns}
        rowId={(r) => r.id}
        fullWidth
        variant={LIST_TABLE_VARIANT}
        rowOrdering={onlyService ? undefined : { enableDragAndDrop: true }}
        rowOrder={onlyService ? undefined : rows.map((r) => r.id)}
        onRowOrderChange={(order) => {
          const byId = new Map(rules.map((r) => [r.id, r]));
          void saveRules(order.map((id) => byId.get(id)).filter((r): r is RoutingRule => !!r), "Rule order saved").catch(() => undefined);
        }}
      >
        <DataTable.RowActions>
          {(row) => {
            const r = row as RuleRow;
            const original = rules.find((x) => x.id === r.id);
            return (
              <Flex gap={4} alignItems="center">
                <Switch
                  aria-label={`Enable ${r.name}`}
                  value={r.enabled}
                  onChange={(v) => void saveRules(rules.map((x) => (x.id === r.id ? { ...x, enabled: v } : x)), v ? "Rule enabled" : "Rule disabled").catch(() => undefined)}
                />
                <Button size="condensed" onClick={() => setEditing(original)}>
                  Edit
                </Button>
                <IconButton size="condensed" label="Delete rule" icon={<XmarkIcon />} onClick={() => setToDelete(original)} />
              </Flex>
            );
          }}
        </DataTable.RowActions>
        <DataTable.EmptyState>
          <SimpleEmpty size="small" title="No routing rules" details="Without rules, alerts use cc.service from the event, then the defaults from Settings." />
        </DataTable.EmptyState>
      </DataTable>
      <Surface padding={12}>
        <Flex alignItems="center" gap={8}>
          <LockIcon />
          <Text textStyle="base-emphasized">Default (no rule matched)</Text>
          <Text>
            → cc.service from the event, else team{" "}
            {data?.teams.find((t) => t.id === data.settings.defaults.teamId)?.name ?? "none"}, priority by severity/category mapping (fallback{" "}
            {data?.settings.defaults.priority})
          </Text>
        </Flex>
      </Surface>
      <RuleSheet
        rule={editing}
        onClose={() => setEditing(undefined)}
        onSave={(r) => {
          const exists = rules.some((x) => x.id === r.id);
          return saveRules(exists ? rules.map((x) => (x.id === r.id ? r : x)) : [...rules, r], exists ? "Rule saved" : "Rule created");
        }}
      />
      <ConfirmModal
        show={!!toDelete}
        title={`Delete rule ${toDelete?.name ?? ""}?`}
        onDismiss={() => setToDelete(undefined)}
        onConfirm={() => (toDelete ? saveRules(rules.filter((x) => x.id !== toDelete.id), "Rule deleted").catch(() => undefined) : undefined)}
      >
        Alerts that matched this rule fall through to the next rule or the default route.
      </ConfirmModal>
    </Flex>
  );
};

// ─── Test a rule ────────────────────────────────────────────────────────────

const SAMPLE: Alert = {
  source: "generic-event",
  sourceId: "checkout-latency",
  dedupKey: "generic-event.checkout-latency",
  title: "Checkout latency above 2 s",
  category: "SLOWDOWN",
  severity: 3,
  sourceStatus: "ACTIVE",
  startedAt: 0,
  entities: [{ id: "SERVICE-0000000000000001", name: "checkout", type: "SERVICE" }],
  tags: ["env:prod"],
  underMaintenance: false,
  muted: false,
  fields: { "cc.service": "checkout", "cc.priority": "P2" },
};

export const TestTab = () => {
  const { data } = useAppData();
  const recent = useMemo(() => [...(data?.incidents ?? [])].sort((a, b) => b.createdAt - a.createdAt).slice(0, 25), [data]);
  const [text, setText] = useState(() => JSON.stringify(SAMPLE, null, 2));
  const [result, setResult] = useState<{ alert: Alert } | { error: string }>();
  const run = () => {
    try {
      const parsed = JSON.parse(text) as Partial<Alert>;
      const alert: Alert = { ...SAMPLE, entities: [], tags: [], fields: {}, ...parsed };
      setResult({ alert });
    } catch (e) {
      const m = /position (\d+)/.exec(e instanceof Error ? e.message : "");
      const line = m ? text.slice(0, Number(m[1])).split("\n").length : undefined;
      setResult({ error: line ? `Fix the JSON on line ${line}.` : "Fix the JSON: it couldn't be parsed." });
    }
  };
  const ctx = data ? { rules: data.rules.rules, services: data.services, teams: data.teams, settings: data.settings } : undefined;
  const outcome = result && "alert" in result && ctx ? routeAlert(result.alert, ctx) : undefined;
  const matched = outcome?.ruleId ? data?.rules.rules.find((r) => r.id === outcome.ruleId) : undefined;
  const closest =
    result && "alert" in result && !matched
      ? [...(data?.rules.rules ?? [])]
          .filter((r) => r.enabled && r.conditions.length)
          .sort((a, b) => b.conditions.filter((c) => evaluateCondition(result.alert, c)).length / b.conditions.length - a.conditions.filter((c) => evaluateCondition(result.alert, c)).length / a.conditions.length)[0]
      : undefined;
  const shown = matched ?? closest;
  return (
    <Grid gridTemplateColumns="minmax(320px, 1fr) minmax(320px, 1fr)" gap={16}>
      <Flex flexDirection="column" gap={12}>
        <FormField>
          <Label>Load sample</Label>
          <Select
            value={null}
            onChange={(v) => {
              if (v === "sample") setText(JSON.stringify(SAMPLE, null, 2));
              const inc = recent.find((i) => i.id === v);
              if (inc) setText(JSON.stringify(inc.alert, null, 2));
            }}
          >
            <Select.Content>
              <Select.Option value="sample">Custom event (example)</Select.Option>
              <Select.Group>
                <Select.GroupLabel>Recent alerts</Select.GroupLabel>
                {recent.map((i) => (
                  <Select.Option key={i.id} value={i.id}>
                    {i.alert.title}
                  </Select.Option>
                ))}
              </Select.Group>
            </Select.Content>
          </Select>
        </FormField>
        <FormField>
          <Label>Alert (JSON, normalised shape)</Label>
          <TextArea value={text} onChange={setText} rows={18} style={{ fontFamily: "monospace" }} />
          {result && "error" in result && <Text style={{ color: Colors.Text.Critical.Default }}>{result.error}</Text>}
        </FormField>
        <Flex>
          <Button color="primary" variant="accent" onClick={run}>
            <Button.Prefix>
              <PlayIcon />
            </Button.Prefix>
            Run test
          </Button>
        </Flex>
      </Flex>
      <Surface padding={16} style={{ alignSelf: "start" }}>
        {!outcome ? (
          <Text>Run a test to see which rule matches, and the team, policy and priority the incident would get.</Text>
        ) : (
          <Flex flexDirection="column" gap={12}>
            {outcome.suppress ? (
              <Health status="neutral">Suppressed by rule {matched?.name}: no incident would be created</Health>
            ) : matched ? (
              <Health status="ideal">
                Matched rule {(data?.rules.rules.indexOf(matched) ?? 0) + 1}: {matched.name}
              </Health>
            ) : (
              <Health status="neutral">No rule matched; default route applies</Health>
            )}
            <Flex gap={8} alignItems="center" flexWrap="wrap">
              <PriorityChip priority={outcome.priority} />
              <Text>
                Team: {data?.teams.find((t) => t.id === outcome.teamId)?.name ?? "none"} · Service:{" "}
                {data?.services.find((s) => s.id === outcome.serviceId)?.name ?? "none"} · Policy:{" "}
                {data?.policies.find((p) => p.id === outcome.policyId)?.name ?? "none"}
              </Text>
            </Flex>
            <Text textStyle="small">Priority source: {outcome.prioritySource}</Text>
            {shown && result && "alert" in result && (
              <Flex flexDirection="column" gap={4}>
                <Text textStyle="base-emphasized">{matched ? "Conditions" : `Closest rule: ${shown.name}`}</Text>
                {shown.conditions.map((c, i) => {
                  const ok = evaluateCondition(result.alert, c);
                  return (
                    <Flex key={i} gap={8} alignItems="center">
                      {ok ? <SuccessIcon style={{ color: Colors.Icon.Success.Default }} /> : <XmarkIcon style={{ color: Colors.Icon.Critical.Default }} />}
                      <Text fontStyle="code">{conditionText(c)}</Text>
                    </Flex>
                  );
                })}
                {!ruleMatches(result.alert, shown) && matched === undefined && shown.match === "all" && (
                  <Text textStyle="small">All conditions must hold for this rule.</Text>
                )}
              </Flex>
            )}
          </Flex>
        )}
      </Surface>
    </Grid>
  );
};

// ─── Priority mapping ───────────────────────────────────────────────────────

const MappingTab = () => {
  const { data, mutate } = useAppData();
  const [busy, setBusy] = useState(false);
  const [cat, setCat] = useState<Record<string, Priority>>();
  const [sev, setSev] = useState<Record<string, Priority>>();
  const [fallback, setFallback] = useState<Priority>();
  if (!data) return null;
  const d = data.settings.defaults;
  const category = cat ?? d.priorityByCategory;
  const severity = sev ?? d.priorityBySeverity;
  const fb = fallback ?? d.priority;
  const row = (label: string, value: Priority, set: (p: Priority) => void) => (
    <Flex key={label} alignItems="center" gap={12}>
      <Text fontStyle="code" style={{ width: 220 }}>
        {label}
      </Text>
      <Select value={value} onChange={(v) => v && set(v)} aria-label={`Priority for ${label}`}>
        <Select.Content>
          {PRIORITIES.map((p) => (
            <Select.Option key={p} value={p}>
              {p}
            </Select.Option>
          ))}
        </Select.Content>
      </Select>
      <PriorityChip priority={value} size="condensed" />
    </Flex>
  );
  return (
    <Flex flexDirection="column" gap={16} style={{ maxWidth: 720 }}>
      <Paragraph>
        When no rule sets a priority and the event doesn't carry cc.priority, the service default applies, then the event severity, then its category.
        Category names follow the Davis event categories (UNVERIFIED against a tenant).
      </Paragraph>
      <Grid gridTemplateColumns="repeat(auto-fit, minmax(320px, 1fr))" gap={24}>
        <Flex flexDirection="column" gap={8}>
          <Heading level={4}>By category</Heading>
          {Object.entries(category).map(([k, v]) => row(k, v, (p) => setCat({ ...category, [k]: p })))}
        </Flex>
        <Flex flexDirection="column" gap={8}>
          <Heading level={4}>By severity (1 = most severe)</Heading>
          {Object.entries(severity).map(([k, v]) => row(`severity ${k}`, v, (p) => setSev({ ...severity, [k]: p })))}
          <Heading level={4}>Fallback</Heading>
          {row("everything else", fb, setFallback)}
        </Flex>
      </Grid>
      <Flex>
        <Button
          color="primary"
          variant="accent"
          loading={busy}
          disabled={!cat && !sev && !fallback}
          onClick={() => {
            setBusy(true);
            mutate(
              (s) => s.saveSettings(nextRev({ ...data.settings, defaults: { ...d, priorityByCategory: category, priorityBySeverity: severity, priority: fb } })),
              "Priority mapping saved",
            )
              .then(() => {
                setCat(undefined);
                setSev(undefined);
                setFallback(undefined);
              })
              .catch(() => undefined)
              .finally(() => setBusy(false));
          }}
        >
          Save
        </Button>
      </Flex>
    </Flex>
  );
};

// ─── New service modal + page ───────────────────────────────────────────────

export function newService(teamId?: string): Service {
  return { schemaVersion: SCHEMA_VERSION, id: newId("service"), name: "", teamId: teamId ?? "", rev: 0 };
}

export const ServicesPage = () => {
  const { isLoading, error, refresh, data } = useAppData();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = Math.max(0, TABS.indexOf((params.get("tab") ?? "services") as (typeof TABS)[number]));
  const createNew = () => navigate("/services/new");
  return (
    <PageLayout.Content>
      <Flex flexDirection="column" gap={16} padding={16}>
        <PageTitle
          title="Services"
          subtitle="Services, ordered routing rules (first match wins), and the priority mapping"
          action={
            <Button color="primary" variant="accent" onClick={createNew}>
              <Button.Prefix>
                <PlusIcon />
              </Button.Prefix>
              New service
            </Button>
          }
        />
        <QueryState isLoading={isLoading} error={error} errorTitle="Couldn't load services" onRetry={() => void refresh()}>
          {data && (
            <Tabs selectedIndex={tab} onChange={(i) => setParams({ tab: TABS[i] }, { replace: true })}>
              <Tab title="Services">
                <Flex paddingTop={16} flexDirection="column">
                  <ServicesTab onNew={createNew} />
                </Flex>
              </Tab>
              <Tab title={`Routing rules (${data.rules.rules.length})`}>
                <Flex paddingTop={16} flexDirection="column">
                  <RulesTab />
                </Flex>
              </Tab>
              <Tab title="Test a rule">
                <Flex paddingTop={16} flexDirection="column">
                  <TestTab />
                </Flex>
              </Tab>
              <Tab title="Priority mapping">
                <Flex paddingTop={16} flexDirection="column">
                  <MappingTab />
                </Flex>
              </Tab>
            </Tabs>
          )}
        </QueryState>
      </Flex>
    </PageLayout.Content>
  );
};
