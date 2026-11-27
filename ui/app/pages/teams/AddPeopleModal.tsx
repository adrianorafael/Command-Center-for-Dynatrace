/** Dialog that adds tenant users to a team with one role. */
import { markCreated } from "../../components/NewItemHighlight";
import React, { useEffect, useRef, useState } from "react";
import { Button } from "@dynatrace/strato-components/buttons";
import { Flex, Surface } from "@dynatrace/strato-components/layouts";
import { Modal } from "@dynatrace/strato-components/overlays";
import { Avatar, ProgressCircle } from "@dynatrace/strato-components/content";
import { Checkbox, FormField, Label, Radio, RadioGroup, TextInput } from "@dynatrace/strato-components/forms";
import { Text } from "@dynatrace/strato-components/typography";
import { XmarkIcon } from "@dynatrace/strato-icons";
import Colors from "@dynatrace/strato-design-tokens/colors";
import type { DirectoryUser, Team, TeamRole } from "../../domain/contracts";
import { useAppData, nextRev } from "../../hooks/AppDataContext";
import { searchDirectory } from "../../hooks/domain";
import { FORBIDDEN, isForbidden } from "../../components/UserPicker";
import { FieldError, FieldHint } from "../../components/FieldHint";
import { initials } from "../../components/format";

const MIN_CHARS = 3;

/** Roles offered when adding people, with the help text shown next to each. */
export const ROLE_CHOICES: { role: TeamRole; label: string; help: string }[] = [
  { role: "responder", label: "Responder", help: "Gets paged and can acknowledge and resolve incidents." },
  { role: "admin", label: "Team admin", help: "Gets paged and can edit the team, its schedules and its escalation policy." },
  { role: "observer", label: "Observer", help: "Sees the team's incidents but is never paged." },
];

/**
 * "Add people" (team detail): search tenant users by name or email, tick several, pick one role,
 * add them in one save. Calls onAdded with the uids that were added.
 *
 * People picked from different searches stay visible in a "Selected" list (with a remove button), so the person
 * adding them always sees who will be added, whatever is typed in the search box now.
 */
export const AddPeopleModal = ({ team, show, onClose, onAdded }: { team: Team; show: boolean; onClose: () => void; onAdded?: (uids: string[]) => void }) => {
  const { mutate, rememberUsers, setPaused, currentUser, users } = useAppData();
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
    added.forEach((uid) => markCreated("member", uid));
    mutate((s) => s.saveTeam(nextRev({ ...team, members: [...team.members, ...added.map((uid) => ({ uid, role }))] })), `${n} ${n === 1 ? "person" : "people"} added`)
      .then(() => {
        onClose();
        onAdded?.(added);
      })
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };

  const searching = q.trim().length >= MIN_CHARS;
  // Before a search, offer the signed-in person: the quickest way to get a first responder into a team.
  const me: DirectoryUser = users.get(currentUser.uid) ?? currentUser;
  const listed = searching ? results : memberIds.has(me.uid) ? [] : [me];

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
          {error ? <FieldError>{error}</FieldError> : searching && !loading && results.length > 0 ? <FieldHint>{`${results.length} found`}</FieldHint> : null}
        </FormField>
        <Surface padding={8} style={{ maxHeight: 280, overflowY: "auto", minHeight: 96 }}>
          {loading && (
            <Flex justifyContent="center" padding={16}>
              <ProgressCircle size="small" aria-label="Searching users" />
            </Flex>
          )}
          {!loading && searching && results.length === 0 && !error && (
            <Flex padding={16} justifyContent="center">
              <Text style={{ color: Colors.Text.Neutral.Subdued }}>
                No users found. Only people who have signed in to Dynatrace at least once can be found. Try the email address.
              </Text>
            </Flex>
          )}
          {!loading && !searching && listed.length === 0 && (
            <Flex padding={16} justifyContent="center">
              <Text style={{ color: Colors.Text.Neutral.Subdued }}>Type at least 3 letters to search the Dynatrace users of this environment.</Text>
            </Flex>
          )}
          {!loading &&
            listed.map((u) => {
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
                    <Avatar.Label>{u.uid === currentUser.uid && !searching && !/^you\b/i.test(u.name) ? `${u.name} (you)` : u.name}</Avatar.Label>
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
        <Flex flexDirection="column" gap={4}>
          <Text textStyle="base-emphasized">{n ? `Selected (${n})` : "Selected"}</Text>
          {n === 0 ? (
            <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued }}>
              Nobody yet. Tick people in the list above; you can search again and keep adding.
            </Text>
          ) : (
            <Surface padding={8} style={{ maxHeight: 160, overflowY: "auto" }}>
              {[...picked.values()].map((u) => (
                <Flex key={u.uid} alignItems="center" gap={12} padding={4}>
                  <Avatar size="small" abbreviation={initials(u.name)}>
                    <Avatar.Label>{u.name}</Avatar.Label>
                    {u.email && <Avatar.Subtitle>{u.email}</Avatar.Subtitle>}
                  </Avatar>
                  <Button size="condensed" variant="default" style={{ marginLeft: "auto" }} aria-label={`Remove ${u.name}`} onClick={() => toggle(u, false)}>
                    <Button.Prefix>
                      <XmarkIcon />
                    </Button.Prefix>
                    Remove
                  </Button>
                </Flex>
              ))}
            </Surface>
          )}
        </Flex>
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
