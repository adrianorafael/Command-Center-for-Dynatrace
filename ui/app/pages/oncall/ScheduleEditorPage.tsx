import { FieldHint } from "../../components/FieldHint";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
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
  Radio,
  RadioGroup,
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
import { newId, validateSchedule } from "../../hooks/domain";
import { PageTitle } from "../../components/PageTitle";
import { UserPicker } from "../../components/UserPicker";
import { ShiftGantt, coverage } from "../../components/ShiftGantt";
import { Health } from "../../components/StatusIndicator";
import { ConfirmModal } from "../../components/ConfirmModal";
import { IconButton } from "../../components/IconButton";
import { QueryState, SimpleEmpty } from "../../components/QueryState";
import { browserTimeZone, formatDuration, initials, msToIso, pickerToMs, plural, timeZones } from "../../components/format";
import { ContactIcons } from "./OnCallPage";

const DAY = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function newLayer(index: number, now: number): RotationLayer {
  const start = new Date(now);
  start.setHours(9, 0, 0, 0);
  return {
    id: newId(`layer${index + 1}`),
    name: index === 0 ? "Primary" : index === 1 ? "Secondary" : `Layer ${index + 1}`,
    participants: [],
    rotation: { type: "weekly" },
    startsAt: start.getTime(),
    handoffTime: "09:00",
  };
}

function rotationSummary(l: RotationLayer): string {
  const kind = l.rotation.type === "custom" ? `Every ${l.rotation.lengthHours ?? "?"} h` : l.rotation.type === "daily" ? "Daily" : "Weekly";
  const day = l.rotation.type === "weekly" ? `${WEEKDAYS[new Date(l.startsAt).getDay()]} ` : "";
  return `${kind} · ${plural(l.participants.length, "person", "people")} · handoff ${day}${l.handoffTime}`;
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
  index,
  onChange,
  onRemove,
  onDuplicate,
}: {
  layer: RotationLayer;
  index: number;
  onChange: (l: RotationLayer) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}) => {
  const { userName } = useAppData();
  const [pick, setPick] = useState<string | null>(null);
  const restricted = !!layer.restrictions?.length;
  const r = layer.restrictions?.[0] ?? { days: [1, 2, 3, 4, 5], from: "09:00", to: "17:00" };
  const rows = layer.participants.map((uid, i) => ({ uid, pos: i + 1 }));
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
      <FormField required>
        <Label>Layer name</Label>
        <TextInput value={layer.name} onChange={(v) => onChange({ ...layer, name: v })} />
      </FormField>
      <FormField required>
        <Label>Rotation type</Label>
        <RadioGroup
          value={layer.rotation.type}
          onChange={(v) =>
            onChange({
              ...layer,
              rotation: v === "custom" ? { type: "custom", lengthHours: layer.rotation.lengthHours ?? 12 } : { type: v as "daily" | "weekly" },
            })
          }
        >
          <Radio value="daily">Daily</Radio>
          <Radio value="weekly">Weekly</Radio>
          <Radio value="custom">Custom</Radio>
        </RadioGroup>
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
      <Flex gap={16} flexWrap="wrap">
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
          <FieldHint>Weekly handoffs happen on this weekday ({WEEKDAYS[new Date(layer.startsAt).getDay()]}).</FieldHint>
        </FormField>
        <FormField required>
          <Label>Handoff time</Label>
          <TextInput value={layer.handoffTime} onChange={(v) => onChange({ ...layer, handoffTime: v })} placeholder="HH:mm" />
          <FieldHint>24-hour time in the schedule time zone</FieldHint>
        </FormField>
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
        </Flex>
      )}
      <Flex flexDirection="column" gap={8}>
        <Text textStyle="base-emphasized">Participants (in rotation order)</Text>
        <Flex gap={8} alignItems="flex-end">
          <Flex flexGrow={1} flexDirection="column">
            <FormField>
              <Label>Add member</Label>
              <UserPicker value={pick} onChange={(u) => setPick(u)} exclude={layer.participants} />
            </FormField>
          </Flex>
          <Button
            disabled={!pick}
            onClick={() => {
              if (!pick) return;
              onChange({ ...layer, participants: [...layer.participants, pick] });
              setPick(null);
            }}
          >
            <Button.Prefix>
              <PlusIcon />
            </Button.Prefix>
            Add member
          </Button>
        </Flex>
        {rows.length ? (
          <DataTable
            data={rows}
            columns={columns}
            rowId={(x) => x.uid}
            fullWidth
            variant={{ rowDensity: "condensed" }}
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
        ) : (
          <Text textStyle="small">No members yet. Search tenant users above to add the first one.</Text>
        )}
      </Flex>
      <Flex gap={8}>
        <Button onClick={onDuplicate}>Duplicate layer</Button>
        <Button color="critical" onClick={onRemove}>
          Delete layer
        </Button>
        <Text textStyle="small">Layer {index + 1}: later layers take precedence over earlier ones.</Text>
      </Flex>
    </Flex>
  );
};

export const ScheduleEditorPage = () => {
  const { id = "new" } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, error, refresh, now, mutate } = useAppData();
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

  useEffect(() => {
    if (draft || !data) return;
    const tz = data.settings.ui.timeZone ?? browserTimeZone();
    const base: Schedule =
      existing ??
      ({
        schemaVersion: SCHEMA_VERSION,
        id: newId("schedule"),
        name: "",
        teamId: data.teams[0]?.id,
        timeZone: tz,
        rev: 0,
        layers: [newLayer(0, now)],
        overrides: [],
      } satisfies Schedule);
    setDraft(base);
    setExpanded(base.layers.slice(0, 1).map((l) => l.id));
  }, [data, existing, draft, now]);

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
    mutate((s) => s.saveSchedule(nextRev(draft)), isNew ? "Schedule created" : "Schedule saved")
      .then(() => {
        setDirty(false);
        navigate("/on-call?tab=schedules");
      })
      .catch(() => undefined)
      .finally(() => setSaving(false));
  };
  const setLayer = (i: number, l: RotationLayer) => update({ ...draft, layers: draft.layers.map((x, j) => (j === i ? l : x)) });
  const gapHours = cov ? cov.gaps.reduce((a, g) => a + (g.to - g.from), 0) : 0;
  const hasMembers = draft.layers.some((l) => l.participants.length > 0);

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
          subtitle="Layers rotate members; later layers and overrides take precedence"
          action={
            <Flex gap={8}>
              <Button onClick={() => (dirty ? setConfirmDiscard(true) : navigate("/on-call?tab=schedules"))}>Cancel</Button>
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
                  <TextInput value={draft.name} onChange={(v) => update({ ...draft, name: v })} placeholder="For example: Payments primary" />
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
              <Heading level={4}>Layers</Heading>
              <Accordion multiple showDividers expanded={expanded} onExpandChange={(v) => setExpanded(v)}>
                {draft.layers.map((l, i) => (
                  <Accordion.Section key={l.id} id={l.id}>
                    <Accordion.SectionLabel>
                      <Flex flexDirection="column" gap={0}>
                        <Text textStyle="base-emphasized">
                          Layer {i + 1} · {l.name || "Unnamed"}
                        </Text>
                        <Text textStyle="small">{rotationSummary(l)}</Text>
                      </Flex>
                    </Accordion.SectionLabel>
                    <Accordion.SectionContent>
                      <LayerEditor
                        layer={l}
                        index={i}
                        onChange={(nl) => setLayer(i, nl)}
                        onRemove={() => setDeleteLayer(i)}
                        onDuplicate={() =>
                          update({
                            ...draft,
                            layers: [...draft.layers, { ...l, id: newId(`layer${draft.layers.length + 1}`), name: `${l.name} (copy)` }],
                          })
                        }
                      />
                    </Accordion.SectionContent>
                  </Accordion.Section>
                ))}
              </Accordion>
              <Flex>
                <Button
                  onClick={() => {
                    const l = newLayer(draft.layers.length, now);
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
        onConfirm={() => navigate("/on-call?tab=schedules")}
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

