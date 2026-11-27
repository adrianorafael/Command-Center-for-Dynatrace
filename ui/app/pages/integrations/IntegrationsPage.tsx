/**
 * Integrations (route `/integrations`): Inbound (how to send events), Outbound (notification providers, their
 * delivery choice and tests) and Workflows (engine workflow status and installation, external hosts to allow).
 */
import { FieldHint } from "../../components/FieldHint";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Flex, Grid, PageLayout, Surface, Container } from "@dynatrace/strato-components/layouts";
import { Button } from "@dynatrace/strato-components/buttons";
import { Tabs, Tab } from "@dynatrace/strato-components/navigation";
import { Heading, Paragraph, Text, ExternalLink, Code, List, Strong } from "@dynatrace/strato-components/typography";
import { MessageContainer, ProgressCircle } from "@dynatrace/strato-components/content";
import { DataTable, SimpleTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import { FormField, Label, Radio, RadioGroup, Select, Switch, TextInput } from "@dynatrace/strato-components/forms";
import { Modal, Sheet, Tooltip } from "@dynatrace/strato-components/overlays";
import { notify } from "../../hooks/notifications";
import { DownloadIcon, KeyIcon, PlayIcon, RefreshIcon, FlowIcon } from "@dynatrace/strato-icons";
import type { Timeseries } from "@dynatrace/strato-components/charts";
import { engineStaleAfterMs, type ProviderConfig, type Settings } from "../../domain/contracts";
import { EXTERNAL_REQUESTS_PATH, hostToAllow, isHostNotAllowed } from "../../domain/outboundHosts";
import { useAppData, nextRev } from "../../hooks/AppDataContext";
import { exportCustomWorkflowDefinition, exportProviderWorkflowDefinition, findCustomWorkflowIds, findProviderWorkflowIds, openCustomWorkflowInstall, openProviderWorkflowInstall, exportWorkflowDefinition, getEngineStatus, openEngineInstallIntent, runEngineNow, validateProvider, workflowsAppUrl, exportOnProblemWorkflowDefinition, getOnProblemWorkflowStatus, openOnProblemInstall, type EngineWorkflowStatus, type OnProblemWorkflowStatus } from "../../hooks/domain";
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
              // All statuses, last 24 h: the same window as the "incidents in 24 h" count next to it.
              <Button size="condensed" onClick={() => navigate(`/?status=&created=24h&source=${(row as SourceRow).id}`)}>
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
  workflow: [],
};

const VAULT_HINT: Record<ProviderConfig["kind"], string> = {
  twilio: "Username/password entry: Account SID (or API key SID) and auth token",
  ifttt: "Token entry: your IFTTT Webhooks key",
  "slack-webhook": "Token entry: the full Slack incoming-webhook URL",
  "teams-webhook": "Token entry: the full Teams Workflows webhook URL",
  "telegram-bot": "Token entry: the bot token",
  webhook: "Token entry: the full https URL of your endpoint (or username/password: URL + auth header value)",
  workflow: "",
};

/** True when a provider has what it needs to send (vault entry, or the custom workflow's id). */
function isConfigured(p: ProviderConfig): boolean {
  return p.kind === "workflow" ? !!p.params["workflowId"]?.trim() : !!p.credentialVaultId;
}

const download = (fileName: string, json: string) => {
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
};

/** Param that records the choice "send through its own workflow"; absent means the engine sends directly. */
const DELIVERY_PARAM = "delivery";
/** A built-in integration uses its own workflow only when the person chose that, or one is already linked. */
function wantsOwnWorkflow(p: ProviderConfig): boolean {
  return p.kind !== "workflow" && (p.params[DELIVERY_PARAM] === "workflow" || !!p.params["workflowId"]?.trim());
}

/**
 * Built-in provider: who sends its notifications. Default: the engine, in the run it is already doing (no extra
 * function call). Optional: a workflow of its own ("Command Center · <name>"), one more function call per notification.
 */
const DeliveryFields = ({ draft, setDraft, error }: { draft: ProviderConfig; setDraft: (p: ProviderConfig) => void; error?: string }) => {
  const { demo } = useAppData();
  const [found, setFound] = useState<{ id: string; type?: string }[]>();
  const [searching, setSearching] = useState(false);
  const wfId = draft.params["workflowId"] ?? "";
  const own = wantsOwnWorkflow(draft);
  const setMode = (mode: string) => {
    if (mode === "workflow") return setDraft({ ...draft, params: { ...draft.params, [DELIVERY_PARAM]: "workflow" } });
    // Back to the engine: forget the choice and the link (the workflow itself stays in the Workflows app).
    setDraft({ ...draft, params: Object.fromEntries(Object.entries(draft.params).filter(([k]) => k !== "workflowId" && k !== DELIVERY_PARAM)) });
  };
  const search = () => {
    setSearching(true);
    findProviderWorkflowIds(draft.name)
      .then(setFound)
      .catch((e) => notify({ category: "error", type: "critical", title: "Couldn't list workflows", message: errorMessage(e), lifespan: 8000 }))
      .finally(() => setSearching(false));
  };
  const chosen = found?.find((f) => f.id === wfId.trim());
  return (
    <Flex flexDirection="column" gap={12}>
      <Heading level={4}>Delivery</Heading>
      <RadioGroup value={own ? "workflow" : "engine"} onChange={setMode}>
        <Radio value="engine">By the engine (default): no extra cost</Radio>
        <Radio value="workflow">Through its own workflow: one more function call per notification</Radio>
      </RadioGroup>
      {!own && <Text textStyle="small">The engine sends {draft.name} notifications in the run it is already doing. Nothing to create in the Workflows app.</Text>}
      {own && (
      <>
      <Paragraph>
        {wfId.trim()
          ? `Each ${draft.name} notification is one run of the workflow “Command Center · ${draft.name}”, visible in the Workflows app. If it can't be run, the engine sends directly.`
          : `Create the workflow “Command Center · ${draft.name}” and save this integration: Command Center links the workflow when it finds it. Until then the engine sends directly.`}
      </Paragraph>
      <Flex gap={8} flexWrap="wrap">
        <Tooltip text={demo ? "Not available in demo mode" : "Opens the Workflows app with this integration's workflow filled in"}>
          <Button disabled={demo} onClick={() => openProviderWorkflowInstall(draft)}>
            <Button.Prefix>
              <FlowIcon />
            </Button.Prefix>
            Create its workflow
          </Button>
        </Tooltip>
        <Button
          onClick={() => {
            const { fileName, json } = exportProviderWorkflowDefinition(draft);
            download(fileName, json);
          }}
        >
          <Button.Prefix>
            <DownloadIcon />
          </Button.Prefix>
          Download JSON
        </Button>
        <Button disabled={demo} loading={searching} onClick={search}>
          <Button.Prefix>
            <RefreshIcon />
          </Button.Prefix>
          Find its workflow
        </Button>
      </Flex>
      {found && found.length === 0 && <Text textStyle="small">No workflow named “Command Center · {draft.name}” was found. Create it first.</Text>}
      {found?.map((f) => (
        <Flex key={f.id} gap={8} alignItems="center">
          <Text textStyle="small">
            {f.id} · {f.type === "SIMPLE" ? "simple workflow" : f.type === "STANDARD" ? "standard workflow (consumes workflow hours)" : "workflow"}
          </Text>
          <Button size="condensed" onClick={() => setDraft({ ...draft, params: { ...draft.params, workflowId: f.id } })}>
            Use
          </Button>
        </Flex>
      ))}
      {chosen?.type === "STANDARD" && (
        <MessageContainer variant="warning">
          <MessageContainer.Description>
            This is a standard workflow and consumes workflow hours. Upload the downloaded JSON instead (a simple workflow) and use that one.
          </MessageContainer.Description>
        </MessageContainer>
      )}
      <FormField>
        <Label>Workflow ID</Label>
        <TextInput value={wfId} onChange={(v) => setDraft({ ...draft, params: { ...draft.params, workflowId: v.trim() } })} placeholder="Linked automatically when found" />
        <FieldHint>To stop using the workflow, choose “By the engine” above; delete the workflow in the Workflows app if you no longer need it.</FieldHint>
        {error && <Text>{error}</Text>}
      </FormField>
      </>
      )}
    </Flex>
  );
};

/** Custom workflow provider: create the prefilled example workflow, then pick its id. */
const CustomWorkflowFields = ({ draft, setDraft, error }: { draft: ProviderConfig; setDraft: (p: ProviderConfig) => void; error?: string }) => {
  const { demo } = useAppData();
  const [found, setFound] = useState<{ id: string; type?: string }[]>();
  const [searching, setSearching] = useState(false);
  const wfId = draft.params["workflowId"] ?? "";
  const search = () => {
    setSearching(true);
    findCustomWorkflowIds()
      .then(setFound)
      .catch((e) => notify({ category: "error", type: "critical", title: "Couldn't list workflows", message: errorMessage(e), lifespan: 8000 }))
      .finally(() => setSearching(false));
  };
  const chosen = found?.find((f) => f.id === wfId.trim());
  return (
    <Flex flexDirection="column" gap={12}>
      <Paragraph>
        Command Center runs a workflow you own once per notification and passes the notification to it. Start from the example: one HTTP request task
        that forwards the notification as JSON to an example URL. Replace the URL and headers, or replace the task with any action (email, ITSM, chat…).
      </Paragraph>
      <List ordered>
        <Text>Select Create example workflow (or Download example JSON and upload it in the Workflows app), adjust it and save it.</Text>
        <Text>Select Find my workflow and choose it, or paste its ID from the Workflows app URL.</Text>
        <Text>Add your endpoint's host to Settings → General → Environment management → External requests, turn the provider on and send a test.</Text>
      </List>
      <Flex gap={8} flexWrap="wrap">
        <Tooltip text={demo ? "Not available in demo mode" : "Opens the Workflows app with the example workflow filled in"}>
          <Button disabled={demo} onClick={openCustomWorkflowInstall}>
            <Button.Prefix>
              <FlowIcon />
            </Button.Prefix>
            Create example workflow
          </Button>
        </Tooltip>
        <Button
          onClick={() => {
            const { fileName, json } = exportCustomWorkflowDefinition();
            download(fileName, json);
          }}
        >
          <Button.Prefix>
            <DownloadIcon />
          </Button.Prefix>
          Download example JSON
        </Button>
        <Button disabled={demo} loading={searching} onClick={search}>
          <Button.Prefix>
            <RefreshIcon />
          </Button.Prefix>
          Find my workflow
        </Button>
      </Flex>
      {found && found.length === 0 && <Text textStyle="small">No workflow named “Command Center · Custom integration” was found. Create it first.</Text>}
      {found &&
        found.map((f) => (
          <Flex key={f.id} gap={8} alignItems="center">
            <Text textStyle="small">
              {f.id} · {f.type === "SIMPLE" ? "simple workflow" : f.type === "STANDARD" ? "standard workflow (consumes workflow hours)" : "workflow"}
            </Text>
            <Button size="condensed" onClick={() => setDraft({ ...draft, params: { ...draft.params, workflowId: f.id } })}>
              Use
            </Button>
          </Flex>
        ))}
      {chosen?.type === "STANDARD" && (
        <MessageContainer variant="warning">
          <MessageContainer.Description>
            This workflow is a standard workflow and consumes workflow hours. Upload the example JSON instead (it is a simple workflow) and use that one.
          </MessageContainer.Description>
        </MessageContainer>
      )}
      <FormField required={draft.enabled}>
        <Label>Workflow ID</Label>
        <TextInput value={wfId} onChange={(v) => setDraft({ ...draft, params: { ...draft.params, workflowId: v.trim() } })} placeholder="00000000-0000-0000-0000-000000000000" />
        <FieldHint>The workflow runs as its own actor: it needs the permissions its task uses. Each notification is one workflow run.</FieldHint>
        {error && <Text>{error}</Text>}
      </FormField>
    </Flex>
  );
};

const ProviderSheet = ({ provider, onClose }: { provider?: ProviderConfig; onClose: () => void }) => {
  const { data, mutate } = useAppData();
  const [draft, setDraft] = useState<ProviderConfig>();
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(provider), [provider]);
  if (!draft || !data) return null;
  const others = data.settings.providers.filter((p) => p.id !== draft.id && p.enabled && p.channel === draft.channel);
  const errors = [
    ...validateProvider(draft),
    ...(draft.enabled && others[0] ? [{ path: "enabled", message: `Only one provider per channel can be on: turn off ${others[0].name} first` }] : []),
  ];
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
        {draft.kind === "workflow" ? (
          <CustomWorkflowFields draft={draft} setDraft={setDraft} error={err("params.workflowId")} />
        ) : (
        <FormField required={draft.enabled}>
          <Label>Credential ID</Label>
          <TextInput
            value={draft.credentialVaultId ?? ""}
            onChange={(v) => setDraft({ ...draft, credentialVaultId: v.trim() || undefined })}
            placeholder="CREDENTIAL_VAULT_ENTRY-…"
          />
          <FieldHint>
            Paste the credential vault ID. {VAULT_HINT[draft.kind]}. Create the entry with scope AppEngine, owned by the engine workflow's actor. The app
            never asks for, stores, or shows the secret itself.
          </FieldHint>
          {err("credentialVaultId") && <Text>{err("credentialVaultId")}</Text>}
        </FormField>
        )}
        {PARAMS[draft.kind].map((p) => (
          <FormField key={p.key}>
            <Label>{p.label}</Label>
            <TextInput value={draft.params[p.key] ?? ""} onChange={(v) => setDraft({ ...draft, params: { ...draft.params, [p.key]: v } })} />
            {p.hint && <FieldHint>{p.hint}</FieldHint>}
            {err(`params.${p.key}`) && <Text>{err(`params.${p.key}`)}</Text>}
          </FormField>
        ))}
        {hostToAllow(draft.kind) && (
          <MessageContainer variant="primary">
            <MessageContainer.Title>External requests</MessageContainer.Title>
            <MessageContainer.Description>{hostToAllow(draft.kind)}</MessageContainer.Description>
          </MessageContainer>
        )}
        {draft.kind !== "workflow" && <DeliveryFields draft={draft} setDraft={setDraft} error={err("params.workflowId")} />}
        {draft.kind !== "workflow" && (
          <Flex alignItems="center" gap={4}>
            <KeyIcon />
            <ExternalLink href="https://docs.dynatrace.com/docs/manage/credential-vault">Manage credentials in the credential vault</ExternalLink>
          </Flex>
        )}
        {err("enabled") && <Text>{err("enabled")}</Text>}
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
        const handed = !!exec && (exec.handedOff ?? 0) > 0;
        const ok = !!exec && (exec.sent > 0 || handed);
        const text = !exec
          ? "Test requested."
          : handed
            ? `Handed to the workflow “Command Center · ${provider.name}”. Check the destination, or the workflow's executions if nothing arrives.`
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
          <TextInput value={address} onChange={setAddress} placeholder={provider.kind === "twilio" ? "+15550100000" : provider.kind === "workflow" ? "Any value: it is passed as notification.to.address" : "Chat ID or routing key"} />
        </FormField>
        {result && <Health status={result.ok ? "good" : "critical"}>{result.text}</Health>}
      </Flex>
    </Modal>
  );
};

/** On/off switch on each provider card; opens the setup sheet when the provider can't be turned on yet. */
const ProviderSwitch = ({ provider, onNeedsSetup }: { provider: ProviderConfig; onNeedsSetup: () => void }) => {
  const { data, mutate } = useAppData();
  const [busy, setBusy] = useState(false);
  if (!data) return null;
  const toggle = (on: boolean) => {
    if (on && !isConfigured(provider)) return onNeedsSetup();
    const clash = data.settings.providers.find((p) => p.id !== provider.id && p.enabled && p.channel === provider.channel);
    if (on && clash) {
      notify({ category: "error", type: "warning", title: `Turn off ${clash.name} first`, message: "One provider per channel can be on.", lifespan: 6000 });
      return;
    }
    setBusy(true);
    const settings = nextRev({ ...data.settings, providers: data.settings.providers.map((p) => (p.id === provider.id ? { ...p, enabled: on } : p)) });
    mutate((s) => s.saveSettings(settings), `${provider.name} turned ${on ? "on" : "off"}`)
      .then(() => {
        // Switching on is enough: the engine sends. A workflow of its own is an explicit choice in Configure.
        if (!on && provider.kind !== "workflow" && provider.params["workflowId"]?.trim()) {
          notify({ category: "action", type: "info", title: `${provider.name} is off`, message: "Its workflow is no longer run. Delete it in the Workflows app if you don't need it.", lifespan: 8000 });
        }
      })
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };
  return (
    <Switch value={provider.enabled} disabled={busy} onChange={toggle} aria-label={`${provider.name} on or off`}>
      {provider.enabled ? "On" : "Off"}
    </Switch>
  );
};

const OutboundTab = () => {
  const { data, demo, mutate } = useAppData();
  // Where the person chose "its own workflow": link it as soon as one with its title exists (single simple match).
  const unlinked = (data?.settings.providers ?? [])
    .filter((p) => p.enabled && p.kind !== "workflow" && p.params[DELIVERY_PARAM] === "workflow" && !p.params["workflowId"]?.trim())
    .map((p) => p.id)
    .join(",");
  useEffect(() => {
    if (demo || !data || !unlinked) return;
    let cancelled = false;
    const todo = data.settings.providers.filter((p) => unlinked.split(",").includes(p.id));
    void Promise.all(todo.map((p) => findProviderWorkflowIds(p.name).then((f) => [p.id, f] as const).catch(() => [p.id, []] as const))).then((pairs) => {
      if (cancelled) return;
      const links = new Map(
        pairs.flatMap(([id, f]) => {
          const only = f.length === 1 ? f[0] : undefined;
          return only && only.type !== "STANDARD" ? [[id, only.id] as const] : [];
        }),
      );
      if (!links.size) return;
      const settings = nextRev({
        ...data.settings,
        providers: data.settings.providers.map((p) => (links.has(p.id) ? { ...p, params: { ...p.params, workflowId: links.get(p.id)! } } : p)),
      });
      void mutate((s) => s.saveSettings(settings), `Linked ${links.size} integration workflow${links.size === 1 ? "" : "s"}`).catch(() => undefined);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlinked, demo]);
  const [configure, setConfigure] = useState<ProviderConfig>();
  const [test, setTest] = useState<ProviderConfig>();
  const ledger = data?.notifications ?? [];
  return (
    <Flex flexDirection="column" gap={16}>
      <Paragraph>
        Each integration is used only while it is switched on. The engine sends the built-in providers itself, at no extra cost, with a secret from a
        Credential Vault entry: Twilio (SMS, voice, WhatsApp) and IFTTT are the defaults, and the generic webhook covers any other tool. In an
        integration's configuration you can give it a workflow of its own instead. The custom workflow hands each notification to a workflow you own
        and edit. One provider per channel can be on.
      </Paragraph>
      <Grid gridTemplateColumns="repeat(auto-fill, minmax(320px, 1fr))" gap={12}>
        {(data?.settings.providers ?? []).map((p) => {
          const mine = ledger.filter((n) => n.providerId === p.id);
          const last = [...mine].sort((a, b) => (b.reportedAt ?? b.plannedAt) - (a.reportedAt ?? a.plannedAt))[0];
          const failed = last && (last.status === "failed" || last.status === "timeout");
          return (
            <Surface key={p.id} padding={16}>
              <Flex flexDirection="column" gap={12}>
                <Flex alignItems="center" gap={8} justifyContent="space-between">
                  <Flex alignItems="center" gap={8}>
                    {p.kind === "workflow" ? <FlowIcon /> : <ChannelIcon channel={p.channel} />}
                    <Heading level={3}>{p.name}</Heading>
                  </Flex>
                  <ProviderSwitch provider={p} onNeedsSetup={() => setConfigure({ ...p, enabled: true })} />
                </Flex>
                {!isConfigured(p) ? (
                  <Health status="neutral">Not configured</Health>
                ) : !p.enabled ? (
                  <Health status="neutral">Off</Health>
                ) : failed && isHostNotAllowed(last?.error) ? (
                  <Health status="critical">Host not allowed: add it to External requests</Health>
                ) : failed ? (
                  <Health status="critical">Last delivery failed</Health>
                ) : (
                  <Health status="ideal">Configured</Health>
                )}
                <Text textStyle="small">
                  {last
                    ? `${mine.filter((n) => n.status === "sent").length} sent, ${mine.filter((n) => n.status === "failed").length} failed · last ${formatRelative(last.reportedAt ?? last.plannedAt, Date.now())}`
                    : "No notifications sent yet"}
                </Text>
                {failed && last?.error && <Text textStyle="small">{last.error}</Text>}
                {p.kind !== "workflow" && p.enabled && (
                  <Text textStyle="small">
                    {p.params["workflowId"]?.trim()
                      ? `Sent by its workflow “Command Center · ${p.name}”`
                      : wantsOwnWorkflow(p)
                        ? "Sent by the engine until its workflow is linked"
                        : "Sent by the engine"}
                  </Text>
                )}
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


/**
 * Optional second engine workflow: started by the Problem trigger, so the first page does not wait for the interval.
 * It never replaces the interval workflow (escalation steps, snooze ends and retries need a clock).
 */
const OnProblemCard = () => {
  const { data, demo } = useAppData();
  const settings = data?.settings;
  const [status, setStatus] = useState<OnProblemWorkflowStatus>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const load = useCallback(() => {
    setLoading(true);
    getOnProblemWorkflowStatus()
      .then((s) => {
        setStatus(s);
        setError(undefined);
      })
      .catch((e) => setError(e))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => load(), [load]);
  if (!settings) return null;
  const link = status?.workflowId ? workflowUrl(status.workflowId) : undefined;
  return (
    <Surface padding={16}>
      <Flex flexDirection="column" gap={12}>
        <Flex alignItems="center" gap={8} justifyContent="space-between">
          <Flex alignItems="center" gap={8}>
            <FlowIcon />
            <Heading level={3}>Command Center · Engine on problem</Heading>
          </Flex>
          {loading && <ProgressCircle size="small" aria-label="Loading status" />}
        </Flex>
        {error ? (
          <Health status="neutral">Couldn't read its status: {errorMessage(error)}</Health>
        ) : !status ? null : !status.installed ? (
          <Health status="neutral">Optional · not installed</Health>
        ) : status.outdated ? (
          <Health status="warning">{status.usesAction ? "Update available: reinstall it" : "Its task is not this app's engine action: reinstall it"}</Health>
        ) : status.type && status.type !== "SIMPLE" ? (
          <Health status="warning">Installed as a standard workflow: it consumes workflow hours. Delete it and upload the downloaded JSON instead</Health>
        ) : status.triggerActive === false ? (
          <Health status="warning">Installed, but its trigger is switched off</Health>
        ) : (
          <Health status="ideal">Installed · simple workflow (no workflow hours)</Health>
        )}
        <Paragraph>
          Runs the engine as soon as Davis opens or closes a problem, so the first page doesn't wait for the next scheduled run. With it, a 5-minute
          interval is enough for most teams: about 8,640 scheduled runs a month instead of 43,200, plus about two runs per problem.
        </Paragraph>
        <Flex gap={8} flexWrap="wrap">
          <Tooltip text={demo ? "Not available in demo mode" : "Opens the Workflows app with this workflow filled in"}>
            <Button disabled={demo} onClick={() => openOnProblemInstall(settings)}>
              <Button.Prefix>
                <FlowIcon />
              </Button.Prefix>
              {status?.installed ? "Reinstall in Workflows" : "Install in Workflows"}
            </Button>
          </Tooltip>
          <Button
            onClick={() => {
              const { fileName, json } = exportOnProblemWorkflowDefinition(settings);
              download(fileName, json);
            }}
          >
            <Button.Prefix>
              <DownloadIcon />
            </Button.Prefix>
            Download JSON
          </Button>
          <Button onClick={load}>
            <Button.Prefix>
              <RefreshIcon />
            </Button.Prefix>
            Refresh
          </Button>
        </Flex>
        <Text textStyle="small">
          Keep “Command Center · Engine” installed: escalation steps, snooze ends and retries need its clock. The trigger covers Davis problems; other
          sources are read on the interval. Each run waits until the problem can be read (about half a minute), then pages.
        </Text>
        {link && <ExternalLink href={link}>Open in Workflows</ExternalLink>}
      </Flex>
    </Surface>
  );
};

const WorkflowsTab = () => {
  const { data, mutate, demo, now } = useAppData();
  const [status, setStatus] = useState<EngineWorkflowStatus>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [running, setRunning] = useState(false);
  const [interval, setIntervalMin] = useState<string>(String(data?.settings.engine.intervalMinutes ?? 1));
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
  // The installed workflow's own interval wins (it may have been edited in Workflows or installed by script).
  useEffect(() => {
    const found = status?.intervalMinutes;
    if (!settings || !found || found === settings.engine.intervalMinutes) return;
    setIntervalMin(String(found));
    void mutate((st) => st.saveSettings(nextRev({ ...settings, engine: { ...settings.engine, intervalMinutes: found } }))).catch(() => undefined);
  }, [status?.intervalMinutes, settings, mutate]);

  const install = () => {
    if (!settings) return;
    const minutes = Number(interval);
    openEngineInstallIntent(settings, minutes);
    // Remember the interval so the "engine is late" warnings use the right threshold.
    if (settings.engine.intervalMinutes !== minutes)
      void mutate((st) => st.saveSettings(nextRev({ ...settings, engine: { ...settings.engine, intervalMinutes: minutes } })), "Engine interval saved").catch(() => undefined);
  };

  const download = () => {
    if (!settings) return;
    try {
      const minutes = Number(interval);
      const { json, fileName } = exportWorkflowDefinition(settings, minutes);
      if (settings.engine.intervalMinutes !== minutes)
        void mutate((st) => st.saveSettings(nextRev({ ...settings, engine: { ...settings.engine, intervalMinutes: minutes } })), "Engine interval saved").catch(() => undefined);
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
  const stale = !hb || now - hb.lastTickAt > engineStaleAfterMs(settings);

  return (
    <Flex flexDirection="column" gap={16}>
      {error ? <ErrorMessage title="Couldn't read the workflow status" error={error} onRetry={load} /> : null}
      {/* 460 px keeps both workflow titles on one line, so the cards stay aligned */}
      <Grid gridTemplateColumns="repeat(auto-fit, minmax(460px, 1fr))" gap={12}>
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
        <OnProblemCard />
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
              <Text>Add the hosts of the providers you switch on to {EXTERNAL_REQUESTS_PATH} (table below). Dynatrace refuses calls to any other host; a refused send shows “Host not allowed” on the provider.</Text>
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
