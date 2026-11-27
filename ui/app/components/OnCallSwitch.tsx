/** "Go off call / take the shift" from the header: creates a schedule override on the person's behalf. */
import { markCreated } from "./NewItemHighlight";
import React, { useMemo, useState } from "react";
import { Button } from "@dynatrace/strato-components/buttons";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Modal } from "@dynatrace/strato-components/overlays";
import { FormField, Label, Select } from "@dynatrace/strato-components/forms";
import { Text } from "@dynatrace/strato-components/typography";
import type { Schedule } from "../domain/contracts";
import { nextRev, useAppData } from "../hooks/AppDataContext";
import { newId, onCallAt, onCallNowAndNext } from "../hooks/domain";
import { formatDayTime, zoneAbbr } from "./format";

const EIGHT_HOURS = 8 * 3_600_000;

/** Everyone who takes part in a schedule (layer participants and override people), in order, without duplicates. */
export function scheduleParticipants(s: Schedule): string[] {
  return [...new Set([...s.layers.flatMap((l) => l.participants), ...s.overrides.map((o) => o.uid)])];
}

/**
 * Who should take over when `me` leaves the on-call shift: the next person the schedule hands over to,
 * else the first other participant.
 */
export function suggestReplacement(s: Schedule, me: string, now: number): string | undefined {
  const { next } = onCallNowAndNext(s, now);
  if (next && next.uid !== me) return next.uid;
  return scheduleParticipants(s).find((u) => u !== me);
}

/** Which switch was asked for and on which schedules. */
export type OnCallSwitchRequest = { mode: "off" | "on"; scheduleIds: string[] };

/**
 * Leave the on-call shift now (hand over to someone until the shift ends) or take it now (until the
 * current shift ends, or 8 hours when nobody is on call). Both create a schedule override, the same
 * mechanism the escalation engine already resolves.
 */
export const OnCallSwitchModal = ({ request, onClose }: { request: OnCallSwitchRequest; onClose: () => void }) => {
  const { data, mutate, userName, currentUser, now } = useAppData();
  const me = currentUser.uid;
  const schedules = useMemo(
    () => (data?.schedules ?? []).filter((s) => request.scheduleIds.includes(s.id)),
    [data, request.scheduleIds],
  );
  const [picked, setPicked] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(schedules.map((s) => [s.id, request.mode === "off" ? (suggestReplacement(s, me, now) ?? null) : me])),
  );
  const [busy, setBusy] = useState(false);

  const plan = schedules.map((s) => {
    const oc = onCallAt(s, now);
    const until = oc ? oc.to : now + EIGHT_HOURS;
    return { s, until, uid: picked[s.id] ?? undefined };
  });
  const valid = plan.every((p) => p.uid && p.until > now);

  const save = () => {
    if (!valid) return;
    setBusy(true);
    mutate(
      async (store) => {
        for (const p of plan) {
          const o = { id: newId("ovr"), uid: p.uid as string, from: now, to: p.until, note: request.mode === "off" ? "Left on-call from the header" : "Took on-call from the header" };
          markCreated("override", o.id);
          await store.saveSchedule(nextRev({ ...p.s, overrides: [...p.s.overrides, o] }));
        }
      },
      request.mode === "off" ? "You're off call" : "You're on call now",
    )
      .then(onClose)
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };

  return (
    <Modal
      title={request.mode === "off" ? "Leave on-call now" : "Take on-call now"}
      show
      onDismiss={onClose}
      footer={
        <Flex justifyContent="flex-end" gap={8}>
          <Button onClick={onClose}>Cancel</Button>
          <Button color="primary" variant="accent" loading={busy} disabled={!valid} onClick={save}>
            {request.mode === "off" ? "Hand over and go off call" : "Go on call"}
          </Button>
        </Flex>
      }
    >
      <Flex flexDirection="column" gap={16}>
        <Text>
          {request.mode === "off"
            ? "Pages stop reaching you immediately. Choose who covers the rest of your shift."
            : "You start receiving pages immediately, until the current shift ends."}
        </Text>
        {plan.map(({ s, until }) => (
          <FormField key={s.id} required>
            <Label>
              {s.name} · until {formatDayTime(until, s.timeZone)} {zoneAbbr(until, s.timeZone)}
            </Label>
            {request.mode === "off" ? (
              <Select value={picked[s.id] ?? null} onChange={(v) => setPicked((p) => ({ ...p, [s.id]: v }))}>
                <Select.Content>
                  {scheduleParticipants(s)
                    .filter((u) => u !== me)
                    .map((u) => (
                      <Select.Option key={u} value={u}>
                        {userName(u)}
                      </Select.Option>
                    ))}
                </Select.Content>
              </Select>
            ) : (
              <Text>{userName(me)}</Text>
            )}
          </FormField>
        ))}
      </Flex>
    </Modal>
  );
};
