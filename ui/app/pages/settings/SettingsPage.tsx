import { FieldHint } from "../../components/FieldHint";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Flex, PageLayout, Surface } from "@dynatrace/strato-components/layouts";
import { Button } from "@dynatrace/strato-components/buttons";
import { MessageContainer } from "@dynatrace/strato-components/content";
import { FormField, Label, NumberInputV2 as NumberInput, Select, Switch, TextInput, ToggleButtonGroup } from "@dynatrace/strato-components/forms";
import { SimpleTable } from "@dynatrace/strato-components/tables";
import { Heading, Link, Paragraph, Text, Code } from "@dynatrace/strato-components/typography";
import { notify } from "../../hooks/notifications";
import { DownloadIcon, UploadIcon, DeleteIcon } from "@dynatrace/strato-icons";
import { PRIORITIES, SCHEMA_VERSION, type Priority, type Settings } from "../../domain/contracts";
import { importConfig, type ConfigExport, type ImportResult } from "../../data/configImport";
import { useAppData, nextRev } from "../../hooks/AppDataContext";
import { usePrefsState } from "../../hooks/prefs";
import { isRuntimeMissing, setDemoPreference, validateSettings } from "../../hooks/domain";
import { PageTitle } from "../../components/PageTitle";
import { ConfirmModal } from "../../components/ConfirmModal";
import { QueryState } from "../../components/QueryState";
import { browserTimeZone, errorMessage, timeZones } from "../../components/format";

const SECTIONS = [
  { id: "general", label: "General" },
  { id: "sources", label: "Event sources" },
  { id: "defaults", label: "Routing defaults" },
  { id: "engine", label: "Paging engine" },
  { id: "retention", label: "Data retention" },
  { id: "configuration", label: "Export and import" },
  { id: "permissions", label: "Permissions" },
  { id: "about", label: "About" },
];

/** Mirrors app.config.json scopes (owned by the lead). */
const SCOPES = [
  { scope: "storage:buckets:read", enables: "Any Grail read" },
  { scope: "storage:events:read", enables: "Read Davis problems, Davis events and custom events" },
  { scope: "state:app-states:read", enables: "Read configuration, incidents and the notification ledger" },
  { scope: "state:app-states:write", enables: "Save configuration and operator actions (ack, resolve, notes…)" },
  { scope: "state:app-states:delete", enables: "Delete configuration and the legacy v1 key" },
  { scope: "iam:users:read", enables: "Search tenant users for teams and schedules" },
  { scope: "automation:workflows:read", enables: "Show the engine workflow status" },
  { scope: "automation:workflows:run", enables: "Escalate now, run the engine, send test notifications" },
];

const LEGACY_KEY = "problem-ack-states";
const BUDGET_BYTES = 50 * 1024 * 1024;


const SectionSurface = ({ id, title, children }: { id: string; title: string; children: React.ReactNode }) => (
  <Surface padding={16} id={id}>
    <Flex flexDirection="column" gap={16} style={{ maxWidth: 560 }}>
      <Heading level={2}>{title}</Heading>
      {children}
    </Flex>
  </Surface>
);

const SaveRow = ({ dirty, busy, onSave, onReset }: { dirty: boolean; busy: boolean; onSave: () => void; onReset: () => void }) => (
  <Flex gap={8} alignItems="center">
    <Button color="primary" variant="accent" disabled={!dirty} loading={busy} onClick={onSave}>
      Save
    </Button>
    {dirty && <Button onClick={onReset}>Discard</Button>}
    {dirty && <Text textStyle="small">Unsaved changes</Text>}
  </Flex>
);

export const SettingsPage = () => {
  const { data, isLoading, error, refresh, mutate, store, demo } = useAppData();
  const location = useLocation();
  const [draft, setDraft] = useState<Settings>();
  const [busy, setBusy] = useState(false);
  const [prefs, setPrefs] = usePrefsState();
  const [legacy, setLegacy] = useState<"unknown" | "present" | "absent">("unknown");
  const [confirmLegacy, setConfirmLegacy] = useState(false);
  const [importDoc, setImportDoc] = useState<ConfigExport>();
  const fileRef = useRef<HTMLInputElement>(null);
  const zones = useMemo(() => timeZones(), []);

  useEffect(() => {
    if (data && !draft) setDraft(data.settings);
  }, [data, draft]);
  useEffect(() => {
    store.repo
      .get(LEGACY_KEY)
      .then((r) => setLegacy(r ? "present" : "absent"))
      .catch(() => setLegacy("unknown"));
  }, [store]);
  useEffect(() => {
    const id = location.hash.replace("#", "");
    if (id) window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
  }, [location.hash, draft]);

  const usage = useMemo(() => {
    if (!data) return 0;
    const parts = [data.settings, data.teams, data.schedules, data.policies, data.services, data.rules, data.contacts, data.incidents, data.actions, data.notifications, data.rollups];
    return parts.reduce((a, p) => a + JSON.stringify(p).length, 0);
  }, [data]);

  if (!draft || !data)
    return (
      <PageLayout.Content>
        <Flex padding={16} flexDirection="column">
          <QueryState isLoading={isLoading || !draft} error={error} errorTitle="Couldn't load settings" onRetry={() => void refresh()}>
            {null}
          </QueryState>
        </Flex>
      </PageLayout.Content>
    );

  const dirty = JSON.stringify(draft) !== JSON.stringify(data.settings);
  const errors = validateSettings(draft, { teams: data.teams, policies: data.policies });
  const save = () => {
    if (errors.length) {
      notify({ category: "error", type: "critical", title: "Fix the settings first", message: errors.map((e) => `${e.path}: ${e.message}`).join("; "), lifespan: 8000 });
      return;
    }
    setBusy(true);
    mutate((s) => s.saveSettings(nextRev(draft)), "Settings saved")
      .then(() => setDraft(undefined))
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };
  const saveRow = <SaveRow dirty={dirty} busy={busy} onSave={save} onReset={() => setDraft(data.settings)} />;
  const set = (patch: Partial<Settings>) => setDraft({ ...draft, ...patch });

  const exportConfig = () => {
    const doc: ConfigExport = {
      kind: "command-center-config",
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      settings: data.settings,
      teams: data.teams,
      schedules: data.schedules,
      policies: data.policies,
      services: data.services,
      rules: data.rules,
      contacts: data.contacts,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `command-center-config-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const readImport = (file: File) => {
    file
      .text()
      .then((t) => {
        const doc = JSON.parse(t) as Partial<ConfigExport>;
        if (doc.kind !== "command-center-config" || !doc.settings || !Array.isArray(doc.teams)) throw new Error("This file isn't a Command Center configuration export.");
        setImportDoc(doc as ConfigExport);
      })
      .catch((e) => notify({ category: "error", type: "critical", title: "Couldn't read the file", message: errorMessage(e), lifespan: "infinite" }));
  };
  const runImport = async () => {
    const doc = importDoc;
    if (!doc) return;
    let outcome: ImportResult | undefined;
    await mutate(async (s) => {
      outcome = await importConfig(s, doc, data.settings, data);
      if (outcome.problems.length) {
        throw new Error(`Nothing was imported: ${outcome.problems.slice(0, 5).map((p) => `${p.path}: ${p.message}`).join("; ")}`);
      }
      if (outcome.failed.length) {
        throw new Error(
          `Partially imported: ${outcome.written.length} saved, ${outcome.failed.length} failed (${outcome.failed
            .slice(0, 5)
            .map((f) => f.key)
            .join(", ")})`,
        );
      }
    }, "Configuration imported").catch(() => undefined);
    setDraft(undefined);
  };

  return (
    <>
      <PageLayout.Sidebar defaultWidth={220} minWidth={180}>
        <Flex flexDirection="column" gap={12} padding={16}>
          <Text textStyle="small-emphasized">Settings</Text>
          {SECTIONS.map((s) => (
            <Link key={s.id} href={`#${s.id}`} onClick={(e: React.MouseEvent) => (e.preventDefault(), document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth" }))}>
              {s.label}
            </Link>
          ))}
        </Flex>
      </PageLayout.Sidebar>
      <PageLayout.Content>
        <Flex flexDirection="column" gap={16} padding={16}>
          <PageTitle title="Settings" subtitle="App-wide configuration. Changes apply to every user of this app in the environment." />

          <SectionSurface id="general" title="General">
            <FormField required>
              <Label>Tenant time zone</Label>
              <Select value={draft.ui.timeZone ?? browserTimeZone()} onChange={(v) => v && set({ ui: { ...draft.ui, timeZone: v } })}>
                <Select.Filter />
                <Select.Content>
                  {zones.map((z) => (
                    <Select.Option key={z} value={z}>
                      {z}
                    </Select.Option>
                  ))}
                </Select.Content>
              </Select>
              <FieldHint>Used for timestamps, schedules, handoffs, and report days</FieldHint>
            </FormField>
            <FormField>
              <Label>Auto-refresh default</Label>
              <Select value={draft.ui.autoRefreshSec} onChange={(v) => set({ ui: { ...draft.ui, autoRefreshSec: Number(v ?? 0) } })}>
                <Select.Content>
                  {[0, 15, 30, 60, 300].map((v) => (
                    <Select.Option key={v} value={v}>
                      {v === 0 ? "Off" : v < 60 ? `${v} s` : `${v / 60} min`}
                    </Select.Option>
                  ))}
                </Select.Content>
              </Select>
            </FormField>
            {saveRow}
            <Heading level={4}>Personal preferences (this browser)</Heading>
            <FormField>
              <Label>Table density</Label>
              <ToggleButtonGroup value={prefs.tableDensity} onChange={(v: string) => setPrefs({ ...prefs, tableDensity: v as "default" | "condensed" })}>
                <ToggleButtonGroup.Item value="default">Default</ToggleButtonGroup.Item>
                <ToggleButtonGroup.Item value="condensed">Condensed</ToggleButtonGroup.Item>
              </ToggleButtonGroup>
            </FormField>
            <Switch value={prefs.keyboardShortcuts} onChange={(v) => setPrefs({ ...prefs, keyboardShortcuts: v })}>
              Single-key keyboard shortcuts in the Console
            </Switch>
            <FormField>
              <Label>Acknowledge target (minutes)</Label>
              <NumberInput value={prefs.ackTargetMin} min={1} max={240} onChange={(v) => setPrefs({ ...prefs, ackTargetMin: Math.max(1, v ?? 5) })} />
              <FieldHint>Incidents older than this turn red in the Console; drives the MTTA meter</FieldHint>
            </FormField>
            <Heading level={4}>Demo mode</Heading>
            <Switch
              value={demo}
              onChange={(on) => {
                setDemoPreference(on);
                const url = new URL(window.location.href);
                url.searchParams.delete("demo");
                if (on) url.searchParams.set("demo", "1");
                window.location.assign(url.toString());
              }}
            >
              Show sample data
            </Switch>
            <FieldHint>Shows sample incidents, teams, and schedules in this browser. Actions don't send notifications and nothing is saved to the environment.</FieldHint>
            {demo && isRuntimeMissing() && (
              <MessageContainer variant="warning">
                <MessageContainer.Description>
                  The app runs outside Dynatrace here, so demo mode stays on. No incidents appear until events arrive; see Integrations.
                </MessageContainer.Description>
              </MessageContainer>
            )}
          </SectionSurface>

          <SectionSurface id="sources" title="Event sources">
            <Switch
              value={draft.sources.davisProblems.enabled}
              onChange={(v) => set({ sources: { ...draft.sources, davisProblems: { ...draft.sources.davisProblems, enabled: v } } })}
            >
              Davis problems
            </Switch>
            <FormField>
              <Label>Look back (hours)</Label>
              <NumberInput
                value={draft.sources.davisProblems.lookbackHours}
                min={1}
                max={336}
                onChange={(v) => set({ sources: { ...draft.sources, davisProblems: { ...draft.sources.davisProblems, lookbackHours: v ?? 72 } } })}
              />
            </FormField>
            <Switch
              value={draft.sources.davisProblems.pageDuringMaintenance}
              onChange={(v) => set({ sources: { ...draft.sources, davisProblems: { ...draft.sources.davisProblems, pageDuringMaintenance: v } } })}
            >
              Page during maintenance windows
            </Switch>
            <Switch
              value={draft.sources.davisEvents.enabled}
              onChange={(v) => set({ sources: { ...draft.sources, davisEvents: { ...draft.sources.davisEvents, enabled: v } } })}
            >
              Davis events that don't open a problem (Events API v2)
            </Switch>
            <FormField>
              <Label>Davis event types</Label>
              <TextInput
                value={draft.sources.davisEvents.eventTypes.join(", ")}
                onChange={(v) =>
                  set({ sources: { ...draft.sources, davisEvents: { ...draft.sources.davisEvents, eventTypes: v.split(",").map((x) => x.trim()).filter(Boolean) } } })
                }
              />
              <FieldHint>Comma-separated, for example CUSTOM_ALERT, ERROR_EVENT</FieldHint>
            </FormField>
            <Switch
              value={draft.sources.genericEvents.enabled}
              onChange={(v) => set({ sources: { ...draft.sources, genericEvents: { ...draft.sources.genericEvents, enabled: v } } })}
            >
              Generic events (OpenPipeline)
            </Switch>
            <FormField>
              <Label>Generic event type</Label>
              <TextInput
                value={draft.sources.genericEvents.eventType}
                onChange={(v) => set({ sources: { ...draft.sources, genericEvents: { ...draft.sources.genericEvents, eventType: v } } })}
              />
            </FormField>
            <Text textStyle="small">The engine queries are UNVALIDATED until they run against a tenant.</Text>
            {saveRow}
          </SectionSurface>

          <SectionSurface id="defaults" title="Routing defaults">
            <Paragraph>Used when no routing rule, event property, or service decides. The priority mapping lives in Services → Priority mapping.</Paragraph>
            <FormField>
              <Label>Default team</Label>
              <Select value={draft.defaults.teamId ?? null} clearable onChange={(v) => set({ defaults: { ...draft.defaults, teamId: v ?? undefined } })}>
                <Select.Content>
                  {data.teams.map((t) => (
                    <Select.Option key={t.id} value={t.id}>
                      {t.name}
                    </Select.Option>
                  ))}
                </Select.Content>
              </Select>
            </FormField>
            <FormField>
              <Label>Default escalation policy</Label>
              <Select value={draft.defaults.policyId ?? null} clearable onChange={(v) => set({ defaults: { ...draft.defaults, policyId: v ?? undefined } })}>
                <Select.Content>
                  {data.policies.map((p) => (
                    <Select.Option key={p.id} value={p.id}>
                      {p.name}
                    </Select.Option>
                  ))}
                </Select.Content>
              </Select>
            </FormField>
            <FormField>
              <Label>Fallback priority</Label>
              <Select value={draft.defaults.priority} onChange={(v) => v && set({ defaults: { ...draft.defaults, priority: v as Priority } })}>
                <Select.Content>
                  {PRIORITIES.map((p) => (
                    <Select.Option key={p} value={p}>
                      {p}
                    </Select.Option>
                  ))}
                </Select.Content>
              </Select>
            </FormField>
            {saveRow}
          </SectionSurface>

          <SectionSurface id="engine" title="Paging engine">
            <Switch value={draft.engine.enabled} onChange={(v) => set({ engine: { ...draft.engine, enabled: v } })}>
              Engine enabled (turn off to pause all paging)
            </Switch>
            <FormField>
              <Label>Engine workflow ID</Label>
              <TextInput value={draft.engine.workflowId} onChange={(v) => set({ engine: { ...draft.engine, workflowId: v.trim() } })} placeholder="Assigned when you download the workflow" />
              <FieldHint>The UUID of the uploaded engine workflow (Integrations → Workflows)</FieldHint>
            </FormField>
            <FormField>
              <Label>Max notifications per run</Label>
              <NumberInput value={draft.engine.maxNotificationsPerTick} min={1} max={1000} onChange={(v) => set({ engine: { ...draft.engine, maxNotificationsPerTick: v ?? 100 } })} />
            </FormField>
            <FormField>
              <Label>Delivery report timeout (seconds)</Label>
              <NumberInput value={draft.engine.reportTimeoutSec} min={30} max={3600} onChange={(v) => set({ engine: { ...draft.engine, reportTimeoutSec: v ?? 180 } })} />
            </FormField>
            <FormField>
              <Label>Delivery attempts</Label>
              <NumberInput value={draft.engine.maxAttempts} min={1} max={10} onChange={(v) => set({ engine: { ...draft.engine, maxAttempts: v ?? 3 } })} />
            </FormField>
            <FormField>
              <Label>Engine lock lease (seconds)</Label>
              <NumberInput value={draft.engine.lockTtlSec} min={30} max={600} onChange={(v) => set({ engine: { ...draft.engine, lockTtlSec: v ?? 90 } })} />
            </FormField>
            {saveRow}
          </SectionSurface>

          <SectionSurface id="retention" title="Data retention">
            <FormField>
              <Label>Keep resolved incidents visible (hours)</Label>
              <NumberInput value={draft.retention.resolvedVisibleHours} min={1} max={720} onChange={(v) => set({ retention: { ...draft.retention, resolvedVisibleHours: v ?? 24 } })} />
            </FormField>
            <FormField>
              <Label>Archive resolved incidents for (days)</Label>
              <NumberInput value={draft.retention.archiveDays} min={1} max={90} onChange={(v) => set({ retention: { ...draft.retention, archiveDays: v ?? 30 } })} />
              <FieldHint>App state allows at most 90 days; reports keep daily rollups</FieldHint>
            </FormField>
            <MessageContainer variant="neutral">
              <MessageContainer.Description>
                Incidents, actions and the notification ledger live in app state (50 MB per app). Source events stay in Grail, where retention follows your bucket
                settings. Estimated usage: {(usage / 1024).toFixed(0)} KB of {(BUDGET_BYTES / 1024 / 1024).toFixed(0)} MB ({((usage / BUDGET_BYTES) * 100).toFixed(2)}%).
              </MessageContainer.Description>
            </MessageContainer>
            {saveRow}
          </SectionSurface>

          <SectionSurface id="configuration" title="Export and import">
            <Paragraph>
              Download teams, schedules, policies, services, rules, contacts and settings as JSON, for backup or to copy them to another environment. Admins can
              clear app state, so keep a recent export.
            </Paragraph>
            <Flex gap={8} flexWrap="wrap">
              <Button onClick={exportConfig}>
                <Button.Prefix>
                  <DownloadIcon />
                </Button.Prefix>
                Export configuration
              </Button>
              <Button onClick={() => fileRef.current?.click()}>
                <Button.Prefix>
                  <UploadIcon />
                </Button.Prefix>
                Import configuration
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                aria-label="Configuration file"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) readImport(f);
                  e.target.value = "";
                }}
              />
            </Flex>
            <Heading level={4}>Legacy data</Heading>
            <Paragraph>
              Version 1 stored acknowledgements in the app-state key <Code>{LEGACY_KEY}</Code>. Version 2 doesn't read it.
            </Paragraph>
            <Flex>
              <Button color="critical" disabled={legacy !== "present"} onClick={() => setConfirmLegacy(true)}>
                <Button.Prefix>
                  <DeleteIcon />
                </Button.Prefix>
                {legacy === "absent" ? "No legacy data found" : "Delete legacy data"}
              </Button>
            </Flex>
          </SectionSurface>

          <SectionSurface id="permissions" title="Permissions">
            <SimpleTable
              data={SCOPES}
              columns={[
                { id: "scope", header: "App scope", accessor: "scope", width: 220 },
                { id: "enables", header: "Enables", accessor: "enables", width: 320 },
              ]}
            />
            <Paragraph>
              Team roles (Team admin, Responder, Observer) are guidance for people: every user of this app can technically change configuration, because app
              state has no per-key permissions. Who can open the app at all is controlled by your Dynatrace IAM policies.
            </Paragraph>
          </SectionSurface>

          <SectionSurface id="about" title="About">
            <Text>Command Center for Dynatrace 2.0.0 · data schema v{SCHEMA_VERSION}</Text>
            <Text>{demo ? "Running in demo mode." : "Connected to this environment's app state."}</Text>
          </SectionSurface>
        </Flex>
      </PageLayout.Content>
      <ConfirmModal
        show={confirmLegacy}
        title="Delete legacy data?"
        onDismiss={() => setConfirmLegacy(false)}
        onConfirm={() =>
          store.repo
            .delete(LEGACY_KEY)
            .then(() => {
              setLegacy("absent");
              notify({ category: "action", type: "success", title: "Legacy data deleted", lifespan: 4000 });
            })
            .catch((e) => {
              notify({ category: "error", type: "critical", title: "Couldn't delete the legacy data", message: errorMessage(e), lifespan: "infinite" });
            })
        }
      >
        The v1 acknowledgement key is removed permanently. Version 2 never reads it.
      </ConfirmModal>
      <ConfirmModal
        show={!!importDoc}
        title="Import configuration?"
        confirmLabel="Import"
        onDismiss={() => setImportDoc(undefined)}
        onConfirm={runImport}
      >
        {`This overwrites settings and any team, schedule, policy, service or contact with the same ID (${importDoc?.teams.length ?? 0} teams, ${importDoc?.schedules?.length ?? 0} schedules, ${importDoc?.policies?.length ?? 0} policies, ${importDoc?.services?.length ?? 0} services). Incidents aren't touched.`}
      </ConfirmModal>
    </>
  );
};
