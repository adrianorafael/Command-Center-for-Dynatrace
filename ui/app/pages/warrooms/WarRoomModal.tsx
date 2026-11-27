import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@dynatrace/strato-components/buttons";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Modal } from "@dynatrace/strato-components/overlays";
import { FormField, Label, Select, TextInput } from "@dynatrace/strato-components/forms";
import { Text } from "@dynatrace/strato-components/typography";
import { DeleteIcon, DescriptionIcon, PlusIcon } from "@dynatrace/strato-icons";
import type { Incident } from "../../domain/contracts";
import { validateWarRoom, type WarRoom, type WarRoomLink } from "../../domain/warrooms";
import { useAppData } from "../../hooks/AppDataContext";
import { newId } from "../../hooks/domain";
import { FieldError, FieldHint } from "../../components/FieldHint";
import { NewItemHighlight } from "../../components/NewItemHighlight";
import { notify } from "../../hooks/notifications";
import { errorMessage } from "../../components/format";
import { createPostmortemNotebook, listNotebooks, type NotebookRef } from "../../data/notebooks";

export type WarRoomRequest = { mode: "create"; incidentId?: string } | { mode: "edit"; room: WarRoom };

/** Incidents that probably share a cause with `src`: same root-cause entity, else same service started within 30 minutes. */
export function relatedIncidents(src: Incident, all: readonly Incident[]): Incident[] {
  const rc = src.alert.rootCause?.id ?? src.alert.rootCause?.name;
  return all.filter((i) => {
    if (i.id === src.id || i.status === "resolved") return false;
    const irc = i.alert.rootCause?.id ?? i.alert.rootCause?.name;
    if (rc && irc) return rc === irc;
    // No root cause on one side: same service and started within 30 minutes of each other.
    return !!src.serviceId && i.serviceId === src.serviceId && Math.abs(i.alert.startedAt - src.alert.startedAt) <= 30 * 60_000;
  });
}

const label = (i: Incident) => `#${i.alert.displayId ?? i.id} · ${i.priority} · ${i.alert.title}`;

export const WarRoomModal = ({ request, onClose }: { request: WarRoomRequest; onClose: () => void }) => {
  const { data, mutate, currentUser, now } = useAppData();
  const incidents = data?.incidents ?? [];
  const src = request.mode === "create" && request.incidentId ? incidents.find((i) => i.id === request.incidentId) : undefined;
  const related = useMemo(() => (src ? relatedIncidents(src, incidents) : []), [src, incidents]);

  const initial: WarRoom =
    request.mode === "edit"
      ? request.room
      : {
          schemaVersion: 1,
          id: newId("wr"),
          title: src ? `Bridge: ${src.alert.title}`.slice(0, 120) : "",
          url: "",
          incidentIds: src ? [src.id, ...related.map((r) => r.id)] : [],
          notebooks: [],
          status: "open",
          openedAt: now,
          openedBy: currentUser.uid,
          rev: 0,
        };
  const [room, setRoom] = useState<WarRoom>(initial);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notebooks, setNotebooks] = useState<NotebookRef[]>();
  const [notebookError, setNotebookError] = useState<string>();
  const [creating, setCreating] = useState(false);
  /** Document id of the notebook added by the last click: its row is highlighted. */
  const [justAdded, setJustAdded] = useState<string>();
  useEffect(() => {
    listNotebooks()
      .then(setNotebooks)
      .catch((e: unknown) => setNotebookError(errorMessage(e)));
  }, []);
  const errors = validateWarRoom(room);
  const addNotebook = (n: NotebookRef) => {
    setJustAdded(n.id);
    setRoom((r) =>
      r.notebooks.some((x) => x.documentId === n.id) ? r : { ...r, notebooks: [...r.notebooks, { title: n.name, url: n.url, documentId: n.id }] },
    );
  };
  const createNotebook = () => {
    setCreating(true);
    const ids = room.incidentIds.map((id) => incidents.find((i) => i.id === id)?.alert.displayId).filter((x): x is string => !!x);
    createPostmortemNotebook(room.title.trim() || "War room", ids)
      .then((n) => {
        addNotebook(n);
        notify({ category: "action", type: "success", title: "Post-mortem notebook created", message: n.name });
      })
      .catch((e: unknown) => notify({ category: "error", type: "critical", title: "Couldn't create the notebook", message: errorMessage(e), lifespan: "infinite" }))
      .finally(() => setCreating(false));
  };
  const err = (path: string) => (touched ? errors.find((e) => e.path === path)?.message : undefined);

  // Selectable: open incidents plus any already linked (even if resolved since).
  const options = incidents.filter((i) => i.status !== "resolved" || room.incidentIds.includes(i.id));
  const setNotebook = (i: number, n: WarRoomLink) => setRoom((r) => ({ ...r, notebooks: r.notebooks.map((x, j) => (j === i ? n : x)) }));

  const save = () => {
    setTouched(true);
    if (errors.length > 0) return;
    setBusy(true);
    const next = { ...room, title: room.title.trim(), url: room.url.trim(), rev: room.rev + 1 };
    mutate((s) => s.saveWarRoom(next), request.mode === "create" ? "War room opened" : "War room updated")
      .then(onClose)
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };

  return (
    <Modal
      title={request.mode === "create" ? "Open a war room" : "Edit war room"}
      show
      size="medium"
      onDismiss={onClose}
      footer={
        <Flex justifyContent="flex-end" gap={8}>
          <Button onClick={onClose}>Cancel</Button>
          <Button color="primary" variant="accent" loading={busy} onClick={save}>
            {request.mode === "create" ? "Open war room" : "Save"}
          </Button>
        </Flex>
      }
    >
      <Flex flexDirection="column" gap={16}>
        <FormField required>
          <Label>Title</Label>
          <TextInput value={room.title} onChange={(v) => setRoom((r) => ({ ...r, title: v }))} />
          {err("title") && <FieldError>{err("title")}</FieldError>}
        </FormField>
        <FormField required>
          <Label>Meeting link</Label>
          <TextInput
            value={room.url}
            onChange={(v) => setRoom((r) => ({ ...r, url: v }))}
            placeholder="https://… (Teams, Zoom, Meet, Slack huddle)"
          />
          {err("url") ? <FieldError>{err("url")}</FieldError> : <FieldHint>Create the meeting in your tool and paste its https link.</FieldHint>}
        </FormField>
        <FormField required>
          <Label>Incidents handled in this room</Label>
          <Select multiple value={room.incidentIds} onChange={(v) => setRoom((r) => ({ ...r, incidentIds: v ?? [] }))}>
            <Select.Content>
              {options.map((i) => (
                <Select.Option key={i.id} value={i.id}>
                  {label(i)}
                </Select.Option>
              ))}
            </Select.Content>
          </Select>
          {err("incidentIds") ? (
            <FieldError>{err("incidentIds")}</FieldError>
          ) : (
            <FieldHint>
              {related.length > 0
                ? `${related.length} related incident${related.length === 1 ? "" : "s"} (same root cause, or same service within 30 minutes) were added. Remove any that don't belong.`
                : "Add every incident that shares the same cause."}
            </FieldHint>
          )}
        </FormField>
        <Flex flexDirection="column" gap={8}>
          <Label>Notebooks (investigation and post-mortem)</Label>
          <Flex gap={8} flexWrap="wrap" alignItems="flex-end">
            <Button color="primary" loading={creating} onClick={createNotebook}>
              <Button.Prefix>
                <DescriptionIcon />
              </Button.Prefix>
              Create post-mortem notebook
            </Button>
            <Flex flexDirection="column" style={{ minWidth: 260, flex: 1 }}>
              <Select
                value={null}
                onChange={(id) => {
                  const n = notebooks?.find((x) => x.id === id);
                  if (n) addNotebook(n);
                }}
                disabled={!notebooks || notebooks.length === 0}
                aria-label="Select an existing notebook"
              >
                <Select.Trigger placeholder={notebooks === undefined && !notebookError ? "Loading notebooks…" : notebooks?.length ? "Select an existing notebook" : "No notebooks available"} />
                <Select.Content>
                  <Select.Filter />
                  {(notebooks ?? []).map((n) => (
                    <Select.Option key={n.id} value={n.id}>
                      {n.name}
                    </Select.Option>
                  ))}
                </Select.Content>
              </Select>
            </Flex>
          </Flex>
          {notebookError ? (
            <FieldError>Couldn't list notebooks: {notebookError}</FieldError>
          ) : (
            <FieldHint>
              The post-mortem notebook comes with a template (summary, timeline, root cause, impact, action items) and a query listing this room's problems.
            </FieldHint>
          )}
          {room.notebooks.map((n, i) => n.documentId ? (
            <NewItemHighlight key={n.documentId} active={n.documentId === justAdded}>
            <Flex gap={8} alignItems="center" justifyContent="space-between">
              <Flex gap={8} alignItems="center" style={{ minWidth: 0 }}>
                <DescriptionIcon />
                <Text>{n.title}</Text>
              </Flex>
              <Button
                aria-label="Remove notebook"
                onClick={() => setRoom((r) => ({ ...r, notebooks: r.notebooks.filter((_, j) => j !== i) }))}
              >
                <Button.Prefix>
                  <DeleteIcon />
                </Button.Prefix>
              </Button>
            </Flex>
            </NewItemHighlight>
          ) : (
            <Flex key={i} gap={8} alignItems="flex-start">
              <Flex flexDirection="column" style={{ flex: "0 0 30%" }}>
                <TextInput value={n.title} onChange={(v) => setNotebook(i, { ...n, title: v })} placeholder="Name" aria-label="Notebook name" />
                {err(`notebooks[${i}].title`) && <FieldError>{err(`notebooks[${i}].title`)}</FieldError>}
              </Flex>
              <Flex flexDirection="column" style={{ flex: 1, minWidth: 0 }}>
                <TextInput value={n.url} onChange={(v) => setNotebook(i, { ...n, url: v })} placeholder="https://…" aria-label="Notebook link" />
                {err(`notebooks[${i}].url`) && <FieldError>{err(`notebooks[${i}].url`)}</FieldError>}
              </Flex>
              <Button
                aria-label="Remove notebook"
                onClick={() => setRoom((r) => ({ ...r, notebooks: r.notebooks.filter((_, j) => j !== i) }))}
              >
                <Button.Prefix>
                  <DeleteIcon />
                </Button.Prefix>
              </Button>
            </Flex>
          ))}
          <Flex>
            <Button
              onClick={() =>
                setRoom((r) => ({ ...r, notebooks: [...r.notebooks, { title: r.notebooks.length === 0 ? "Post-mortem" : "", url: "" }] }))
              }
            >
              <Button.Prefix>
                <PlusIcon />
              </Button.Prefix>
              Add a link manually
            </Button>
          </Flex>
        </Flex>
      </Flex>
    </Modal>
  );
};
