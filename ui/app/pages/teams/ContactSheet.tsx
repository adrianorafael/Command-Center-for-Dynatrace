/** Sheet that edits one person's contact methods and notification rules. */
import { describeErrors } from "../../components/format";
import { CreatedMarker, markCreated } from "../../components/NewItemHighlight";
import { FieldError, FieldHint } from "../../components/FieldHint";
import React, { useEffect, useState } from "react";
import { Button } from "@dynatrace/strato-components/buttons";
import { Flex, Surface } from "@dynatrace/strato-components/layouts";
import { Sheet, Tooltip } from "@dynatrace/strato-components/overlays";
import { FormField, Label, NumberInputV2 as NumberInput, Select, TextInput } from "@dynatrace/strato-components/forms";
import { MessageContainer } from "@dynatrace/strato-components/content";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { notify } from "../../hooks/notifications";
import { PlayIcon, PlusIcon, WarningIcon, XmarkIcon } from "@dynatrace/strato-icons";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { CHANNELS, PRIORITIES, SCHEMA_VERSION, type Channel, type ContactMethod, type Priority, type UserContact } from "../../domain/contracts";
import { useAppData } from "../../hooks/AppDataContext";
import { newId, runEngineNow, validateUserContact } from "../../hooks/domain";
import { CHANNEL_LABEL, ChannelIcon } from "../../components/ChannelIcon";
import { IconButton } from "../../components/IconButton";
import { errorMessage } from "../../components/format";

const PHONE: readonly Channel[] = ["sms", "voice", "whatsapp"];
/** Channels where the address only labels the person: the webhook or applet decides the destination. */
const LABEL_ONLY: readonly Channel[] = ["slack", "teams", "ifttt"];

const ADDRESS_LABEL: Record<Channel, string> = {
  sms: "Phone number",
  voice: "Phone number",
  whatsapp: "Phone number",
  telegram: "Chat ID",
  slack: "Name in the message",
  teams: "Name in the message",
  ifttt: "Name in the message",
  webhook: "Routing key",
};

const ADDRESS_PLACEHOLDER: Record<Channel, string> = {
  sms: "+15550100000",
  voice: "+15550100000",
  whatsapp: "+15550100000",
  telegram: "123456789",
  slack: "Name",
  teams: "Name",
  ifttt: "Name",
  webhook: "For example: ana",
};

const ADDRESS_HINT: Record<Channel, string> = {
  sms: "With the country code, for example +15550100000.",
  voice: "With the country code, for example +15550100000.",
  whatsapp: "With the country code, for example +15550100000.",
  telegram: "The person's Telegram chat ID (a number).",
  slack: "The Slack webhook decides the channel; this only names the person in the message.",
  teams: "The Teams webhook decides the chat; this only names the person in the card.",
  ifttt: "Your IFTTT applet decides where the message goes; this only names the person.",
  webhook: "Passed to your webhook or custom workflow as notification.to.address.",
};

/** "P1–P3" style label for a rule's most-lenient priority. */
function priorityRange(max: Priority): string {
  return max === "P1" ? "P1 only" : max === "P5" ? "All priorities" : `P1–${max}`;
}

function blankMethod(): ContactMethod {
  return { id: newId("cm"), channel: "sms", address: "" };
}

/**
 * Contact methods + optional notification rules for one person.
 * - Opens with one empty method row when the person has none (rows left empty are ignored on save).
 * - `next`: when set, the primary button saves and moves on to that person (used to fill in a whole team in a row).
 */
export const ContactSheet = ({
  uid,
  show,
  onClose,
  next,
  onNext,
}: {
  uid?: string;
  show: boolean;
  onClose: () => void;
  next?: { uid: string; name: string };
  onNext?: (uid: string) => void;
}) => {
  const { data, userName, mutate, demo } = useAppData();
  const [draft, setDraft] = useState<UserContact>();
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [testing, setTesting] = useState<string>();

  useEffect(() => {
    if (!show || !uid) return;
    const existing = data?.contacts.find((c) => c.uid === uid);
    const base: UserContact = existing ?? { schemaVersion: SCHEMA_VERSION, uid, rev: 0, displayName: userName(uid), methods: [], rules: [] };
    setDraft(base.methods.length ? base : { ...base, methods: [blankMethod()] });
    setTried(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, uid]);

  if (!draft) return null;
  const name = userName(draft.uid);
  // Rows the person never filled in are not saved (and never block saving).
  const kept = draft.methods.filter((m) => m.address.trim() !== "");
  const keptIds = new Set(kept.map((m) => m.id));
  const toSave: UserContact = { ...draft, methods: kept, rules: draft.rules.filter((r) => keptIds.has(r.methodId)) };
  const errors = validateUserContact(toSave);
  const methodError = (id: string) => {
    const i = kept.findIndex((m) => m.id === id);
    return i < 0 ? undefined : errors.find((e) => e.path === `methods[${i}].address`)?.message;
  };
  // Once a person has rules, only incidents covered by a rule notify them: say which priorities are left out.
  const uncovered = (() => {
    if (toSave.rules.length === 0) return undefined;
    const widest = Math.max(...toSave.rules.map((r) => PRIORITIES.indexOf(r.maxPriority)));
    const first = PRIORITIES[widest + 1];
    return first ? (first === "P5" ? "P5" : `${first}–P5`) : undefined;
  })();
  const otherErrors = errors.filter((e) => !/^methods\[\d+\]\.address$/.test(e.path));
  const setMethod = (i: number, m: ContactMethod) => setDraft({ ...draft, methods: draft.methods.map((x, j) => (j === i ? m : x)) });
  const providerFor = (ch: Channel) => data?.settings.providers.find((p) => p.channel === ch && p.enabled);

  const sendTest = (m: ContactMethod) => {
    const p = providerFor(m.channel);
    if (!p || !data) return;
    setTesting(m.id);
    runEngineNow(data.settings, "test", { providerId: p.id, channel: m.channel, address: m.address })
      .then(() => notify({ category: "action", type: "success", title: "Test notification requested", message: `${CHANNEL_LABEL[m.channel]} via ${p.name}`, lifespan: 5000 }))
      .catch((e) => notify({ category: "error", type: "critical", title: "Couldn't send the test notification", message: errorMessage(e), lifespan: "infinite" }))
      .finally(() => setTesting(undefined));
  };

  const save = (advance: boolean) => {
    setTried(true);
    if (errors.length) return;
    const done = () => (advance && next && onNext ? onNext(next.uid) : onClose());
    const existing = data?.contacts.find((c) => c.uid === draft.uid);
    // Nothing entered for someone without contact methods: nothing to save.
    if (!existing && toSave.methods.length === 0) return done();
    setBusy(true);
    mutate((s) => s.saveContact({ ...toSave, rev: toSave.rev + 1, displayName: name }), "Contact methods saved")
      .then(done)
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };

  return (
    <Sheet
      title={`Contact methods · ${name}`}
      show={show}
      onDismiss={onClose}
      actions={
        <Flex gap={8}>
          <Button onClick={onClose}>Cancel</Button>
          {next && onNext ? (
            <>
              <Button loading={busy} onClick={() => save(false)}>
                Save
              </Button>
              <Button color="primary" variant="accent" loading={busy} onClick={() => save(true)}>
                Save and next: {next.name}
              </Button>
            </>
          ) : (
            <Button color="primary" variant="accent" loading={busy} onClick={() => save(false)}>
              Save
            </Button>
          )}
        </Flex>
      }
    >
      <Flex flexDirection="column" gap={16} style={{ maxWidth: 760 }}>
        <Text>How {name} is reached when paged. Contact details are readable by every user of this app, and masked in lists.</Text>
        {draft.methods.map((m, i) => {
          const provider = providerFor(m.channel);
          const err = tried ? methodError(m.id) : undefined;
          return (
            <Surface key={m.id} padding={12}>
              <Flex flexDirection="column" gap={4}>
                <CreatedMarker kind="method" id={m.id} />
                <Flex gap={8} alignItems="flex-end" flexWrap="wrap">
                  <FormField>
                    <Label>Channel</Label>
                    <Select
                      value={m.channel}
                      onChange={(v) => {
                        if (!v) return;
                        // Label-only channels need no real address: use the person's name unless something was typed.
                        const address = LABEL_ONLY.includes(v) && !m.address.trim() ? name : PHONE.includes(v) && m.address === name ? "" : m.address;
                        setMethod(i, { ...m, channel: v, address });
                      }}
                    >
                      <Select.Trigger width="176px" />
                      <Select.Content>
                        {CHANNELS.map((c) => (
                          <Select.Option key={c} value={c}>
                            <Select.Prefix>
                              <ChannelIcon channel={c} />
                            </Select.Prefix>
                            {CHANNEL_LABEL[c]}
                          </Select.Option>
                        ))}
                      </Select.Content>
                    </Select>
                  </FormField>
                  <Flex flexGrow={1} flexDirection="column" style={{ minWidth: 200 }}>
                    <FormField required>
                      <Label>{ADDRESS_LABEL[m.channel]}</Label>
                      <TextInput value={m.address} onChange={(v) => setMethod(i, { ...m, address: v.trim() })} placeholder={ADDRESS_PLACEHOLDER[m.channel]} />
                    </FormField>
                  </Flex>
                  <Flex flexDirection="column" style={{ width: 170 }}>
                    <FormField>
                      <Label>Label (optional)</Label>
                      <TextInput value={m.label ?? ""} onChange={(v) => setMethod(i, { ...m, label: v || undefined })} placeholder="e.g. work phone" />
                    </FormField>
                  </Flex>
                  <Tooltip
                    text={demo ? "Not available in demo mode" : provider ? `Send a test through ${provider.name}` : `Turn on a ${CHANNEL_LABEL[m.channel]} provider in Integrations first`}
                  >
                    <Button disabled={demo || !provider || !m.address} loading={testing === m.id} onClick={() => sendTest(m)}>
                      <Button.Prefix>
                        <PlayIcon />
                      </Button.Prefix>
                      Send test
                    </Button>
                  </Tooltip>
                  <IconButton
                    label="Remove method"
                    icon={<XmarkIcon />}
                    onClick={() =>
                      setDraft({ ...draft, methods: draft.methods.filter((x) => x.id !== m.id), rules: draft.rules.filter((r) => r.methodId !== m.id) })
                    }
                  />
                </Flex>
                {err ? <FieldError>{err}</FieldError> : <FieldHint>{ADDRESS_HINT[m.channel]}</FieldHint>}
              </Flex>
            </Surface>
          );
        })}
        <Flex>
          <Button
            onClick={() => {
              const m = blankMethod();
              markCreated("method", m.id);
              setDraft({ ...draft, methods: [...draft.methods, m] });
            }}
          >
            <Button.Prefix>
              <PlusIcon />
            </Button.Prefix>
            Add contact method
          </Button>
        </Flex>

        <Heading level={4}>Notification rules (optional)</Heading>
        <Text textStyle="small">
          Without rules, every contact method above is used at once. Add rules to choose which method comes first, after how long, and for which
          priorities.
        </Text>
        {tried && otherErrors.length > 0 && (
          <MessageContainer variant="critical">
            <MessageContainer.Description>{describeErrors(otherErrors)}</MessageContainer.Description>
          </MessageContainer>
        )}
        {draft.rules.map((r, i) => (
          <Flex key={i} gap={8} alignItems="flex-end" flexWrap="wrap">
            <FormField>
              <Label>Use</Label>
              <Select
                value={r.methodId}
                onChange={(v) => v && setDraft({ ...draft, rules: draft.rules.map((x, j) => (j === i ? { ...x, methodId: v } : x)) })}
              >
                <Select.Trigger width="240px" />
                <Select.Content>
                  {draft.methods.map((m) => (
                    <Select.Option key={m.id} value={m.id}>
                      {m.label ? `${CHANNEL_LABEL[m.channel]} (${m.label})` : CHANNEL_LABEL[m.channel]}
                    </Select.Option>
                  ))}
                </Select.Content>
              </Select>
            </FormField>
            <FormField>
              <Label>After (minutes)</Label>
              <NumberInput
                value={r.delayMinutes}
                min={0}
                max={1440}
                onChange={(v) => setDraft({ ...draft, rules: draft.rules.map((x, j) => (j === i ? { ...x, delayMinutes: v ?? 0 } : x)) })}
              />
            </FormField>
            <FormField>
              <Label>For priorities</Label>
              <Select
                value={r.maxPriority}
                onChange={(v) => v && setDraft({ ...draft, rules: draft.rules.map((x, j) => (j === i ? { ...x, maxPriority: v as Priority } : x)) })}
              >
                <Select.Trigger width="150px" />
                <Select.Content>
                  {PRIORITIES.map((p) => (
                    <Select.Option key={p} value={p}>
                      {priorityRange(p)}
                    </Select.Option>
                  ))}
                </Select.Content>
              </Select>
            </FormField>
            <IconButton label="Remove rule" icon={<XmarkIcon />} onClick={() => setDraft({ ...draft, rules: draft.rules.filter((_, j) => j !== i) })} />
          </Flex>
        ))}
        {uncovered && (
          <Flex alignItems="center" gap={8}>
            <WarningIcon style={{ color: Colors.Icon.Warning.Default, flexShrink: 0 }} />
            <Text textStyle="small">
              With these rules, {name} is not notified for {uncovered} incidents. Add a rule for all priorities to cover them.
            </Text>
          </Flex>
        )}
        <Flex>
          <Button
            disabled={kept.length === 0}
            onClick={() =>
              setDraft({
                ...draft,
                rules: [...draft.rules, { methodId: (kept[0] ?? draft.methods[0]).id, delayMinutes: draft.rules.length ? 5 : 0, maxPriority: "P5" }],
              })
            }
          >
            <Button.Prefix>
              <PlusIcon />
            </Button.Prefix>
            Add rule
          </Button>
        </Flex>
      </Flex>
    </Sheet>
  );
};
