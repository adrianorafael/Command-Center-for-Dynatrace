/** Quiet hours tab of the team detail page. */
import { CreatedMarker, markCreated } from "../../components/NewItemHighlight";
import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@dynatrace/strato-components/buttons";
import { Flex, Surface } from "@dynatrace/strato-components/layouts";
import { MessageContainer } from "@dynatrace/strato-components/content";
import { Checkbox, FormField, Label, Radio, RadioGroup, Select, TextInput } from "@dynatrace/strato-components/forms";
import { Paragraph, Text } from "@dynatrace/strato-components/typography";
import { PlusIcon, XmarkIcon } from "@dynatrace/strato-icons";
import { PRIORITIES, type Priority, type QuietHours, type Team } from "../../domain/contracts";
import { useAppData, nextRev } from "../../hooks/AppDataContext";
import { validateTeam } from "../../hooks/domain";
import { IconButton } from "../../components/IconButton";
import { FieldHint } from "../../components/FieldHint";
import { browserTimeZone, timeZones } from "../../components/format";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Team quiet hours (Team.quietHours): hold or downgrade less urgent incidents in a window. */
export const QuietHoursEditor = ({ team }: { team: Team }) => {
  const { data, mutate } = useAppData();
  const [list, setList] = useState<QuietHours[]>(team.quietHours ?? []);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const zones = useMemo(() => timeZones(), []);
  useEffect(() => setList(team.quietHours ?? []), [team]);

  const draft: Team = { ...team, quietHours: list.length ? list : undefined };
  const errors = validateTeam(draft).filter((e) => e.path.startsWith("quietHours"));
  const dirty = JSON.stringify(list) !== JSON.stringify(team.quietHours ?? []);
  const set = (i: number, q: QuietHours) => setList(list.map((x, j) => (j === i ? q : x)));
  const save = () => {
    setTried(true);
    if (errors.length) return;
    setBusy(true);
    mutate((s) => s.saveTeam(nextRev(draft)), "Quiet hours saved")
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };

  return (
    <Flex flexDirection="column" gap={16} style={{ maxWidth: 720 }}>
      <Paragraph>
        During quiet hours, incidents less urgent than the chosen priority are either held (no paging until the window ends) or paged with low-urgency
        channels only. More urgent incidents always page.
      </Paragraph>
      {tried && errors.length > 0 && (
        <MessageContainer variant="critical">
          <MessageContainer.Title>To save the quiet hours:</MessageContainer.Title>
          <MessageContainer.Description>
            {errors
              .map((e) => {
                const m = /^quietHours\[(\d+)\]\.?(\w*)/.exec(e.path);
                return `· Window ${m ? Number(m[1]) + 1 : ""}${m?.[2] ? ` (${m[2]})` : ""}: ${e.message}`;
              })
              .join("  ")}
          </MessageContainer.Description>
        </MessageContainer>
      )}
      {list.length === 0 && <Text>No quiet hours. Every incident pages according to the escalation policy.</Text>}
      {list.map((q, i) => (
        <Surface key={i} padding={16}>
          <Flex flexDirection="column" gap={12}>
            <CreatedMarker kind="quiet" id={`${team.id}.${i}`} />
            <Flex justifyContent="space-between" alignItems="center">
              <Text textStyle="base-emphasized">Window {i + 1}</Text>
              <IconButton label="Remove window" icon={<XmarkIcon />} onClick={() => setList(list.filter((_, j) => j !== i))} />
            </Flex>
            <Flex gap={8} flexWrap="wrap">
              {WEEKDAYS.map((d, k) => (
                <Checkbox
                  key={d}
                  value={q.days.includes(k)}
                  onChange={(c) => set(i, { ...q, days: c ? [...q.days, k].sort() : q.days.filter((x) => x !== k) })}
                >
                  {d}
                </Checkbox>
              ))}
            </Flex>
            <Flex gap={16} flexWrap="wrap">
              <FormField required>
                <Label>From</Label>
                <TextInput value={q.from} onChange={(v) => set(i, { ...q, from: v })} placeholder="HH:mm" />
              </FormField>
              <FormField required>
                <Label>To</Label>
                <TextInput value={q.to} onChange={(v) => set(i, { ...q, to: v })} placeholder="HH:mm" />
                <FieldHint>May be earlier than From (crosses midnight)</FieldHint>
              </FormField>
              <FormField required>
                <Label>Time zone</Label>
                <Select value={q.timeZone} onChange={(v) => v && set(i, { ...q, timeZone: v })}>
                  <Select.Filter />
                  <Select.Content>
                    {zones.map((z) => (
                      <Select.Option key={z} value={z}>
                        {z}
                      </Select.Option>
                    ))}
                  </Select.Content>
                </Select>
              </FormField>
            </Flex>
            <FormField required>
              <Label>Applies to incidents less urgent than</Label>
              <Select value={q.minPriority} onChange={(v) => v && set(i, { ...q, minPriority: v as Priority })}>
                <Select.Content>
                  {PRIORITIES.map((p) => (
                    <Select.Option key={p} value={p}>
                      {p}
                    </Select.Option>
                  ))}
                </Select.Content>
              </Select>
            </FormField>
            <FormField required>
              <Label>During the window</Label>
              <RadioGroup value={q.mode} onChange={(v) => set(i, { ...q, mode: v as QuietHours["mode"] })}>
                <Radio value="hold">Hold: don't page until the window ends</Radio>
                <Radio value="low-urgency">Low urgency: page with low-urgency channels only</Radio>
              </RadioGroup>
            </FormField>
          </Flex>
        </Surface>
      ))}
      <Flex gap={8} alignItems="center">
        <Button
          onClick={() => {
            markCreated("quiet", `${team.id}.${list.length}`);
            setList([
              ...list,
              { timeZone: data?.settings.ui.timeZone ?? browserTimeZone(), days: [1, 2, 3, 4, 5], from: "22:00", to: "07:00", minPriority: "P2", mode: "hold" },
            ]);
          }}
        >
          <Button.Prefix>
            <PlusIcon />
          </Button.Prefix>
          Add window
        </Button>
        <Button color="primary" variant="accent" disabled={!dirty} loading={busy} onClick={save}>
          Save
        </Button>
        {dirty && <Text textStyle="small">Unsaved changes</Text>}
      </Flex>
    </Flex>
  );
};
