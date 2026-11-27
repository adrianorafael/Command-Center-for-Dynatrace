import { describeErrors } from "../../components/format";
import { CreatedMarker, markCreated } from "../../components/NewItemHighlight";
import { FieldHint } from "../../components/FieldHint";
import React, { useEffect, useState } from "react";
import { Button } from "@dynatrace/strato-components/buttons";
import { Flex, Surface } from "@dynatrace/strato-components/layouts";
import { Sheet, Tooltip } from "@dynatrace/strato-components/overlays";
import { FormField, Label, NumberInputV2 as NumberInput, Select, TextInput } from "@dynatrace/strato-components/forms";
import { MessageContainer } from "@dynatrace/strato-components/content";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { notify } from "../../hooks/notifications";
import { PlayIcon, PlusIcon, XmarkIcon } from "@dynatrace/strato-icons";
import { CHANNELS, PRIORITIES, SCHEMA_VERSION, type Channel, type ContactMethod, type Priority, type UserContact } from "../../domain/contracts";
import { useAppData } from "../../hooks/AppDataContext";
import { newId, runEngineNow, validateUserContact } from "../../hooks/domain";
import { CHANNEL_LABEL, ChannelIcon } from "../../components/ChannelIcon";
import { IconButton } from "../../components/IconButton";
import { errorMessage } from "../../components/format";

const ADDRESS_HINT: Record<Channel, string> = {
  sms: "Phone in E.164, including the country code, for example +43…",
  voice: "Phone in E.164, including the country code, for example +43…",
  whatsapp: "Phone in E.164, including the country code, for example +43…",
  telegram: "Telegram chat ID",
  slack: "Any label, for example @ana: the Slack webhook decides the channel; the message shows the person's name",
  teams: "Any label: the Teams webhook decides the chat or channel; the card shows the person's name",
  ifttt: "Any label: your IFTTT applet decides where the message goes",
  webhook: "Routing key passed to your webhook or custom workflow as notification.to.address",
};

/** Contact methods + personal notification rules for one person (DESIGN §7.2). */
export const ContactSheet = ({ uid, show, onClose }: { uid?: string; show: boolean; onClose: () => void }) => {
  const { data, userName, mutate, demo } = useAppData();
  const [draft, setDraft] = useState<UserContact>();
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [testing, setTesting] = useState<string>();

  useEffect(() => {
    if (!show || !uid) return;
    const existing = data?.contacts.find((c) => c.uid === uid);
    setDraft(
      existing ?? { schemaVersion: SCHEMA_VERSION, uid, rev: 0, displayName: userName(uid), methods: [], rules: [] },
    );
    setTried(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, uid]);

  if (!draft) return null;
  const errors = validateUserContact(draft);
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

  const save = () => {
    setTried(true);
    if (errors.length) return;
    setBusy(true);
    mutate((s) => s.saveContact({ ...draft, rev: draft.rev + 1, displayName: userName(draft.uid) }), "Contact methods saved")
      .then(onClose)
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };

  return (
    <Sheet
      title={`Contact methods · ${userName(draft.uid)}`}
      show={show}
      onDismiss={onClose}
      actions={
        <Flex gap={8}>
          <Button onClick={onClose}>Cancel</Button>
          <Button color="primary" variant="accent" loading={busy} onClick={save}>
            Save
          </Button>
        </Flex>
      }
    >
      <Flex flexDirection="column" gap={16} style={{ maxWidth: 640 }}>
        <Text>
          Phone numbers and chat IDs are stored in app state and are readable by every user of this app. They are masked in lists and never shown in
          toasts or logs.
        </Text>
        {tried && errors.length > 0 && (
          <MessageContainer variant="critical">
            <MessageContainer.Title>To save these contact methods:</MessageContainer.Title>
            <MessageContainer.Description>{describeErrors(errors)}</MessageContainer.Description>
          </MessageContainer>
        )}
        {draft.methods.map((m, i) => {
          const provider = providerFor(m.channel);
          return (
            <Surface key={m.id} padding={16}>
              <Flex flexDirection="column" gap={12}>
                <CreatedMarker kind="method" id={m.id} />
                <Flex alignItems="center" gap={8} justifyContent="space-between">
                  <Flex alignItems="center" gap={8}>
                    <ChannelIcon channel={m.channel} />
                    <Heading level={5}>{CHANNEL_LABEL[m.channel]}</Heading>
                  </Flex>
                  <IconButton
                    label="Remove method"
                    icon={<XmarkIcon />}
                    onClick={() =>
                      setDraft({ ...draft, methods: draft.methods.filter((x) => x.id !== m.id), rules: draft.rules.filter((r) => r.methodId !== m.id) })
                    }
                  />
                </Flex>
                <FormField required>
                  <Label>Channel</Label>
                  <Select value={m.channel} onChange={(v) => v && setMethod(i, { ...m, channel: v })}>
                    <Select.Content>
                      {CHANNELS.map((c) => (
                        <Select.Option key={c} value={c}>
                          {CHANNEL_LABEL[c]}
                        </Select.Option>
                      ))}
                    </Select.Content>
                  </Select>
                </FormField>
                <FormField required>
                  <Label>Address</Label>
                  <TextInput value={m.address} onChange={(v) => setMethod(i, { ...m, address: v.trim() })} />
                  <FieldHint>{ADDRESS_HINT[m.channel]}</FieldHint>
                </FormField>
                <FormField>
                  <Label>Label</Label>
                  <TextInput value={m.label ?? ""} onChange={(v) => setMethod(i, { ...m, label: v || undefined })} placeholder="For example: work phone" />
                </FormField>
                <Flex alignItems="center" gap={8}>
                  <Tooltip
                    text={demo ? "Not available in demo mode" : provider ? `Send a test through ${provider.name}` : `Configure a ${CHANNEL_LABEL[m.channel]} provider in Integrations first`}
                  >
                    <Button disabled={demo || !provider || !m.address} loading={testing === m.id} onClick={() => sendTest(m)}>
                      <Button.Prefix>
                        <PlayIcon />
                      </Button.Prefix>
                      Send test
                    </Button>
                  </Tooltip>
                </Flex>
              </Flex>
            </Surface>
          );
        })}
        <Flex>
          <Button
            onClick={() => {
              const id = newId("cm");
              markCreated("method", id);
              setDraft({ ...draft, methods: [...draft.methods, { id, channel: "sms", address: "" }] });
            }}
          >
            <Button.Prefix>
              <PlusIcon />
            </Button.Prefix>
            Add contact method
          </Button>
        </Flex>

        <Heading level={4}>When I'm paged</Heading>
        <Text textStyle="small">Ordered notification rules. Escalation steps that force channels override these.</Text>
        {draft.rules.map((r, i) => (
          <Flex key={i} gap={8} alignItems="flex-end" flexWrap="wrap">
            <Text textStyle="base-emphasized">{i + 1}.</Text>
            <FormField>
              <Label>Method</Label>
              <Select
                value={r.methodId}
                onChange={(v) => v && setDraft({ ...draft, rules: draft.rules.map((x, j) => (j === i ? { ...x, methodId: v } : x)) })}
              >
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
              <Label>For priority up to</Label>
              <Select
                value={r.maxPriority}
                onChange={(v) => v && setDraft({ ...draft, rules: draft.rules.map((x, j) => (j === i ? { ...x, maxPriority: v as Priority } : x)) })}
              >
                <Select.Content>
                  {PRIORITIES.map((p) => (
                    <Select.Option key={p} value={p}>
                      {p}
                    </Select.Option>
                  ))}
                </Select.Content>
              </Select>
            </FormField>
            <IconButton label="Remove rule" icon={<XmarkIcon />} onClick={() => setDraft({ ...draft, rules: draft.rules.filter((_, j) => j !== i) })} />
          </Flex>
        ))}
        <Flex>
          <Button
            disabled={draft.methods.length === 0}
            onClick={() =>
              setDraft({
                ...draft,
                rules: [...draft.rules, { methodId: draft.methods[0].id, delayMinutes: draft.rules.length ? 5 : 0, maxPriority: "P3" }],
              })
            }
          >
            <Button.Prefix>
              <PlusIcon />
            </Button.Prefix>
            Add rule
          </Button>
        </Flex>
        <Text textStyle="small">Email isn't a separate channel: route email gateways through a webhook provider.</Text>
      </Flex>
    </Sheet>
  );
};
