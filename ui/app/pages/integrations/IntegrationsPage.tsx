import { FieldHint } from "../../components/FieldHint";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Flex, Grid, PageLayout, Surface, Container } from "@dynatrace/strato-components/layouts";
import { Button } from "@dynatrace/strato-components/buttons";
import { Tabs, Tab } from "@dynatrace/strato-components/navigation";
import { Heading, Paragraph, Text, ExternalLink, Code, List, Strong } from "@dynatrace/strato-components/typography";
import { MessageContainer, ProgressCircle } from "@dynatrace/strato-components/content";
import { DataTable, SimpleTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import { FormField, Label, Select, Switch, TextInput } from "@dynatrace/strato-components/forms";
import { Modal, Sheet, Tooltip } from "@dynatrace/strato-components/overlays";
import { notify } from "../../hooks/notifications";
import { DownloadIcon, KeyIcon, PlayIcon, RefreshIcon, FlowIcon } from "@dynatrace/strato-icons";
import type { Timeseries } from "@dynatrace/strato-components/charts";
import type { ProviderConfig, Settings } from "../../domain/contracts";
import { useAppData, nextRev } from "../../hooks/AppDataContext";
import { exportWorkflowDefinition, getEngineStatus, openEngineInstallIntent, runEngineNow, validateProvider, workflowsAppUrl, type EngineWorkflowStatus } from "../../hooks/domain";
import { Cell, CellText, LIST_TABLE_VARIANT } from "../../components/tableKit";
import { PageTitle } from "../../components/PageTitle";
import { Health } from "../../components/StatusIndicator";
import { ChannelIcon, CHANNEL_LABEL } from "../../components/ChannelIcon";
import { SendEventSnippets } from "../../components/CopyCode";
import { EVENT_FIELDS, TOKEN_SCOPE } from "../../components/snippets";
import { ErrorMessage } from "../../components/QueryState";
import { errorMessage, formatDateTime, formatRelative } from "../../components/format";
import { SOURCE_LABEL } from "../console/filters";
import { workflowUrl } from "../console/links";

const TABS = ["inbound", "outbound", "workflows"] as const;
const HOUR = 3_600_000;

// ─── Inbound ────────────────────────────────────────────────────────────────

interface SourceRow {
  id: string;
  name: string;
  status: "receiving" | "quiet" | "never" | "disabled";
  last?: number;
  count24: number;
  spark: Timeseries;
}

const InboundTab = () => {
  const { data, now } = useAppData();
  const navigate = useNavigate();
  const rows = useMemo<SourceRow[]>(() => {
    if (!data) return [];
    const src = data.settings.sources;
    const enabled: Record<string, boolean> = {
      "davis-problem": src.davisProblems.enabled,
      "davis-event": src.davisEvents.enabled,
      "generic-event": src.genericEvents.enabled,
    };
    return Object.keys(SOURCE_LABEL).map((id) => {
      const incs = data.incidents.filter((i) => i.alert.source === id);
      const last = incs.reduce((m, i) => Math.max(m, i.alert.startedAt, i.lastSeenAt), 0) || undefined;
      const start = Math.floor(now / HOUR) * HOUR - 23 * HOUR;
      const buckets = Array.from({ length: 24 }, () => 0);
      incs.forEach((i) => {
        const k = Math.floor((i.createdAt - start) / HOUR);
        if (k >= 0 && k < 24) buckets[k]++;
      });
      const status: SourceRow["status"] = !enabled[id] ? "disabled" : !last ? "never" : now - last > HOUR ? "quiet" : "receiving";
      return {
        id,
        name: id === "generic-event" ? `Events API: ${src.genericEvents.eventType}` : SOURCE_LABEL[id],
        status,
        last,
        count24: buckets.reduce((a, b) => a + b, 0),
        spark: { name: "Incidents", datapoints: buckets.map((v, k) => ({ start: new Date(start + k * HOUR), end: new Date(start + (k + 1) * HOUR), value: v })) },
      };
    });
  }, [data, now]);
  const columns: DataTableColumnDef<SourceRow>[] = [
    { id: "name", header: "Source", accessor: "name", width: 260, cell: ({ rowData }) => <CellText>{rowData.name}</CellText> },
    {
      id: "status",
      header: "Status",
      accessor: "status",
      width: 150,
      cell: ({ rowData }) => (
        <Cell>
        {rowData.status === "receiving" ? (
          <Health status="ideal">Receiving</Health>
        ) : rowData.status === "quiet" ? (
          <Health status="warning">Quiet &gt; 1 h</Health>
        ) : rowData.status === "disabled" ? (
          <Health status="neutral">Turned off</Health>
        ) : (
          <Health status="neutral">Never seen</Health>
        )}
        </Cell>
      ),
    },
    {
      id: "last",
      header: "Last event",
      accessor: (r) => r.last ?? 0,
      sortType: "number",
      width: 140,
      cell: ({ rowData }) => (
        <Cell>
          <Tooltip text={rowData.last ? formatDateTime(rowData.last) : "No event yet"}>
            <Text>{rowData.last ? formatRelative(rowData.last, now) : "–"}</Text>
          </Tooltip>
        </Cell>
      ),
    },
    { id: "spark", header: "Incidents last 24 h", accessor: "spark", columnType: "sparkline", width: 200, config: { variant: "bar" } },
    { id: "count", header: "Created 24 h", accessor: "count24", width: 120, sortType: "number" },
  ];
  const nothing = rows.every((r) => r.count24 === 0);
  return (
    <Flex flexDirection="column" gap={24}>
      <Container color="neutral" padding={16}>
        <Flex flexDirection="column" gap={8}>
          <Paragraph>
            <Strong>1. Davis problems</Strong> are picked up automatically from Grail. No setup is needed.
          </Paragraph>
          <Paragraph>
            <Strong>2. Custom events</Strong> from any tool are sent to the Dynatrace Events API v2. They open Davis problems, which the engine reads from Grail.
          </Paragraph>
          <Paragraph>
            <Strong>3. Routing rules</Strong> in Services decide the team, escalation policy and priority of every incident.
          </Paragraph>
        </Flex>
      </Container>
      {nothing && (
        <MessageContainer variant="warning">
          <MessageContainer.Title>No events received in the last 24 hours</MessageContainer.Title>
          <MessageContainer.Description>Check that the sources are turned on in Settings and that your tools send events.</MessageContainer.Description>
        </MessageContainer>
      )}
      <Flex flexDirection="column" gap={8}>
        <Heading level={3}>Sources</Heading>
        <DataTable data={rows} columns={columns} rowId={(r) => r.id} fullWidth variant={LIST_TABLE_VARIANT}>
          <DataTable.RowActions>
            {(row) => (
              <Button size="condensed" onClick={() => navigate(`/?status=triggered,acknowledged,snoozed,resolved&source=${(row as SourceRow).id}`)}>
                Show events
              </Button>
            )}
          </DataTable.RowActions>
        </DataTable>
      </Flex>
      <Flex flexDirection="column" gap={8}>
        <Heading level={3}>Send an event</Heading>
        <Paragraph>
          Create a platform token with the <Code>{TOKEN_SCOPE}</Code> permission and post the event to your environment: it becomes a Davis event that opens a Davis problem, and the cc.* properties travel with it for routing. Replace{" "}
          <Code>YOUR-ENVIRONMENT</Code> and <Code>&lt;TOKEN&gt;</Code>. Store the token in your tool's secret store, never in scripts.
        </Paragraph>
        <SendEventSnippets />
      </Flex>
      <Flex flexDirection="column" gap={8}>
        <Heading level={3}>Fields the app reads</Heading>
        <SimpleTable
          data={EVENT_FIELDS}
          columns={[
            { id: "field", header: "Event property", accessor: "field", width: 260 },
            { id: "usedFor", header: "Used for", accessor: "usedFor", width: 560 },
          ]}
        />
      </Flex>
    </Flex>
  );
};

// ─── Outbound ───────────────────────────────────────────────────────────────

const PARAMS: Record<ProviderConfig["kind"], { key: string; label: string; hint?: string }[]> = {
  twilio: [
    { key: "from", label: "Sender number", hint: "E.164, for example +15550100000 (WhatsApp: the approved sender)" },
    { key: "accountSid", label: "Account SID (only with an API key)", hint: "AC…; needed when the vault entry holds an API key SID (SK…) instead of the Account SID" },
    { key: "messagingServiceSid", label: "Messaging service SID (optional, SMS)" },
    { key: "voice", label: "Voice (voice calls, optional)" },
    { key: "language", label: "Voice language (optional)", hint: "For example en-US" },
  ],
  ifttt: [{ key: "eventName", label: "Event name", hint: "Letters, digits, - and _" }],
  "slack-webhook": [],
  "teams-webhook": [],
  "telegram-bot": [],
  webhook: [{ key: "authHeader", label: "Auth header name (optional)", hint: "Then use a username/password vault entry: username = endpoint URL, password = header value" }],
};

const VAULT_HINT: Record<ProviderConfig["kind"], string> = {
  twilio: "Username/password entry: Account SID (or API key SID) and auth token",
  ifttt: "Token entry: your IFTTT Webhooks key",
  "slack-webhook": "Token entry: the full Slack incoming-webhook URL",
  "teams-webhook": "Token entry: the full Teams Workflows webhook URL",
  "telegram-bot": "Token entry: the bot token",
  webhook: "Token entry: the full https URL of your endpoint (or username/password: URL + auth header value)",
};

const ProviderSheet = ({ provider, onClose }: { provider?: ProviderConfig; onClose: () => void }) => {
  const { data, mutate } = useAppData();
  const [draft, setDraft] = useState<ProviderConfig>();
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(provider), [provider]);
  if (!draft || !data) return null;
  const errors = validateProvider(draft);
  const save = () => {
    if (errors.length) return;
    setBusy(true);
    const settings: Settings = nextRev({ ...data.settings, providers: data.settings.providers.map((p) => (p.id === draft.id ? draft : p)) });
    mutate((s) => s.saveSettings(settings), `${draft.name} saved`)
      .then(onClose)
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };
  const err = (path: string) => errors.find((e) => e.path === path)?.message;
  return (
    <Sheet
      title={`Configure ${draft.name}`}
      show={!!provider}
      onDismiss={onClose}
      actions={
        <Flex gap={8}>
          <Button onClick={onClose}>Cancel</Button>
          <Button color="primary" variant="accent" loading={busy} disabled={errors.length > 0} onClick={save}>
            Save
          </Button>
        </Flex>
      }
    >
      <Flex flexDirection="column" gap={16} style={{ maxWidth: 520 }}>
        <Switch value={draft.enabled} onChange={(v) => setDraft({ ...draft, enabled: v })}>
          Enabled
        </Switch>
        <FormField required={draft.enabled}>
          <Label>Credential ID</Label>
          <TextInput
            value={draft.credentialVaultId ?? ""}
            onChange={(v) => setDraft({ ...draft, credentialVaultId: v.trim() || undefined })}
            placeholder="CREDENTIAL_VAULT_ENTRY-…"
          />
          <FieldHint>
            Paste the credential vault ID. {VAULT_HINT[draft.kind]}. Create the entry with scope AppEngine, owned by the workflow actor, with "Owner
            access only" and "Allow access without app context" both on. The app never asks for, stores, or shows the secret itself.
          </FieldHint>
          {err("credentialVaultId") && <Text>{err("credentialVaultId")}</Text>}
        </FormField>
        {PARAMS[draft.kind].map((p) => (
          <FormField key={p.key}>
            <Label>{p.label}</Label>
            <TextInput value={draft.params[p.key] ?? ""} onChange={(v) => setDraft({ ...draft, params: { ...draft.params, [p.key]: v } })} />
            {p.hint && <FieldHint>{p.hint}</FieldHint>}
            {err(`params.${p.key}`) && <Text>{err(`params.${p.key}`)}</Text>}
          </FormField>
        ))}
        <Flex alignItems="center" gap={4}>
          <KeyIcon />
          <ExternalLink href="https://docs.dynatrace.com/docs/manage/credential-vault">Manage credentials in the credential vault</ExternalLink>
        </Flex>
      </Flex>
    </Sheet>
  );
};

const TestModal = ({ provider, onClose }: { provider?: ProviderConfig; onClose: () => void }) => {
  const { data } = useAppData();
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string }>();
  useEffect(() => {
    setAddress("");
    setResult(undefined);
  }, [provider]);
  if (!provider || !data) return null;
  const send = () => {
    setBusy(true);
    runEngineNow(data.settings, "test", { providerId: provider.id, channel: provider.channel, address: address.trim() })
      .then((exec) => {
        const ok = !!exec && exec.sent > 0;
        const text = !exec
          ? "Test requested."
          : ok
            ? `Sent through ${provider.name}. Check the destination.`
            : `Not sent: ${exec.errors[0] ?? (exec.failed ? "the provider rejected the message" : "nothing was sent")}`;
        setResult({ ok, text });
        notify({ category: ok ? "action" : "error", type: ok ? "success" : "warning", title: ok ? "Test notification sent" : "Test notification not sent", message: text, lifespan: 6000 });
      })
      .catch((e) => {
        setResult({ ok: false, text: errorMessage(e) });
        notify({ category: "error", type: "critical", title: "Couldn't send the test notification", message: errorMessage(e), lifespan: "infinite" });
      })
      .finally(() => setBusy(false));
  };
  return (
    <Modal
      title="Send test notification"
      show
      onDismiss={onClose}
      footer={
        <Flex justifyContent="flex-end" gap={8}>
          <Button onClick={onClose}>Close</Button>
          <Button color="primary" variant="accent" loading={busy} disabled={!address.trim()} onClick={send}>
            Send test
          </Button>
        </Flex>
      }
    >
      <Flex flexDirection="column" gap={16}>
        <Text>
          Sends one synthetic message through {provider.name} via the engine workflow ({CHANNEL_LABEL[provider.channel]}).
        </Text>
        <FormField required>
          <Label>Recipient</Label>
          <TextInput value={address} onChange={setAddress} placeholder={provider.kind === "twilio" ? "+15550100000" : "Chat ID or routing key"} />
        </FormField>
        {result && <Health status={result.ok ? "good" : "critical"}>{result.text}</Health>}
      </Flex>
    </Modal>
  );
};

const OutboundTab = () => {
  const { data, demo } = useAppData();
  const [configure, setConfigure] = useState<ProviderConfig>();
  const [test, setTest] = useState<ProviderConfig>();
  const ledger = data?.notifications ?? [];
  return (
    <Flex flexDirection="column" gap={16}>
      <Paragraph>
        Notifications leave Dynatrace only through the engine workflow. Each provider references a Credential Vault entry; Twilio (SMS, voice,
        WhatsApp) and IFTTT are the defaults, the generic webhook covers any other tool.
      </Paragraph>
      <Grid gridTemplateColumns="repeat(auto-fill, minmax(320px, 1fr))" gap={12}>
        {(data?.settings.providers ?? []).map((p) => {
          const mine = ledger.filter((n) => n.providerId === p.id);
          const last = [...mine].sort((a, b) => (b.reportedAt ?? b.plannedAt) - (a.reportedAt ?? a.plannedAt))[0];
          const failed = last && (last.status === "failed" || last.status === "timeout");
          return (
            <Surface key={p.id} padding={16}>
              <Flex flexDirection="column" gap={12}>
                <Flex alignItems="center" gap={8}>
                  <ChannelIcon channel={p.channel} />
                  <Heading level={3}>{p.name}</Heading>
                </Flex>
                {!p.enabled || !p.credentialVaultId ? (
                  <Health status="neutral">Not configured</Health>
                ) : failed ? (
                  <Health status="critical">Last delivery failed</Health>
                ) : (
                  <Health status="ideal">Configured</Health>
                )}
                <Text textStyle="small">
                  {last
                    ? `${mine.filter((n) => n.status === "sent").length} delivered, ${mine.filter((n) => n.status === "failed").length} failed · last ${formatRelative(last.reportedAt ?? last.plannedAt, Date.now())}`
                    : "No notifications sent yet"}
                </Text>
                {failed && last?.error && <Text textStyle="small">{last.error}</Text>}
                <Flex gap={8}>
                  <Button onClick={() => setConfigure(p)}>Configure</Button>
                  <Tooltip text={demo ? "Not available in demo mode" : !p.enabled ? "Enable the provider first" : "Send a test notification"}>
                    <Button disabled={demo || !p.enabled} onClick={() => setTest(p)}>
                      <Button.Prefix>
                        <PlayIcon />
                      </Button.Prefix>
                      Send test
                    </Button>
                  </Tooltip>
                </Flex>
              </Flex>
            </Surface>
          );
        })}
      </Grid>
      <ProviderSheet provider={configure} onClose={() => setConfigure(undefined)} />
      <TestModal provider={test} onClose={() => setTest(undefined)} />
    </Flex>
  );
};

// ─── Workflows ──────────────────────────────────────────────────────────────

const HOSTS = [
  { host: "api.twilio.com", use: "Twilio SMS, voice, WhatsApp" },
  { host: "maker.ifttt.com", use: "IFTTT Webhooks" },
  { host: "hooks.slack.com", use: "Slack incoming webhooks" },
  { host: "api.telegram.org", use: "Telegram bot" },
  { host: "Your Teams Workflows webhook host", use: "Microsoft Teams (copy the host from the webhook URL)" },
  { host: "Your webhook host", use: "Generic webhook" },
];


const WorkflowsTab = () => {
  const { data, mutate, demo, now } = useAppData();
  const [status, setStatus] = useState<EngineWorkflowStatus>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [running, setRunning] = useState(false);
  const [interval, setIntervalMin] = useState<string>("1");
  const settings = data?.settings;

  const load = useCallback(() => {
    if (!settings) return;
    setLoading(true);
    getEngineStatus(settings)
      .then((s) => {
        setStatus(s);
        setError(undefined);
      })
      .catch((e) => setError(e))
      .finally(() => setLoading(false));
  }, [settings]);
  useEffect(() => load(), [load]);

  const install = () => {
    if (!settings) return;
    openEngineInstallIntent(settings, Number(interval));
  };

  const download = () => {
    if (!settings) return;
    try {
      const { json, fileName } = exportWorkflowDefinition(settings);
      const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      notify({ category: "error", type: "critical", title: "Couldn't build the workflow definition", message: errorMessage(e), lifespan: "infinite" });
    }
  };

  const runNow = () => {
    if (!settings) return;
    setRunning(true);
    runEngineNow(settings, "manual")
      .then((r) =>
        notify({
          category: "action",
          type: r && !r.ok ? "warning" : "success",
          title: r?.skipped === "locked" ? "Engine is already running" : "Engine cycle finished",
          message: r ? `${r.sent} sent · ${r.failed} failed${r.deferred ? ` · ${r.deferred} deferred` : ""}${r.errors.length ? ` · ${r.errors[0]}` : ""}` : undefined,
          lifespan: 6000,
        }),
      )
      .catch((e) => notify({ category: "error", type: "critical", title: "Couldn't run the engine", message: errorMessage(e), lifespan: "infinite" }))
      .finally(() => {
        setRunning(false);
        load();
      });
  };

  const hb = data?.heartbeat;
  const foundId = status?.workflowId;
  const link = foundId ? workflowUrl(foundId) : workflowsAppUrl();
  const adoptId = () => {
    if (!settings || !foundId) return;
    void mutate((st) => st.saveSettings(nextRev({ ...settings, engine: { ...settings.engine, workflowId: foundId } })), "Workflow ID saved")
      .then(load)
      .catch(() => undefined);
  };
  const stale = !hb || now - hb.lastTickAt > 3 * 60_000;

  return (
    <Flex flexDirection="column" gap={16}>
      {error ? <ErrorMessage title="Couldn't read the workflow status" error={error} onRetry={load} /> : null}
      <Grid gridTemplateColumns="repeat(auto-fit, minmax(320px, 1fr))" gap={12}>
        <Surface padding={16}>
          <Flex flexDirection="column" gap={12}>
            <Flex alignItems="center" gap={8} justifyContent="space-between">
              <Flex alignItems="center" gap={8}>
                <FlowIcon />
                <Heading level={3}>Command Center · Engine</Heading>
              </Flex>
              {loading && <ProgressCircle size="small" aria-label="Loading status" />}
            </Flex>
            {status &&
              (!status.installed ? (
                <Health status="neutral">Not installed</Health>
              ) : status.outdated ? (
                <Health status="warning">{status.usesAction ? "Update available" : "Old engine (standard workflow): reinstall to stop workflow-hour cost"}</Health>
              ) : status.type && status.type !== "SIMPLE" ? (
                <Health status="warning">Installed as a standard workflow: it consumes workflow hours. Replace it with the JSON upload or the admin script (see the steps)</Health>
              ) : (
                <Health status="ideal">Installed · {status.type === "SIMPLE" ? "simple workflow (no workflow hours)" : status.type ?? "workflow"}</Health>
              ))}
            <Health status={stale ? "warning" : "ideal"}>
              {hb ? `Last engine run ${formatRelative(hb.lastTickAt, now)} (${hb.durationMs} ms)` : "The engine has not run yet"}
            </Health>
            {hb && (
              <Text textStyle="small">
                Last run: {hb.counts.alertsFetched} alerts read · {hb.counts.incidentsCreated} incidents created · {hb.counts.notificationsPlanned} notifications planned
              </Text>
            )}
            {hb?.lastError && <Text textStyle="small">Last error: {hb.lastError}</Text>}
            {foundId && <Text textStyle="small">Workflow ID: {foundId}</Text>}
            {status?.foundByTitle && foundId && foundId !== settings?.engine.workflowId && (
              <MessageContainer variant="primary">
                <MessageContainer.Title>Engine workflow found</MessageContainer.Title>
                <MessageContainer.Description>Save its ID so this page always links to it.</MessageContainer.Description>
                <MessageContainer.Actions>
                  <Button onClick={adoptId}>Save this ID</Button>
                </MessageContainer.Actions>
              </MessageContainer>
            )}
            <Flex gap={8} flexWrap="wrap" alignItems="flex-end">
              <FormField>
                <Label>Run every</Label>
                <Select value={interval} onChange={(v) => setIntervalMin(v ?? "1")}>
                  <Select.Content>
                    <Select.Option value="1">1 minute</Select.Option>
                    <Select.Option value="2">2 minutes</Select.Option>
                    <Select.Option value="5">5 minutes</Select.Option>
                  </Select.Content>
                </Select>
              </FormField>
              <Tooltip text={demo ? "Not available in demo mode" : "Opens the Workflows app with the engine workflow filled in"}>
                <Button color="primary" variant="accent" disabled={demo} onClick={install}>
                  <Button.Prefix>
                    <FlowIcon />
                  </Button.Prefix>
                  {status?.installed ? "Reinstall in Workflows" : "Install in Workflows"}
                </Button>
              </Tooltip>
              <Button onClick={download}>
                <Button.Prefix>
                  <DownloadIcon />
                </Button.Prefix>
                Download JSON
              </Button>
              <Tooltip text={demo ? "Not available in demo mode" : "Runs one full engine cycle now (alerts, escalations, notifications)"}>
                <Button disabled={demo} loading={running} onClick={runNow}>
                  <Button.Prefix>
                    <PlayIcon />
                  </Button.Prefix>
                  Run engine now
                </Button>
              </Tooltip>
              <Button onClick={load}>
                <Button.Prefix>
                  <RefreshIcon />
                </Button.Prefix>
                Refresh
              </Button>
            </Flex>
            {link && <ExternalLink href={link}>Open in Workflows</ExternalLink>}
          </Flex>
        </Surface>
        <Surface padding={16}>
          <Flex flexDirection="column" gap={8}>
            <Heading level={3}>Set up the engine</Heading>
            <List ordered>
              <Text>
                Choose how often the engine runs and select Install in Workflows. The Workflows app opens with the workflow filled in: review it and deploy it. If
                the status then says “standard workflow”, delete that workflow and upload the downloaded JSON in the Workflows app instead (it carries the type
                “simple”), or ask an admin to run scripts/install-workflow.mjs.
              </Text>
              <Text>In Workflows → Settings → Authorization settings, enable the permissions for the workflow actor (the person who deploys it, or a service user).</Text>
              <Text>Add the provider hosts below to Settings → General → External requests.</Text>
              <Text>Store each provider secret in the Credential Vault (scope AppEngine, owned by the workflow actor) and enter its ID under Providers.</Text>
              <Text>Select Refresh: the status turns green and the engine heartbeat updates within one interval.</Text>
            </List>
            <Text textStyle="small">
              The engine is a simple workflow with one task, this app's “Run Command Center engine” action, so it consumes no workflow hours. Each run is one
              function invocation (about 43,200 a month at 1 minute, 21,600 at 2 minutes, 8,640 at 5 minutes) plus its Grail queries. Escalation steps fire on
              the first run after they are due, so the interval is the timing precision.
            </Text>
            <SimpleTable
              data={HOSTS}
              columns={[
                { id: "host", header: "Allow host", accessor: "host" },
                { id: "use", header: "Used by", accessor: "use" },
              ]}
            />
            <Text textStyle="small">The app cannot create workflows on its own (Dynatrace reserves that permission for its own apps), so you confirm the workflow in the Workflows app once.</Text>
          </Flex>
        </Surface>
      </Grid>
    </Flex>
  );
};

export const IntegrationsPage = () => {
  const [params, setParams] = useSearchParams();
  const tab = Math.max(0, TABS.indexOf((params.get("tab") ?? "inbound") as (typeof TABS)[number]));
  return (
    <PageLayout.Content>
      <Flex flexDirection="column" gap={16} padding={16}>
        <PageTitle title="Integrations" subtitle="Events come in through Dynatrace APIs. Notifications go out through Dynatrace Workflows." />
        <Tabs selectedIndex={tab} onChange={(i) => setParams({ tab: TABS[i] }, { replace: true })}>
          <Tab title="Inbound">
            <Flex paddingTop={16} flexDirection="column">
              <InboundTab />
            </Flex>
          </Tab>
          <Tab title="Outbound">
            <Flex paddingTop={16} flexDirection="column">
              <OutboundTab />
            </Flex>
          </Tab>
          <Tab title="Workflows">
            <Flex paddingTop={16} flexDirection="column">
              <WorkflowsTab />
            </Flex>
          </Tab>
        </Tabs>
      </Flex>
    </PageLayout.Content>
  );
};
