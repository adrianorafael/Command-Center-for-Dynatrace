import { FieldHint } from "../../components/FieldHint";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Flex, Grid, PageLayout, Surface } from "@dynatrace/strato-components/layouts";
import { Button } from "@dynatrace/strato-components/buttons";
import { MessageContainer } from "@dynatrace/strato-components/content";
import { FieldSet, FormField, Label, NumberInputV2 as NumberInput, Select, Switch, TextInput } from "@dynatrace/strato-components/forms";
import { Menu } from "@dynatrace/strato-components/navigation";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { DotMenuIcon, PlusIcon, XmarkIcon } from "@dynatrace/strato-icons";
import Colors from "@dynatrace/strato-design-tokens/colors";
import Borders from "@dynatrace/strato-design-tokens/borders";
import { CHANNELS, SCHEMA_VERSION, type EscalationPolicy, type EscalationStep, type EscalationTarget } from "../../domain/contracts";
import { useAppData, nextRev } from "../../hooks/AppDataContext";
import { newId, validatePolicy } from "../../hooks/domain";
import { PageTitle } from "../../components/PageTitle";
import { QueryState, SimpleEmpty } from "../../components/QueryState";
import { UserPicker } from "../../components/UserPicker";
import { CHANNEL_LABEL } from "../../components/ChannelIcon";
import { IconButton } from "../../components/IconButton";
import { ConfirmModal } from "../../components/ConfirmModal";
import { PolicySimulation } from "./PolicyView";

type TargetKind = EscalationTarget["type"];

const TargetEditor = ({ target, onChange, onRemove }: { target: EscalationTarget; onChange: (t: EscalationTarget) => void; onRemove: () => void }) => {
  const { data } = useAppData();
  const kind = target.type;
  const setKind = (k: TargetKind) =>
    onChange(
      k === "schedule"
        ? { type: "schedule", scheduleId: data?.schedules[0]?.id ?? "" }
        : k === "team"
          ? { type: "team", teamId: data?.teams[0]?.id ?? "" }
          : { type: "user", uid: "" },
    );
  return (
    <Flex gap={8} alignItems="flex-end" flexWrap="wrap">
      <FormField>
        <Label>Notify</Label>
        <Select value={kind} onChange={(v) => v && setKind(v)}>
          <Select.Content>
            <Select.Option value="schedule">On-call of schedule</Select.Option>
            <Select.Option value="team">Team (all responders)</Select.Option>
            <Select.Option value="user">User</Select.Option>
          </Select.Content>
        </Select>
      </FormField>
      <Flex flexGrow={1} flexDirection="column" style={{ minWidth: 200 }}>
        <FormField required>
          <Label>{kind === "schedule" ? "Schedule" : kind === "team" ? "Team" : "User"}</Label>
          {target.type === "schedule" ? (
            <Select value={target.scheduleId || null} onChange={(v) => onChange({ type: "schedule", scheduleId: v ?? "" })}>
              <Select.Content>
                {(data?.schedules ?? []).map((s) => (
                  <Select.Option key={s.id} value={s.id}>
                    {s.name}
                  </Select.Option>
                ))}
              </Select.Content>
            </Select>
          ) : target.type === "team" ? (
            <Select value={target.teamId || null} onChange={(v) => onChange({ type: "team", teamId: v ?? "" })}>
              <Select.Content>
                {(data?.teams ?? []).map((t) => (
                  <Select.Option key={t.id} value={t.id}>
                    {t.name}
                  </Select.Option>
                ))}
              </Select.Content>
            </Select>
          ) : (
            <UserPicker value={target.uid || null} onChange={(u) => onChange({ type: "user", uid: u ?? "" })} />
          )}
        </FormField>
      </Flex>
      <IconButton label="Remove target" icon={<XmarkIcon />} onClick={onRemove} />
    </Flex>
  );
};

const StepNumber = ({ n }: { n: number }) => (
  <Flex
    alignItems="center"
    justifyContent="center"
    style={{
      width: 24,
      height: 24,
      flexShrink: 0,
      background: Colors.Background.Field.Neutral.Emphasized,
      borderRadius: Borders.Radius.Field.Default,
    }}
  >
    <Text textStyle="base-emphasized">{n}</Text>
  </Flex>
);

export const PolicyEditorPage = () => {
  const { id = "new" } = useParams();
  const [search] = useSearchParams();
  const presetTeam = search.get("teamId") ?? undefined;
  /** Only in-app paths, so a crafted link can't send the user elsewhere. */
  const returnTo = (() => {
    const r = search.get("returnTo");
    return r && r.startsWith("/") && !r.startsWith("//") ? r : undefined;
  })();
  const navigate = useNavigate();
  const { data, isLoading, error, refresh, mutate } = useAppData();
  const existing = data?.policies.find((p) => p.id === id);
  const isNew = id === "new";
  const [draft, setDraft] = useState<EscalationPolicy>();
  const [dirty, setDirty] = useState(false);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  useEffect(() => {
    if (draft || !data) return;
    setDraft(
      existing ?? {
        schemaVersion: SCHEMA_VERSION,
        id: newId("policy"),
        name: "",
        teamId: presetTeam ?? data.teams[0]?.id,
        rev: 0,
        repeat: 0,
        steps: [
          {
            delayMinutes: 0,
            targets: (() => {
              const sch = data.schedules.find((x) => x.teamId === (presetTeam ?? data.teams[0]?.id)) ?? data.schedules[0];
              return sch ? [{ type: "schedule" as const, scheduleId: sch.id }] : [];
            })(),
          },
        ],
      },
    );
  }, [data, existing, draft, presetTeam]);

  const errors = useMemo(() => (draft ? validatePolicy(draft, { teams: data?.teams, schedules: data?.schedules }) : []), [draft, data]);
  const configured = useMemo(() => new Set((data?.settings.providers ?? []).filter((p) => p.enabled).map((p) => p.channel)), [data]);

  if (!draft || isLoading || error)
    return (
      <PageLayout.Content>
        <Flex padding={16} flexDirection="column">
          <QueryState isLoading={isLoading || !draft} error={error} onRetry={() => void refresh()}>
            {null}
          </QueryState>
        </Flex>
      </PageLayout.Content>
    );
  if (!isNew && !existing && !dirty)
    return (
      <PageLayout.Content>
        <Flex padding={16}>
          <SimpleEmpty title="Escalation policy not found" actions={<Button onClick={() => navigate("/escalations")}>Back to policies</Button>} />
        </Flex>
      </PageLayout.Content>
    );

  const update = (p: EscalationPolicy) => {
    setDraft(p);
    setDirty(true);
  };
  const setStep = (i: number, s: EscalationStep) => update({ ...draft, steps: draft.steps.map((x, j) => (j === i ? s : x)) });
  const move = (i: number, d: number) => {
    const steps = [...draft.steps];
    const j = i + d;
    if (j < 0 || j >= steps.length) return;
    [steps[i], steps[j]] = [steps[j], steps[i]];
    update({ ...draft, steps });
  };
  const messages = [
    ...new Set(
      errors.map((e) => {
        const m = /^steps\[(\d+)\]\.(\w+)/.exec(e.path);
        if (e.path === "name") return "Enter a policy name";
        if (e.path === "steps") return e.message === "Add at least one step" ? "Add at least one step" : e.message;
        if (m && m[2] === "targets") return `Choose a target for step ${Number(m[1]) + 1}`;
        if (m) return `Step ${Number(m[1]) + 1}: ${e.message}`;
        return e.message;
      }),
    ),
  ];
  const save = () => {
    setTried(true);
    if (errors.length) return;
    setSaving(true);
    // Created from a team's checklist: also make it that team's default policy when it has none.
    const team = presetTeam ? data?.teams.find((t) => t.id === presetTeam && !t.defaultPolicyId) : undefined;
    mutate(async (s) => {
      await s.savePolicy(nextRev(draft));
      if (team) await s.saveTeam(nextRev({ ...team, defaultPolicyId: draft.id }));
    }, isNew ? (team ? `Policy created and set as ${team.name}'s default` : "Policy created") : "Policy saved")
      .then(() => {
        setDirty(false);
        navigate(returnTo ?? "/escalations");
      })
      .catch(() => undefined)
      .finally(() => setSaving(false));
  };

  return (
    <PageLayout.Content>
      <Flex flexDirection="column" gap={16} padding={16}>
        <PageTitle
          crumbs={[{ label: "Escalations", to: "/escalations" }, { label: draft.name || "New escalation policy" }]}
          title={draft.name || "New escalation policy"}
          subtitle="Steps run in order until someone acknowledges"
          action={
            <Flex gap={8}>
              <Button onClick={() => (dirty ? setConfirmDiscard(true) : navigate(returnTo ?? "/escalations"))}>Cancel</Button>
              <Button color="primary" variant="accent" loading={saving} onClick={save}>
                Save
              </Button>
            </Flex>
          }
        />
        {tried && messages.length > 0 && (
          <MessageContainer variant="critical">
            <MessageContainer.Title>To save this policy:</MessageContainer.Title>
            <MessageContainer.Description>{messages.map((m) => `· ${m}`).join("  ")}</MessageContainer.Description>
          </MessageContainer>
        )}
        <Grid gridTemplateColumns="minmax(420px, 640px) minmax(320px, 1fr)" gap={24}>
          <Flex flexDirection="column" gap={24}>
            <FieldSet>
              <FieldSet.Legend>Policy</FieldSet.Legend>
              <Flex flexDirection="column" gap={16}>
                <FormField required>
                  <Label>Name</Label>
                  <TextInput value={draft.name} onChange={(v) => update({ ...draft, name: v })} placeholder="For example: Payments default" />
                </FormField>
                <FormField required>
                  <Label>Team</Label>
                  <Select value={draft.teamId ?? null} onChange={(v) => update({ ...draft, teamId: v ?? undefined })}>
                    <Select.Content>
                      {(data?.teams ?? []).map((t) => (
                        <Select.Option key={t.id} value={t.id}>
                          {t.name}
                        </Select.Option>
                      ))}
                    </Select.Content>
                  </Select>
                </FormField>
              </Flex>
            </FieldSet>
            <Flex flexDirection="column" gap={8}>
              <Heading level={4}>Steps</Heading>
              {draft.steps.map((s, i) => (
                <React.Fragment key={i}>
                  <Flex alignItems="center" gap={8} paddingX={16}>
                    <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued }}>
                      {i === 0 ? "When an incident triggers, wait" : "Then, if nobody acknowledged, wait"}
                    </Text>
                    <NumberInput
                      aria-label={`Delay before step ${i + 1} in minutes`}
                      value={s.delayMinutes}
                      min={0}
                      max={1440}
                      step={1}
                      onChange={(v) => setStep(i, { ...s, delayMinutes: v ?? 0 })}
                      style={{ width: 96 }}
                    />
                    <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued }}>
                      minutes
                    </Text>
                  </Flex>
                  <Surface padding={16}>
                    <Flex flexDirection="column" gap={12}>
                      <Flex alignItems="center" gap={12} justifyContent="space-between">
                        <Flex alignItems="center" gap={12}>
                          <StepNumber n={i + 1} />
                          <Text textStyle="base-emphasized">Step {i + 1}</Text>
                        </Flex>
                        <Menu>
                          <Menu.Trigger>
                            <Button aria-label={`Actions for step ${i + 1}`} size="condensed">
                              <Button.Prefix>
                                <DotMenuIcon />
                              </Button.Prefix>
                            </Button>
                          </Menu.Trigger>
                          <Menu.Content>
                            <Menu.Item disabled={i === 0} onSelect={() => move(i, -1)}>
                              Move up
                            </Menu.Item>
                            <Menu.Item disabled={i === draft.steps.length - 1} onSelect={() => move(i, 1)}>
                              Move down
                            </Menu.Item>
                            <Menu.Item onSelect={() => update({ ...draft, steps: [...draft.steps.slice(0, i + 1), { ...s }, ...draft.steps.slice(i + 1)] })}>
                              Duplicate step
                            </Menu.Item>
                            <Menu.Item onSelect={() => update({ ...draft, steps: draft.steps.filter((_, j) => j !== i) })}>Delete step</Menu.Item>
                          </Menu.Content>
                        </Menu>
                      </Flex>
                      {s.targets.map((t, j) => (
                        <TargetEditor
                          key={j}
                          target={t}
                          onChange={(nt) => setStep(i, { ...s, targets: s.targets.map((x, k) => (k === j ? nt : x)) })}
                          onRemove={() => setStep(i, { ...s, targets: s.targets.filter((_, k) => k !== j) })}
                        />
                      ))}
                      <Flex>
                        <Button
                          size="condensed"
                          onClick={() => setStep(i, { ...s, targets: [...s.targets, { type: "team", teamId: draft.teamId ?? data?.teams[0]?.id ?? "" }] })}
                        >
                          <Button.Prefix>
                            <PlusIcon />
                          </Button.Prefix>
                          Add target
                        </Button>
                      </Flex>
                      <FormField>
                        <Label>Channels</Label>
                        <Select
                          multiple
                          clearable
                          value={s.channels ?? []}
                          onChange={(v) => setStep(i, { ...s, channels: v && v.length ? v : undefined })}
                        >
                          <Select.Content>
                            {CHANNELS.map((c) => (
                              <Select.Option key={c} value={c} disabled={!configured.has(c)}>
                                {configured.has(c) ? CHANNEL_LABEL[c] : `${CHANNEL_LABEL[c]} (configure in Integrations first)`}
                              </Select.Option>
                            ))}
                          </Select.Content>
                        </Select>
                        <FieldHint>Leave empty to use each person's notification rules (recommended)</FieldHint>
                      </FormField>
                    </Flex>
                  </Surface>
                </React.Fragment>
              ))}
              <Flex>
                <Button onClick={() => update({ ...draft, steps: [...draft.steps, { delayMinutes: 5, targets: [] }] })}>
                  <Button.Prefix>
                    <PlusIcon />
                  </Button.Prefix>
                  Add step
                </Button>
              </Flex>
            </Flex>
            <FieldSet>
              <FieldSet.Legend>Repeat</FieldSet.Legend>
              <Flex flexDirection="column" gap={16}>
                <Switch value={draft.repeat > 0} onChange={(on) => update({ ...draft, repeat: on ? Math.max(1, draft.repeat) : 0 })}>
                  Repeat policy if nobody acknowledges
                </Switch>
                {draft.repeat > 0 && (
                  <FormField>
                    <Label>Times</Label>
                    <NumberInput value={draft.repeat} min={1} max={5} onChange={(v) => update({ ...draft, repeat: Math.max(1, Math.min(5, v ?? 1)) })} />
                    <FieldHint>Each repeat starts after the last step's delay. When all repeats are done the policy is exhausted and the incident stays triggered.</FieldHint>
                  </FormField>
                )}
              </Flex>
            </FieldSet>
          </Flex>
          <Surface padding={16} style={{ alignSelf: "start" }}>
            <Flex flexDirection="column" gap={12}>
              <Heading level={3}>Simulation</Heading>
              <Text textStyle="small">If an incident is triggered now (time after trigger, hh:mm):</Text>
              <PolicySimulation policy={draft} />
            </Flex>
          </Surface>
        </Grid>
      </Flex>
      <ConfirmModal
        show={confirmDiscard}
        title="Discard unsaved changes?"
        confirmLabel="Discard"
        onDismiss={() => setConfirmDiscard(false)}
        onConfirm={() => navigate(returnTo ?? "/escalations")}
      >
        Your changes to this policy will be lost.
      </ConfirmModal>
    </PageLayout.Content>
  );
};
