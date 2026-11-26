import React, { useEffect, useRef, useState } from "react";
import { Button } from "@dynatrace/strato-components/buttons";
import { Flex, Surface } from "@dynatrace/strato-components/layouts";
import { Modal } from "@dynatrace/strato-components/overlays";
import { Avatar, ProgressCircle } from "@dynatrace/strato-components/content";
import { Checkbox, FormField, Label, Radio, RadioGroup, TextInput } from "@dynatrace/strato-components/forms";
import { Text } from "@dynatrace/strato-components/typography";
import Colors from "@dynatrace/strato-design-tokens/colors";
import type { DirectoryUser, Team, TeamRole } from "../../domain/contracts";
import { useAppData, nextRev } from "../../hooks/AppDataContext";
import { searchDirectory } from "../../hooks/domain";
import { FORBIDDEN, isForbidden } from "../../components/UserPicker";
import { FieldError, FieldHint } from "../../components/FieldHint";
import { initials } from "../../components/format";

const MIN_CHARS = 3;

export const ROLE_CHOICES: { role: TeamRole; label: string; help: string }[] = [
  { role: "responder", label: "Responder", help: "Gets paged and can acknowledge and resolve incidents." },
  { role: "admin", label: "Team admin", help: "Gets paged and can edit the team, its schedules and its escalation policy." },
  { role: "observer", label: "Observer", help: "Sees the team's incidents but is never paged." },
];

/**
 * "Add people" (team detail): search tenant users by name or email, tick several, pick one role,
 * add them in one save. Calls onAdded with the uids that were added.
 */
export const AddPeopleModal = ({ team, show, onClose, onAdded }: { team: Team; show: boolean; onClose: () => void; onAdded: (uids: string[]) => void }) => {
  const { mutate, rememberUsers, setPaused } = useAppData();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<DirectoryUser[]>([]);
  const [picked, setPicked] = useState<Map<string, DirectoryUser>>(new Map());
  const [role, setRole] = useState<TeamRole>("responder");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    setPaused(show);
    if (show) {
      setQ("");
      setResults([]);
      setPicked(new Map());
      setRole("responder");
      setError(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  useEffect(() => {
    const query = q.trim();
    if (query.length < MIN_CHARS) {
      setResults([]);
      setLoading(false);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    const t = window.setTimeout(() => {
      searchDirectory(query)
        .then((r) => {
          if (mine !== seq.current) return;
          setResults(r);
          setError(undefined);
        })
        .catch((e: unknown) => {
          if (mine !== seq.current) return;
          setResults([]);
          setError(isForbidden(e) ? FORBIDDEN : `Couldn't search users: ${e instanceof Error ? e.message : "unknown error"}`);
        })
        .finally(() => mine === seq.current && setLoading(false));
    }, 300);
    return () => window.clearTimeout(t);
  }, [q]);

  const memberIds = new Set(team.members.map((m) => m.uid));
  const toggle = (u: DirectoryUser, on: boolean) =>
    setPicked((prev) => {
      const next = new Map(prev);
      if (on) next.set(u.uid, u);
      else next.delete(u.uid);
      return next;
    });
  const n = picked.size;

  const save = () => {
    if (!n) return;
    setBusy(true);
    const added = [...picked.keys()];
    rememberUsers([...picked.values()]);
    mutate((s) => s.saveTeam(nextRev({ ...team, members: [...team.members, ...added.map((uid) => ({ uid, role }))] })), `${n} ${n === 1 ? "person" : "people"} added`)
      .then(() => {
        onClose();
        onAdded(added);
      })
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };

  const hint = q.trim().length < MIN_CHARS ? "Results appear after 3 letters." : loading ? "Searching…" : results.length ? `${results.length} found` : "No users found. Try the email address.";

  return (
    <Modal
      title={`Add people to ${team.name}`}
      show={show}
      onDismiss={onClose}
      size="medium"
      footer={
        <Flex justifyContent="flex-end" gap={8}>
          <Button onClick={onClose}>Cancel</Button>
          <Button color="primary" variant="accent" disabled={!n} loading={busy} onClick={save}>
            {n ? `Add ${n} ${n === 1 ? "person" : "people"}` : "Add people"}
          </Button>
        </Flex>
      }
    >
      <Flex flexDirection="column" gap={16}>
        <FormField>
          <Label>Find people</Label>
          <TextInput value={q} onChange={setQ} placeholder="Type a name or email (at least 3 letters)" aria-label="Search tenant users" />
          {error ? <FieldError>{error}</FieldError> : <FieldHint>{hint}</FieldHint>}
        </FormField>
        <Surface padding={8} style={{ maxHeight: 280, overflowY: "auto", minHeight: 96 }}>
          {loading && (
            <Flex justifyContent="center" padding={16}>
              <ProgressCircle size="small" aria-label="Searching users" />
            </Flex>
          )}
          {!loading && results.length === 0 && (
            <Flex padding={16} justifyContent="center">
              <Text style={{ color: Colors.Text.Neutral.Subdued }}>
                {q.trim().length < MIN_CHARS ? "Search for Dynatrace users of this environment." : "No matching users."}
              </Text>
            </Flex>
          )}
          {!loading &&
            results.map((u) => {
              const already = memberIds.has(u.uid);
              return (
                <Flex key={u.uid} alignItems="center" gap={12} padding={8}>
                  <Checkbox
                    aria-label={`Select ${u.name}`}
                    value={already || picked.has(u.uid)}
                    disabled={already}
                    onChange={(on) => toggle(u, on)}
                  />
                  <Avatar size="small" abbreviation={initials(u.name)}>
                    <Avatar.Label>{u.name}</Avatar.Label>
                    {u.email && <Avatar.Subtitle>{u.email}</Avatar.Subtitle>}
                  </Avatar>
                  {already && (
                    <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued, marginLeft: "auto" }}>
                      Already in team
                    </Text>
                  )}
                </Flex>
              );
            })}
        </Surface>
        {n > 0 && (
          <Text textStyle="small">
            Selected: {[...picked.values()].map((u) => u.name).join(", ")}
          </Text>
        )}
        <FormField>
          <Label>Role for the selected people</Label>
          <RadioGroup value={role} onChange={(v) => setRole(v as TeamRole)}>
            {ROLE_CHOICES.map((r) => (
              <Radio key={r.role} value={r.role}>
                <Text textStyle="base-emphasized">{r.label}</Text>
                <Text> · {r.help}</Text>
              </Radio>
            ))}
          </RadioGroup>
        </FormField>
      </Flex>
    </Modal>
  );
};
