import { CreatedMarker, markCreated } from "../../components/NewItemHighlight";
import { FieldHint } from "../../components/FieldHint";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Flex, Grid, PageLayout, Surface } from "@dynatrace/strato-components/layouts";
import { Button } from "@dynatrace/strato-components/buttons";
import { Accordion, MessageContainer, Avatar } from "@dynatrace/strato-components/content";
import {
  Checkbox,
  DateTimePicker,
  FieldSet,
  FormField,
  Label,
  NumberInputV2 as NumberInput,
  Select,
  Switch,
  TextInput,
  ToggleButtonGroup,
  } from "@dynatrace/strato-components/forms";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { PlusIcon, XmarkIcon } from "@dynatrace/strato-icons";
import { SCHEMA_VERSION, type RotationLayer, type Schedule } from "../../domain/contracts";
import { useAppData, nextRev } from "../../hooks/AppDataContext";
import { firstHandoff, newId, scheduleTimeline, startOfLocalDay, validateSchedule, weekdayInZone } from "../../hooks/domain";
import { LIST_TABLE_VARIANT, withCreatedMarker } from "../../components/tableKit";
import { PageTitle } from "../../components/PageTitle";
import { UserPicker } from "../../components/UserPicker";
import { ShiftGantt, coverage } from "../../components/ShiftGantt";
import { Health } from "../../components/StatusIndicator";
import { ConfirmModal } from "../../components/ConfirmModal";
import { IconButton } from "../../components/IconButton";
import { QueryState, SimpleEmpty } from "../../components/QueryState";
import { browserTimeZone, formatDayDateTime, formatDuration, initials, msToIso, pickerToMs, plural, timeZones } from "../../components/format";
import { ContactIcons } from "./OnCallPage";

const DAY = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * A new layer starts at the beginning of today (schedule zone), so somebody is on call as soon as it is saved,
 * and hands off at 09:00.
 */
function newLayer(index: number, now: number, timeZone: string, participants: string[] = []): RotationLayer {
  return {
    id: newId(`layer${index + 1}`),
    name: index === 0 ? "Primary" : index === 1 ? "Secondary" : `Layer ${index + 1}`,
    participants,
    rotation: { type: "weekly" },
    startsAt: startOfLocalDay(now, timeZone),
    handoffTime: "09:00",
  };
}

/** Weekday of the weekly handoff, from the domain's first handoff in the schedule zone. */
function handoffWeekday(l: RotationLayer, timeZone: string): string {
  return WEEKDAYS[weekdayInZone(firstHandoff(l, timeZone), timeZone)] ?? "";
}

function rotationSummary(l: RotationLayer, timeZone: string): string {
  const kind = l.rotation.type === "custom" ? `Every ${l.rotation.lengthHours ?? "?"} h` : l.rotation.type === "daily" ? "Daily" : "Weekly";
  const day = l.rotation.type === "weekly" ? `${handoffWeekday(l, timeZone)} ` : "";
  return `${kind} · ${plural(l.participants.length, "person", "people")} · handoff ${day}${l.handoffTime}`;
}

/** One sentence that says when people swap, in the schedule's time zone. */
function handoffSentence(l: RotationLayer, timeZone: string): string {
  if (l.rotation.type === "weekly") return `People swap every ${handoffWeekday(l, timeZone)} at ${l.handoffTime} (${timeZone}).`;
  if (l.rotation.type === "daily") return `People swap every day at ${l.handoffTime} (${timeZone}).`;
  return `People swap every ${l.rotation.lengthHours ?? 12} hours, counted from ${l.handoffTime} (${timeZone}).`;
}

/** Friendly messages for validator paths (patterns/error-messages). */
function describeErrors(s: Schedule, errs: { path: string; message: string }[]): string[] {
  return errs.map((e) => {
    const m = /^layers\[(\d+)\]\.(\w+)/.exec(e.path);
    const layer = m ? `Layer ${Number(m[1]) + 1}` : "";
    if (e.path === "name") return "Enter a schedule name";
    if (e.path === "timeZone") return "Choose a time zone";
    if (e.path === "layers") return "Add at least one layer";
    if (m && m[2] === "participants") return `Add at least one member to ${layer}`;
    if (m && m[2] === "handoffTime") return `Use HH:mm for the handoff time of ${layer}`;
    if (m && m[2] === "rotation") return `Set a rotation length between 1 and 672 hours for ${layer}`;
    if (m) return `${layer}: ${e.message}`;
    void s;
    return e.message;
  });
}

const LayerEditor = ({
  layer,
  timeZone,
  teamUids,
  showLayerControls,
  onChange,
  onRemove,
  onDuplicate,
}: {
  layer: RotationLayer;
  /** The schedule's time zone: handoffs are computed in it. */
  timeZone: string;
  /** People of the schedule's team who get paged: offered for one-click adding. */
  teamUids: string[];
  /** Layer name, duplicate and delete only matter when the schedule has several layers. */
  showLayerControls: boolean;
  onChange: (l: RotationLayer) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}) => {
  const { userName } = useAppData();
  const restricted = !!layer.restrictions?.length;
  const r = layer.restrictions?.[0] ?? { days: [1, 2, 3, 4, 5], from: "09:00", to: "17:00" };
  const rows = layer.participants.map((uid, i) => ({ uid, pos: i + 1 }));
  const add = (uid: string) => {
    if (layer.participants.includes(uid)) return;
    markCreated("participant", uid);
    onChange({ ...layer, participants: [...layer.participants, uid] });
  };
  const candidates = teamUids.filter((u) => !layer.participants.includes(u));
  const columns: DataTableColumnDef<{ uid: string; pos: number }>[] = [
    { id: "pos", header: "#", accessor: "pos", width: 48 },
    {
      id: "person",
      header: "Person",
      accessor: (x) => userName(x.uid),
      width: "1fr",
      cell: ({ rowData }) => (
        <Avatar size="small" abbreviation={initials(userName(rowData.uid))}>
          <Avatar.Label>{userName(rowData.uid)}</Avatar.Label>
        </Avatar>
      ),
    },
    { id: "contact", header: "Contact", accessor: "uid", width: 120, cell: ({ rowData }) => <ContactIcons uid={rowData.uid} /> },
  ];
  return (
    <Flex flexDirection="column" gap={16}>
      {showLayerControls && (
        <FormField required>
          <Label>Layer name</Label>
          <TextInput value={layer.name} onChange={(v) => onChange({ ...layer, name: v })} />
        </FormField>
      )}
      <Flex flexDirection="column" gap={8}>
        <Text textStyle="base-emphasized">People in the rotation</Text>
        {rows.length ? (
          <>
            <DataTable
              data={rows}
              columns={withCreatedMarker(columns, "participant", (x) => x.uid)}
              rowId={(x) => x.uid}
              fullWidth
              variant={LIST_TABLE_VARIANT}
              rowOrdering={{ enableDragAndDrop: true }}
              rowOrder={layer.participants}
              onRowOrderChange={(order) => onChange({ ...layer, participants: order })}
            >
              <DataTable.RowActions>
                {(row) => (
                  <IconButton
                    size="condensed"
                    label="Remove"
                    icon={<XmarkIcon />}
                    onClick={() => onChange({ ...layer, participants: layer.participants.filter((u) => u !== (row as { uid: string }).uid) })}
                  />
                )}
              </DataTable.RowActions>
            </DataTable>
            <FieldHint>{rows.length > 1 ? "They take turns in this order. Drag a row to change the order." : "Add a second person to make it a rotation."}</FieldHint>
          </>
        ) : (
          <Text textStyle="small">Nobody yet. Add at least one person.</Text>
        )}
        {candidates.length > 0 && (
          <Flex gap={4} alignItems="center" flexWrap="wrap">
            <Text textStyle="small">Add from the team:</Text>
            {candidates.map((uid) => (
              <Button key={uid} size="condensed" onClick={() => add(uid)}>
                <Button.Prefix>
                  <PlusIcon />
                </Button.Prefix>
                {userName(uid)}
              </Button>
            ))}
          </Flex>
        )}
        <FormField>
          <Label>{teamUids.length ? "Add someone else" : "Add a person"}</Label>
          {/* Selecting a person adds them at once; the key resets the picker for the next one. */}
          <UserPicker key={layer.participants.length} value={null} onChange={(u) => u && add(u)} exclude={layer.participants} />
        </FormField>
      </Flex>
      <FormField required>
        <Label>Rotation type</Label>
        <ToggleButtonGroup
          value={layer.rotation.type}
          onChange={(v: string) =>
            onChange({
              ...layer,
              rotation: v === "custom" ? { type: "custom", lengthHours: layer.rotation.lengthHours ?? 12 } : { type: v as "daily" | "weekly" },
            })
          }
        >
          <ToggleButtonGroup.Item value="daily">Daily</ToggleButtonGroup.Item>
          <ToggleButtonGroup.Item value="weekly">Weekly</ToggleButtonGroup.Item>
          <ToggleButtonGroup.Item value="custom">Custom</ToggleButtonGroup.Item>
        </ToggleButtonGroup>
      </FormField>
      {layer.rotation.type === "custom" && (
        <FormField required>
          <Label>Shift length (hours)</Label>
          <NumberInput
            value={layer.rotation.lengthHours ?? 12}
            min={1}
            max={672}
            onChange={(v) => onChange({ ...layer, rotation: { type: "custom", lengthHours: v ?? 12 } })}
          />
        </FormField>
      )}
      <Flex flexDirection="column" gap={4}>
        <Flex gap={16} flexWrap="wrap">
          <FormField required>
            <Label>Handoff time</Label>
            <TextInput value={layer.handoffTime} onChange={(v) => onChange({ ...layer, handoffTime: v })} placeholder="HH:mm" />
          </FormField>
          <FormField required>
            <Label>Rotation starts</Label>
            <DateTimePicker
              type="datetime"
              precision="minutes"
              value={msToIso(layer.startsAt)}
              onChange={(v) => {
                const t = pickerToMs(v);
                if (t) onChange({ ...layer, startsAt: t });
              }}
            />
          </FormField>
        </Flex>
        <FieldHint>
          {handoffSentence(layer, timeZone)} {layer.participants[0] ? `${userName(layer.participants[0])} takes the first shift.` : ""}
        </FieldHint>
      </Flex>
      <Switch
        value={restricted}
        onChange={(on) => onChange({ ...layer, restrictions: on ? [r] : undefined })}
      >
        Only during specific hours
      </Switch>
      {restricted && (
        <Flex flexDirection="column" gap={8}>
          <Flex gap={8} flexWrap="wrap">
            {WEEKDAYS.map((d, i) => (
              <Checkbox
                key={d}
                value={r.days.includes(i)}
                onChange={(c) =>
                  onChange({
                    ...layer,
                    restrictions: [{ ...r, days: c ? [...r.days, i].sort() : r.days.filter((x) => x !== i) }],
                  })
                }
              >
                {d}
              </Checkbox>
            ))}
          </Flex>
          <Flex gap={16}>
            <FormField>
              <Label>From</Label>
              <TextInput value={r.from} onChange={(v) => onChange({ ...layer, restrictions: [{ ...r, from: v }] })} placeholder="HH:mm" />
            </FormField>
            <FormField>
              <Label>To</Label>
              <TextInput value={r.to} onChange={(v) => onChange({ ...layer, restrictions: [{ ...r, to: v }] })} placeholder="HH:mm" />
            </FormField>
          </Flex>
          <FieldHint>Outside these hours this layer covers nobody: add another layer for the remaining hours, or accept the gap.</FieldHint>
        </Flex>
      )}
      {showLayerControls && (
        <Flex gap={8} flexWrap="wrap">
          <Button onClick={onDuplicate}>Duplicate layer</Button>
          <Button color="critical" onClick={onRemove}>
            Delete layer
          </Button>
        </Flex>
      )}
    </Flex>
  );
};

export const ScheduleEditorPage = () => {
  const { id = "new" } = useParams();
  const [search] = useSearchParams();
  const presetTeam = search.get("teamId") ?? undefined;
  /** Only in-app paths, so a crafted link can't send the user elsewhere. */
  const returnTo = (() => {
    const r = search.get("returnTo");
    return r && r.startsWith("/") && !r.startsWith("//") ? r : undefined;
  })();
  const navigate = useNavigate();
  const { data, isLoading, error, refresh, now, mutate, userName } = useAppData();
  const existing = data?.schedules.find((s) => s.id === id);
  const isNew = id === "new";
  const [draft, setDraft] = useState<Schedule>();
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tried, setTried] = useState(false);
  const [weeks, setWeeks] = useState("2");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [deleteLayer, setDeleteLayer] = useState<number>();
  const [expanded, setExpanded] = useState<(string | number)[]>([]);
  const [preview, setPreview] = useState<Schedule>();

  /** People of a team who get paged (responders and team admins), in team order. */
  const pagedOf = (teamId: string | undefined): string[] =>
    (data?.teams.find((t) => t.id === teamId)?.members ?? []).filter((m) => m.role !== "observer").map((m) => m.uid);
  const defaultName = (teamId: string | undefined): string => {
    const team = data?.teams.find((t) => t.id === teamId);
    return team ? `${team.name} on-call` : "";
  };

  useEffect(() => {
    if (draft || !data) return;
    const tz = data.settings.ui.timeZone ?? browserTimeZone();
    const teamId = presetTeam ?? data.teams[0]?.id;
    // A new schedule starts ready to save: named after its team, with the team's paged people in the rotation.
    const base: Schedule =
      existing ??
      ({
        schemaVersion: SCHEMA_VERSION,
        id: newId("schedule"),
        name: defaultName(teamId),
        teamId,
        timeZone: tz,
        rev: 0,
        layers: [newLayer(0, now, tz, pagedOf(teamId))],
        overrides: [],
      } satisfies Schedule);
    setDraft(base);
    setExpanded(base.layers.slice(0, 1).map((l) => l.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, existing, draft, now, presetTeam]);

  // Debounced coverage preview (300 ms).
  useEffect(() => {
    const t = window.setTimeout(() => setPreview(draft), 300);
    return () => window.clearTimeout(t);
  }, [draft]);

  const update = (s: Schedule) => {
    setDraft(s);
    setDirty(true);
  };
  const errors = useMemo(() => (draft ? validateSchedule(draft, { teams: data?.teams }) : []), [draft, data]);
  const from = now;
  const to = now + Number(weeks) * 7 * DAY;
  const cov = useMemo(() => (preview ? coverage(preview, from, to) : undefined), [preview, from, to]);
  const zones = useMemo(() => timeZones(), []);

  if (!draft || isLoading)
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
          <SimpleEmpty title="Schedule not found" actions={<Button onClick={() => navigate("/on-call?tab=schedules")}>Back to schedules</Button>} />
        </Flex>
      </PageLayout.Content>
    );

  const save = () => {
    setTried(true);
    if (errors.length) return;
    setSaving(true);
    if (isNew) markCreated("schedule", draft.id);
    mutate((s) => s.saveSchedule(nextRev(draft)), isNew ? "Schedule created" : "Schedule saved")
      .then(() => {
        setDirty(false);
        navigate(returnTo ?? "/on-call?tab=schedules");
      })
      .catch(() => undefined)
      .finally(() => setSaving(false));
  };
  const setLayer = (i: number, l: RotationLayer) => update({ ...draft, layers: draft.layers.map((x, j) => (j === i ? l : x)) });
  const copyLayer = (l: RotationLayer): RotationLayer => {
    const c = { ...l, id: newId(`layer${draft.layers.length + 1}`), name: `${l.name} (copy)` };
    markCreated("layer", c.id);
    return c;
  };
  const gapHours = cov ? cov.gaps.reduce((a, g) => a + (g.to - g.from), 0) : 0;
  const hasMembers = draft.layers.some((l) => l.participants.length > 0);
  const single = draft.layers.length === 1;
  const teamUids = pagedOf(draft.teamId);
  /** While a new schedule still has its suggested name and people, they follow the chosen team. */
  const changeTeam = (teamId: string | undefined) => {
    const first = draft.layers[0];
    const untouchedPeople = isNew && single && !!first && JSON.stringify(first.participants) === JSON.stringify(pagedOf(draft.teamId));
    const untouchedName = isNew && draft.name === defaultName(draft.teamId);
    update({
      ...draft,
      teamId,
      name: untouchedName ? defaultName(teamId) : draft.name,
      layers: untouchedPeople && first ? [{ ...first, participants: pagedOf(teamId) }] : draft.layers,
    });
  };
  // The next handoffs as text: who is on call from when, straight from the schedule logic.
  const upcoming = preview ? scheduleTimeline(preview, from, to).slice(0, 8) : [];
  const layerEditor = (l: RotationLayer, i: number) => (
    <LayerEditor
      layer={l}
      timeZone={draft.timeZone}
      teamUids={teamUids}
      showLayerControls={!single}
      onChange={(nl) => setLayer(i, nl)}
      onRemove={() => setDeleteLayer(i)}
      onDuplicate={() => update({ ...draft, layers: [...draft.layers, copyLayer(l)] })}
    />
  );

  return (
    <PageLayout.Content>
      <Flex flexDirection="column" gap={16} padding={16}>
        <PageTitle
          crumbs={[
            { label: "On-call", to: "/on-call" },
            { label: "Schedules", to: "/on-call?tab=schedules" },
            { label: draft.name || "New schedule" },
          ]}
          title={draft.name || "New schedule"}
          subtitle="Who is on call, and when they hand over to the next person"
          action={
            <Flex gap={8}>
              <Button onClick={() => (dirty ? setConfirmDiscard(true) : navigate(returnTo ?? "/on-call?tab=schedules"))}>Cancel</Button>
              <Button color="primary" variant="accent" loading={saving} onClick={save}>
                Save
              </Button>
            </Flex>
          }
        />
        {tried && errors.length > 0 && (
          <MessageContainer variant="critical">
            <MessageContainer.Title>To save this schedule:</MessageContainer.Title>
            <MessageContainer.Description>
              {[...new Set(describeErrors(draft, errors))].map((m) => `· ${m}`).join("  ")}
            </MessageContainer.Description>
          </MessageContainer>
        )}
        <Grid gridTemplateColumns="minmax(360px, 480px) minmax(0, 1fr)" gap={24}>
          <Flex flexDirection="column" gap={24}>
            <FieldSet>
              <FieldSet.Legend>Schedule</FieldSet.Legend>
              <Flex flexDirection="column" gap={16}>
                <FormField required>
                  <Label>Name</Label>
                  <TextInput value={draft.name} onChange={(v) => update({ ...draft, name: v })} placeholder="For example: Payments on-call" />
                </FormField>
                <FormField required>
                  <Label>Team</Label>
                  <Select value={draft.teamId ?? null} onChange={(v) => changeTeam(v ?? undefined)}>
                    <Select.Content>
                      {(data?.teams ?? []).map((t) => (
                        <Select.Option key={t.id} value={t.id}>
                          {t.name}
                        </Select.Option>
                      ))}
                    </Select.Content>
                  </Select>
                </FormField>
                <FormField required>
                  <Label>Time zone</Label>
                  <Select value={draft.timeZone} onChange={(v) => v && update({ ...draft, timeZone: v })}>
                    <Select.Filter />
                    <Select.Content>
                      {zones.map((z) => (
                        <Select.Option key={z} value={z}>
                          {z}
                        </Select.Option>
                      ))}
                    </Select.Content>
                  </Select>
                  <FieldHint>Handoff times and restrictions use this zone, including daylight saving changes</FieldHint>
                </FormField>
              </Flex>
            </FieldSet>
            <Flex flexDirection="column" gap={8}>
              <Heading level={4}>{single ? "Rotation" : "Layers"}</Heading>
              {single ? (
                draft.layers.map((l, i) => <React.Fragment key={l.id}>{layerEditor(l, i)}</React.Fragment>)
              ) : (
                <>
                  <FieldHint>Layers stack: where their hours overlap, the layer further down the list is the one on call.</FieldHint>
                  <Accordion multiple showDividers expanded={expanded} onExpandChange={(v) => setExpanded(v)}>
                    {draft.layers.map((l, i) => (
                      <Accordion.Section key={l.id} id={l.id}>
                        <Accordion.SectionLabel>
                          <Flex flexDirection="column" gap={0}>
                            <CreatedMarker kind="layer" id={l.id} />
                            <Text textStyle="base-emphasized">
                              Layer {i + 1} · {l.name || "Unnamed"}
                            </Text>
                            <Text textStyle="small">{rotationSummary(l, draft.timeZone)}</Text>
                          </Flex>
                        </Accordion.SectionLabel>
                        <Accordion.SectionContent>{layerEditor(l, i)}</Accordion.SectionContent>
                      </Accordion.Section>
                    ))}
                  </Accordion>
                </>
              )}
              <Flex flexDirection="column" gap={4}>
                <Flex>
                  <Button
                    onClick={() => {
                      const l = newLayer(draft.layers.length, now, draft.timeZone);
                      markCreated("layer", l.id);
                      update({ ...draft, layers: [...draft.layers, l] });
                      setExpanded((e) => [...e, l.id]);
                    }}
                  >
                    <Button.Prefix>
                      <PlusIcon />
                    </Button.Prefix>
                    Add layer
                  </Button>
                </Flex>
                {single && <FieldHint>Optional: a second rotation for certain hours, for example nights or weekends.</FieldHint>}
              </Flex>
            </Flex>
          </Flex>
          <Surface padding={16}>
            <Flex flexDirection="column" gap={12}>
              <Flex alignItems="center" justifyContent="space-between" gap={8} flexWrap="wrap">
                <Heading level={3}>Coverage preview</Heading>
                <ToggleButtonGroup value={weeks} onChange={(v: string) => setWeeks(v)}>
                  <ToggleButtonGroup.Item value="1">1 week</ToggleButtonGroup.Item>
                  <ToggleButtonGroup.Item value="2">2 weeks</ToggleButtonGroup.Item>
                  <ToggleButtonGroup.Item value="4">4 weeks</ToggleButtonGroup.Item>
                </ToggleButtonGroup>
              </Flex>
              {!hasMembers ? (
                <SimpleEmpty size="small" title="Add members to preview coverage" />
              ) : (
                <>
                  {cov && cov.gaps.length === 0 ? (
                    <Health status="ideal">Full coverage</Health>
                  ) : (
                    <Health status="warning">
                      {plural(cov?.gaps.length ?? 0, "gap")}, {formatDuration(gapHours)} uncovered in the next {plural(Number(weeks), "week")}
                    </Health>
                  )}
                  {preview && <ShiftGantt schedules={[preview]} from={from} to={to} now={now} draft />}
                  {upcoming.length > 0 && (
                    <Flex flexDirection="column" gap={4}>
                      <Text textStyle="base-emphasized">Who is on call, from when</Text>
                      {upcoming.map((seg, i) => (
                        <Text key={`${seg.from}-${seg.uid}`}>
                          {i === 0 && seg.from <= now ? "Now" : formatDayDateTime(seg.from, draft.timeZone)} · {userName(seg.uid)}
                          {seg.source === "override" ? " (override)" : ""}
                        </Text>
                      ))}
                      <FieldHint>Times in {draft.timeZone}.</FieldHint>
                    </Flex>
                  )}
                </>
              )}
            </Flex>
          </Surface>
        </Grid>
      </Flex>
      <ConfirmModal
        show={confirmDiscard}
        title="Discard unsaved changes?"
        confirmLabel="Discard"
        onDismiss={() => setConfirmDiscard(false)}
        onConfirm={() => navigate(returnTo ?? "/on-call?tab=schedules")}
      >
        Your changes to this schedule will be lost.
      </ConfirmModal>
      <ConfirmModal
        show={deleteLayer !== undefined}
        title={`Delete layer ${deleteLayer !== undefined ? deleteLayer + 1 : ""}?`}
        onDismiss={() => setDeleteLayer(undefined)}
        onConfirm={() => {
          if (deleteLayer === undefined) return;
          update({ ...draft, layers: draft.layers.filter((_, j) => j !== deleteLayer) });
        }}
      >
        The layer and its rotation are removed when you save the schedule.
      </ConfirmModal>
    </PageLayout.Content>
  );
};

