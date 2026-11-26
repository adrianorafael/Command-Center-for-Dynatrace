import { FieldHint } from "../../components/FieldHint";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Flex, Grid, PageLayout, Surface, Container } from "@dynatrace/strato-components/layouts";
import { Button } from "@dynatrace/strato-components/buttons";
import { Tabs, Tab } from "@dynatrace/strato-components/navigation";
import { Heading, Paragraph, Text, ExternalLink, Code, List, Strong } from "@dynatrace/strato-components/typography";
import { MessageContainer, ProgressCircle } from "@dynatrace/strato-components/content";
import { DataTable, SimpleTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import { FormField, Label, Switch, TextInput } from "@dynatrace/strato-components/forms";
import { Modal, Sheet, Tooltip } from "@dynatrace/strato-components/overlays";
import { showToast } from "@dynatrace/strato-components/notifications";
import { DownloadIcon, KeyIcon, PlayIcon, RefreshIcon, FlowIcon } from "@dynatrace/strato-icons";
import type { Timeseries } from "@dynatrace/strato-components/charts";
import type { ProviderConfig, Settings } from "../../domain/contracts";
import { useAppData, nextRev } from "../../hooks/AppDataContext";
import { exportWorkflowDefinition, getEngineStatus, runEngineNow, validateProvider, workflowsAppUrl, type EngineWorkflowStatus } from "../../hooks/domain";
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
    { id: "name", header: "Source", accessor: "name", width: 260 },
    {
      id: "status",
      header: "Status",
      accessor: "status",
      width: 150,
      cell: ({ rowData }) =>
        rowData.status === "receiving" ? (
          <Health status="ideal">Receiving</Health>
        ) : rowData.status === "quiet" ? (
          <Health status="warning">Quiet &gt; 1 h</Health>
        ) : rowData.status === "disabled" ? (
          <Health status="neutral">Turned off</Health>
        ) : (
          <Health status="neutral">Never seen</Health>
        ),
    },
    {
      id: "last",
      header: "Last event",
      accessor: (r) => r.last ?? 0,
      sortType: "number",
      width: 140,
      cell: ({ rowData }) => (
        <Tooltip text={rowData.last ? formatDateTime(rowData.last) : "No event yet"}>
          <Text>{rowData.last ? formatRelative(rowData.last, now) : "–"}</Text>
        </Tooltip>
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
            <Strong>2. Custom events</Strong> from any tool are sent to the Dynatrace Events API and read from Grail by the engine.
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
        <DataTable data={rows} columns={columns} rowId={(r) => r.id} fullWidth variant={{ rowDensity: "condensed" }}>
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
          Create an access token with the <Code>{TOKEN_SCOPE}</Code> scope and post the event to your environment. Replace{" "}
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
    { key: "messagingServiceSid", label: "Messaging service SID (optional)" },
    { key: "voice", label: "Voice (voice calls, optional)" },
    { key: "language", label: "Voice language (optional)", hint: "For example en-US" },
  ],
  ifttt: [{ key: "eventName", label: "Event name", hint: "Letters, digits, - and _" }],
  "slack-webhook": [],
  "teams-webhook": [],
  "telegram-bot": [{ key: "parseMode", label: "Parse mode", hint: "HTML or MarkdownV2" }],
  webhook: [{ key: "authHeader", label: "Auth header name (optional)", hint: "The value comes from a username/password vault entry" }],
};

const VAULT_HINT: Record<ProviderConfig["kind"], string> = {
  twilio: "Username/password entry: Account SID (or API key SID) and auth token",
  ifttt: "Token entry: your IFTTT Webhooks key",
  "slack-webhook": "Token entry: the full Slack incoming-webhook URL",
  "teams-webhook": "Token entry: the full Teams Workflows webhook URL",
  "telegram-bot": "Token entry: the bot token",
  webhook: "Token entry: the full https URL of your endpoint",
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
            placeholder="CREDENTIALS_VAULT-…"
          />
          <FieldHint>
            Paste the credential vault ID. {VAULT_HINT[draft.kind]}. Turn on "Allow access without app context" for the entry. The app never asks for,
            stores, or shows the secret itself.
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
        const text = exec ? `Workflow execution ${exec} started. Check the result in the Workflows app.` : "Test requested.";
        setResult({ ok: true, text });
        showToast({ type: "success", title: "Test notification requested", message: provider.name, lifespan: 5000 });
      })
      .catch((e) => {
        setResult({ ok: false, text: errorMessage(e) });
        showToast({ type: "critical", title: "Couldn't send the test notification", message: errorMessage(e), lifespan: "infinite" });
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

function newUuid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  const h = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const WorkflowsTab = () => {
  const { data, mutate, demo, now } = useAppData();
  const [status, setStatus] = useState<EngineWorkflowStatus>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [running, setRunning] = useState(false);
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

  const download = async () => {
    if (!settings) return;
    let s = settings;
    if (!/^[0-9a-f-]{36}$/i.test(s.engine.workflowId)) {
      s = nextRev({ ...s, engine: { ...s.engine, workflowId: newUuid() } });
      try {
        await mutate((st) => st.saveSettings(s), "Workflow id assigned");
      } catch {
        return;
      }
    }
    try {
      const { json, fileName } = exportWorkflowDefinition(s);
      const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      showToast({ type: "critical", title: "Couldn't build the workflow definition", message: errorMessage(e), lifespan: "infinite" });
    }
  };

  const runNow = () => {
    if (!settings) return;
    setRunning(true);
    runEngineNow(settings, "manual")
      .then(() => showToast({ type: "success", title: "Engine run started", lifespan: 4000 }))
      .catch((e) => showToast({ type: "critical", title: "Couldn't start the engine", message: errorMessage(e), lifespan: "infinite" }))
      .finally(() => {
        setRunning(false);
        load();
      });
  };

  const hb = data?.heartbeat;
  const foundId = status?.workflowId;
  const link = (foundId ?? settings?.engine.workflowId) ? workflowUrl(foundId ?? settings?.engine.workflowId ?? "") : workflowsAppUrl();
  const adoptId = () => {
    if (!settings || !foundId) return;
    void mutate((st) => st.saveSettings(nextRev({ ...settings, engine: { ...settings.engine, workflowId: foundId } })), "Workflow ID saved")
      .then(load)
      .catch(() => undefined);
  };
  const execs = status?.recentExecutions ?? [];

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
                <Health status="warning">Update available</Health>
              ) : (
                <Health status="ideal">Installed{status.definitionVersion ? ` (definition v${status.definitionVersion})` : ""}</Health>
              ))}
            <Text textStyle="small">
              Last run:{" "}
              {status?.lastExecution
                ? `${status.lastExecution.state} · ${status.lastExecution.startedAt ? formatRelative(status.lastExecution.startedAt, now) : ""}`
                : "none"}
            </Text>
            <Text textStyle="small">Engine heartbeat: {hb ? `${formatRelative(hb.lastTickAt, now)} (${hb.durationMs} ms)` : "none yet"}</Text>
            {hb?.lastError && <Text textStyle="small">Last error: {hb.lastError}</Text>}
            {foundId && <Text textStyle="small">Workflow ID: {foundId}</Text>}
            {status?.foundByTitle && foundId && foundId !== settings?.engine.workflowId && (
              <MessageContainer variant="warning">
                <MessageContainer.Title>Found the engine workflow under a different ID</MessageContainer.Title>
                <MessageContainer.Description>
                  The uploaded workflow got a new ID. Save it in Settings so "Escalate now" and test notifications run the right workflow.
                </MessageContainer.Description>
                <MessageContainer.Actions>
                  <Button onClick={adoptId}>Save this ID</Button>
                </MessageContainer.Actions>
              </MessageContainer>
            )}
            <Flex gap={8} flexWrap="wrap">
              <Button color="primary" variant="accent" onClick={() => void download()}>
                <Button.Prefix>
                  <DownloadIcon />
                </Button.Prefix>
                Download workflow JSON
              </Button>
              <Tooltip text={demo ? "Not available in demo mode" : !status?.installed ? "Upload the workflow first" : "Run one engine tick now"}>
                <Button disabled={demo || !status?.installed} loading={running} onClick={runNow}>
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
                Refresh status
              </Button>
            </Flex>
            {link && <ExternalLink href={link}>Open Workflows</ExternalLink>}
          </Flex>
        </Surface>
        <Surface padding={16}>
          <Flex flexDirection="column" gap={8}>
            <Heading level={3}>Set up the engine workflow</Heading>
            <List ordered>
              <Text>Download the workflow JSON.</Text>
              <Text>In the Workflows app, select Upload and choose the file.</Text>
              <Text>Set the actor to a service user, so edits by other people don't change who runs it.</Text>
              <Text>In Workflows → Settings → Authorization settings, grant the actor the app-engine and app-state permissions the workflow needs.</Text>
              <Text>Add the provider hosts below to Settings → External requests, and allow vault entries to be used without app context.</Text>
              <Text>Come back here and select Refresh status.</Text>
            </List>
            <Text textStyle="small">
              The app can read and run the workflow but can't create or change it: third-party apps don't get the workflow write permission.
            </Text>
          </Flex>
        </Surface>
      </Grid>
      <Flex flexDirection="column" gap={8}>
        <Heading level={3}>Recent executions</Heading>
        <DataTable
          data={execs}
          rowId={(e) => e.id}
          fullWidth
          variant={{ rowDensity: "condensed" }}
          columns={[
            { id: "id", header: "Execution", accessor: "id", width: 280 },
            {
              id: "state",
              header: "State",
              accessor: "state",
              width: 140,
              cell: ({ rowData }) => (
                <Health status={rowData.state === "SUCCESS" ? "ideal" : rowData.state === "RUNNING" ? "good" : rowData.state === "ERROR" ? "critical" : "neutral"}>
                  {rowData.state}
                </Health>
              ),
            },
            { id: "trigger", header: "Trigger", accessor: (e) => e.triggerType ?? "–", width: 140 },
            {
              id: "started",
              header: "Started",
              accessor: (e) => e.startedAt ?? 0,
              width: "1fr",
              cell: ({ rowData }) => <Text>{rowData.startedAt ? formatDateTime(rowData.startedAt) : "–"}</Text>,
            },
          ]}
        >
          <DataTable.EmptyState>
            <Text>No executions yet. Upload the workflow to start paging.</Text>
          </DataTable.EmptyState>
        </DataTable>
      </Flex>
      <Flex flexDirection="column" gap={8}>
        <Heading level={3}>External requests allowlist</Heading>
        <SimpleTable
          data={HOSTS}
          columns={[
            { id: "host", header: "Host", accessor: "host", width: 320 },
            { id: "use", header: "Needed for", accessor: "use", width: 560 },
          ]}
        />
      </Flex>
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
