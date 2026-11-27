/** Dialog that creates a schedule override. */
import { markCreated } from "../../components/NewItemHighlight";
import React, { useEffect, useState } from "react";
import { Button } from "@dynatrace/strato-components/buttons";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Modal } from "@dynatrace/strato-components/overlays";
import { MessageContainer } from "@dynatrace/strato-components/content";
import { DateTimePicker, FormField, Label, Select, TextInput } from "@dynatrace/strato-components/forms";
import { useAppData, nextRev } from "../../hooks/AppDataContext";
import { newId, onCallAt } from "../../hooks/domain";
import { FieldError } from "../../components/FieldHint";
import { UserPicker } from "../../components/UserPicker";
import { formatDayTime, formatDuration, msToIso, pickerToMs, zoneAbbr } from "../../components/format";

/**
 * New override (DESIGN §6.3). The contract's ScheduleOverride has no layer, so an override
 * covers the whole schedule (it wins over every layer); the "covers for" person is derived.
 */
export const OverrideModal = ({ request, onClose }: { request?: { scheduleId?: string }; onClose: () => void }) => {
  const { data, mutate, userName, setPaused, now } = useAppData();
  const [scheduleId, setScheduleId] = useState<string | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [from, setFrom] = useState<number | undefined>();
  const [to, setTo] = useState<number | undefined>();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const show = !!request;

  useEffect(() => {
    setPaused(show);
    if (show) {
      const start = Math.ceil(now / 3_600_000) * 3_600_000;
      setScheduleId(request?.scheduleId ?? data?.schedules[0]?.id ?? null);
      setUid(null);
      setFrom(start);
      setTo(start + 8 * 3_600_000);
      setNote("");
      setTried(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  if (!request) return null;
  const schedule = data?.schedules.find((s) => s.id === scheduleId);
  const tz = schedule?.timeZone;
  const covered = schedule && from ? onCallAt({ ...schedule, overrides: [] }, from) : undefined;
  const errors = {
    schedule: !schedule ? "Choose a schedule." : undefined,
    uid: !uid ? "Choose who covers." : undefined,
    time: !from || !to ? "Choose a start and an end." : to <= from ? "Add an end time after the start time." : undefined,
  };
  const valid = !errors.schedule && !errors.uid && !errors.time;

  const save = () => {
    setTried(true);
    if (!valid || !schedule || !uid || !from || !to) return;
    setBusy(true);
    const o = { id: newId("ovr"), uid, from, to, ...(note.trim() ? { note: note.trim() } : {}) };
    markCreated("override", o.id);
    mutate((s) => s.saveSchedule(nextRev({ ...schedule, overrides: [...schedule.overrides, o] })), "Override created")
      .then(onClose)
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };

  return (
    <Modal
      title="New override"
      show
      onDismiss={onClose}
      footer={
        <Flex justifyContent="flex-end" gap={8}>
          <Button onClick={onClose}>Cancel</Button>
          <Button color="primary" variant="accent" loading={busy} onClick={save}>
            Create override
          </Button>
        </Flex>
      }
    >
      <Flex flexDirection="column" gap={16}>
        <FormField required>
          <Label>Schedule</Label>
          <Select value={scheduleId} onChange={(v) => setScheduleId(v)}>
            <Select.Content>
              {(data?.schedules ?? []).map((s) => (
                <Select.Option key={s.id} value={s.id}>
                  {s.name}
                </Select.Option>
              ))}
            </Select.Content>
          </Select>
          {tried && errors.schedule && <FieldError>{errors.schedule}</FieldError>}
        </FormField>
        <FormField required>
          <Label>Who covers</Label>
          <UserPicker value={uid} onChange={(u) => setUid(u)} suggested={schedule?.layers.flatMap((l) => l.participants) ?? []} />
          {tried && errors.uid && <FieldError>{errors.uid}</FieldError>}
        </FormField>
        <Flex gap={16} flexWrap="wrap">
          <FormField required>
            <Label>From</Label>
            <DateTimePicker type="datetime" value={msToIso(from)} onChange={(v) => setFrom(pickerToMs(v))} />
          </FormField>
          <FormField required>
            <Label>To</Label>
            <DateTimePicker type="datetime" value={msToIso(to)} onChange={(v) => setTo(pickerToMs(v))} />
          </FormField>
        </Flex>
        {tried && errors.time && (
          <MessageContainer variant="critical">
            <MessageContainer.Description>{errors.time}</MessageContainer.Description>
          </MessageContainer>
        )}
        <FormField>
          <Label>Reason</Label>
          <TextInput value={note} onChange={(v) => setNote(v)} placeholder="For example: vacation" />
        </FormField>
        {uid && from && to && to > from && schedule && (
          <MessageContainer variant="neutral">
            <MessageContainer.Description>
              {userName(uid)} will cover {covered ? `for ${userName(covered.uid)} ` : ""}from {formatDayTime(from, tz)} to {formatDayTime(to, tz)}{" "}
              {zoneAbbr(from, tz)} ({formatDuration(to - from)}).
            </MessageContainer.Description>
          </MessageContainer>
        )}
      </Flex>
    </Modal>
  );
};
