import React, { useEffect, useState } from "react";
import { Button } from "@dynatrace/strato-components/buttons";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Modal } from "@dynatrace/strato-components/overlays";
import { DateTimePicker, FormField, Label, Radio, RadioGroup, Select, TextArea } from "@dynatrace/strato-components/forms";
import { Paragraph, Text } from "@dynatrace/strato-components/typography";
import { PRIORITIES, type Priority } from "../../domain/contracts";
import { useAppData } from "../../hooks/AppDataContext";
import { PRIORITY_MEANING, PriorityChip } from "../../components/PriorityChip";
import { msToIso, pickerToMs } from "../../components/format";

export type ModalKind = "reassign" | "snooze" | "priority" | "note" | "resolve-many";

export interface ModalRequest {
  kind: ModalKind;
  ids: string[];
}

const Footer = ({ onCancel, onSubmit, label, busy, disabled }: { onCancel: () => void; onSubmit: () => void; label: string; busy: boolean; disabled?: boolean }) => (
  <Flex justifyContent="flex-end" gap={8}>
    <Button onClick={onCancel}>Cancel</Button>
    <Button color="primary" variant="accent" loading={busy} disabled={disabled} onClick={onSubmit}>
      {label}
    </Button>
  </Flex>
);

/** Reassign / custom snooze / change priority / add note / bulk-resolve confirm (DESIGN §5.4). */
export const ActionModals = ({ request, onClose }: { request?: ModalRequest; onClose: () => void }) => {
  const { data, act, users, userName, setPaused, now } = useAppData();
  const [busy, setBusy] = useState(false);
  const [assignee, setAssignee] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [until, setUntil] = useState<number | undefined>();
  const [priority, setPriority] = useState<Priority>("P3");

  const show = !!request;
  useEffect(() => {
    setPaused(show);
    if (show) {
      setNote("");
      setAssignee(null);
      setUntil(now + 3_600_000);
      const first = data?.incidents.find((i) => i.id === request?.ids[0]);
      setPriority(first?.priority ?? "P3");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  if (!request) return null;
  const n = request.ids.length;
  const suffix = n > 1 ? ` (${n} incidents)` : "";

  const run = (fn: () => Promise<unknown>) => {
    setBusy(true);
    fn()
      .then(onClose)
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };

  const withNote = async () => {
    if (note.trim()) await act(request.ids, { type: "note", text: note.trim() }, { silent: true });
  };

  if (request.kind === "reassign") {
    const people = [...users.values()].filter((u) => u.uid !== "me").sort((a, b) => a.name.localeCompare(b.name));
    return (
      <Modal
        title={`Reassign${suffix}`}
        show
        onDismiss={onClose}
        footer={
          <Footer
            label="Reassign"
            busy={busy}
            disabled={!assignee}
            onCancel={onClose}
            onSubmit={() =>
              run(async () => {
                if (!assignee) return;
                const [type, id] = assignee.split(":") as ["user" | "team", string];
                await act(request.ids, { type: "reassign", assignee: { type, id } });
                await withNote();
              })
            }
          />
        }
      >
        <Flex flexDirection="column" gap={16}>
          <FormField required>
            <Label>Assign to</Label>
            <Select value={assignee} onChange={(v) => setAssignee(v)}>
              <Select.Filter />
              <Select.Content>
                <Select.Group>
                  <Select.GroupLabel>Teams</Select.GroupLabel>
                  {(data?.teams ?? []).map((t) => (
                    <Select.Option key={t.id} value={`team:${t.id}`}>
                      {t.name}
                    </Select.Option>
                  ))}
                </Select.Group>
                <Select.Group>
                  <Select.GroupLabel>People</Select.GroupLabel>
                  {people.map((u) => (
                    <Select.Option key={u.uid} value={`user:${u.uid}`}>
                      {userName(u.uid)}
                    </Select.Option>
                  ))}
                </Select.Group>
              </Select.Content>
            </Select>
          </FormField>
          <FormField>
            <Label>Note (optional)</Label>
            <TextArea value={note} onChange={(v) => setNote(v)} />
          </FormField>
        </Flex>
      </Modal>
    );
  }

  if (request.kind === "snooze") {
    const invalid = !until || until <= now;
    return (
      <Modal
        title={`Snooze${suffix}`}
        show
        onDismiss={onClose}
        footer={
          <Footer
            label="Snooze"
            busy={busy}
            disabled={invalid}
            onCancel={onClose}
            onSubmit={() =>
              run(async () => {
                if (!until) return;
                await act(request.ids, { type: "snooze", until });
                await withNote();
              })
            }
          />
        }
      >
        <Flex flexDirection="column" gap={16}>
          <FormField required>
            <Label>Snooze until</Label>
            <DateTimePicker type="datetime" value={msToIso(until)} onChange={(v) => setUntil(pickerToMs(v))} />
          </FormField>
          {invalid && <Text textStyle="small">Choose a time in the future.</Text>}
          <Paragraph>The incident re-triggers and escalation resumes at that time.</Paragraph>
          <FormField>
            <Label>Note (optional)</Label>
            <TextArea value={note} onChange={(v) => setNote(v)} />
          </FormField>
        </Flex>
      </Modal>
    );
  }

  if (request.kind === "priority") {
    return (
      <Modal
        title={`Change priority${suffix}`}
        show
        onDismiss={onClose}
        footer={
          <Footer
            label="Change priority"
            busy={busy}
            onCancel={onClose}
            onSubmit={() => run(() => act(request.ids, { type: "priority", priority }))}
          />
        }
      >
        <FormField required>
          <Label>Priority</Label>
          <RadioGroup value={priority} onChange={(v) => setPriority(v as Priority)}>
            {PRIORITIES.map((p) => (
              <Radio key={p} value={p}>
                <Flex gap={8} alignItems="center">
                  <PriorityChip priority={p} size="condensed" />
                  <Text>{PRIORITY_MEANING[p]}</Text>
                </Flex>
              </Radio>
            ))}
          </RadioGroup>
        </FormField>
      </Modal>
    );
  }

  if (request.kind === "resolve-many") {
    return (
      <Modal
        title={`Resolve ${n} incidents?`}
        show
        size="small"
        onDismiss={onClose}
        footer={
          <Footer label="Resolve" busy={busy} onCancel={onClose} onSubmit={() => run(() => act(request.ids, { type: "resolve" }))} />
        }
      >
        <Paragraph>Escalations stop and responders are notified that the incidents are resolved.</Paragraph>
      </Modal>
    );
  }

  return (
    <Modal
      title={`Add note${suffix}`}
      show
      onDismiss={onClose}
      footer={
        <Footer
          label="Add note"
          busy={busy}
          disabled={!note.trim()}
          onCancel={onClose}
          onSubmit={() => run(() => act(request.ids, { type: "note", text: note.trim() }))}
        />
      }
    >
      <FormField required>
        <Label>Note</Label>
        <TextArea value={note} onChange={(v) => setNote(v)} />
      </FormField>
    </Modal>
  );
};
