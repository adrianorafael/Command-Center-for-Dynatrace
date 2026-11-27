import { describeErrors } from "../../components/format";
import { FieldHint } from "../../components/FieldHint";
import React, { useEffect, useState } from "react";
import { Button } from "@dynatrace/strato-components/buttons";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Sheet } from "@dynatrace/strato-components/overlays";
import { MessageContainer } from "@dynatrace/strato-components/content";
import { Checkbox, FieldSet, FormField, Label, Radio, RadioGroup, Select, Switch, TextInput } from "@dynatrace/strato-components/forms";
import { Text } from "@dynatrace/strato-components/typography";
import { PlusIcon, XmarkIcon } from "@dynatrace/strato-icons";
import { PRIORITIES, type ConditionOp, type Priority, type RoutingRule, type RuleCondition } from "../../domain/contracts";
import { useAppData } from "../../hooks/AppDataContext";
import { RULE_FIELDS, validateRule } from "../../hooks/domain";
import { IconButton } from "../../components/IconButton";

export const OP_LABEL: Record<ConditionOp, string> = {
  equals: "equals",
  contains: "contains",
  regex: "matches regex",
  in: "is one of",
  exists: "exists",
  lte: "≤",
  gte: "≥",
};

export function conditionText(c: RuleCondition): string {
  const v = c.op === "exists" ? "" : ` "${c.value ?? ""}"`;
  return `${c.negate ? "NOT " : ""}${c.field} ${OP_LABEL[c.op]}${v}`;
}

export function rulesSummary(r: RoutingRule): string {
  if (!r.conditions.length) return "Always";
  return r.conditions.map(conditionText).join(r.match === "all" ? " AND " : " OR ");
}

const FIELD_OPTIONS = [...RULE_FIELDS, "fields.cc.service", "fields.cc.priority", "fields.event.type"];

/** Rule editor (DESIGN §9.2): conditions builder + "then" actions. */
export const RuleSheet = ({ rule, onClose, onSave }: { rule?: RoutingRule; onClose: () => void; onSave: (r: RoutingRule) => Promise<void> }) => {
  const { data } = useAppData();
  const [draft, setDraft] = useState<RoutingRule>();
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  useEffect(() => {
    setDraft(rule);
    setTried(false);
  }, [rule]);
  if (!draft) return null;
  const errors = validateRule(draft, { teams: data?.teams, policies: data?.policies, services: data?.services });
  const setCond = (i: number, c: RuleCondition) => setDraft({ ...draft, conditions: draft.conditions.map((x, j) => (j === i ? c : x)) });
  const setThen = (patch: Partial<RoutingRule["then"]>) => setDraft({ ...draft, then: { ...draft.then, ...patch } });
  const save = () => {
    setTried(true);
    if (errors.length) return;
    setBusy(true);
    onSave(draft)
      .then(onClose)
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };
  return (
    <Sheet
      title={rule && rule.name ? "Edit rule" : "New rule"}
      show={!!rule}
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
      <Flex flexDirection="column" gap={24} style={{ maxWidth: 720 }}>
        {tried && errors.length > 0 && (
          <MessageContainer variant="critical">
            <MessageContainer.Title>To save this rule:</MessageContainer.Title>
            <MessageContainer.Description>{describeErrors(errors)}</MessageContainer.Description>
          </MessageContainer>
        )}
        <Flex flexDirection="column" gap={16}>
          <FormField required>
            <Label>Name</Label>
            <TextInput value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} placeholder="For example: Payments latency" />
          </FormField>
          <Switch value={draft.enabled} onChange={(v) => setDraft({ ...draft, enabled: v })}>
            Enabled
          </Switch>
        </Flex>
        <FieldSet>
          <FieldSet.Legend>Conditions</FieldSet.Legend>
          <Flex flexDirection="column" gap={12}>
            <RadioGroup value={draft.match} onChange={(v) => setDraft({ ...draft, match: v as "all" | "any" })}>
              <Radio value="all">Match all of the following</Radio>
              <Radio value="any">Match any of the following</Radio>
            </RadioGroup>
            {draft.conditions.map((c, i) => (
              <Flex key={i} gap={8} alignItems="flex-end" flexWrap="wrap">
                <FormField>
                  <Label>Field</Label>
                  <Select value={c.field} onChange={(v) => v && setCond(i, { ...c, field: v })}>
                    <Select.Filter />
                    <Select.Content>
                      {FIELD_OPTIONS.map((f) => (
                        <Select.Option key={f} value={f}>
                          {f}
                        </Select.Option>
                      ))}
                    </Select.Content>
                  </Select>
                </FormField>
                <FormField>
                  <Label>Operator</Label>
                  <Select value={c.op} onChange={(v) => v && setCond(i, { ...c, op: v })}>
                    <Select.Content>
                      {(Object.keys(OP_LABEL) as ConditionOp[]).map((o) => (
                        <Select.Option key={o} value={o}>
                          {OP_LABEL[o]}
                        </Select.Option>
                      ))}
                    </Select.Content>
                  </Select>
                </FormField>
                {c.op !== "exists" && (
                  <Flex flexGrow={1} flexDirection="column" style={{ minWidth: 160 }}>
                    <FormField>
                      <Label>Value</Label>
                      <TextInput value={c.value ?? ""} onChange={(v) => setCond(i, { ...c, value: v })} placeholder={c.op === "in" ? "a, b, c" : ""} />
                    </FormField>
                  </Flex>
                )}
                <Checkbox value={!!c.negate} onChange={(v) => setCond(i, { ...c, negate: v || undefined })}>
                  Not
                </Checkbox>
                <IconButton label="Remove condition" icon={<XmarkIcon />} onClick={() => setDraft({ ...draft, conditions: draft.conditions.filter((_, j) => j !== i) })} />
              </Flex>
            ))}
            {draft.conditions.length === 0 && <Text textStyle="small">No conditions: the rule matches every alert.</Text>}
            <Flex>
              <Button onClick={() => setDraft({ ...draft, conditions: [...draft.conditions, { field: "title", op: "contains", value: "" }] })}>
                <Button.Prefix>
                  <PlusIcon />
                </Button.Prefix>
                Add condition
              </Button>
            </Flex>
          </Flex>
        </FieldSet>
        <FieldSet>
          <FieldSet.Legend>Then</FieldSet.Legend>
          <Flex flexDirection="column" gap={16}>
            <FormField>
              <Label>Service</Label>
              <Select value={draft.then.serviceId ?? null} onChange={(v) => setThen({ serviceId: v ?? undefined })} clearable>
                <Select.Content>
                  {(data?.services ?? []).map((s) => (
                    <Select.Option key={s.id} value={s.id}>
                      {s.name}
                    </Select.Option>
                  ))}
                </Select.Content>
              </Select>
            </FormField>
            <FormField>
              <Label>Team</Label>
              <Select value={draft.then.teamId ?? null} onChange={(v) => setThen({ teamId: v ?? undefined })} clearable>
                <Select.Content>
                  {(data?.teams ?? []).map((t) => (
                    <Select.Option key={t.id} value={t.id}>
                      {t.name}
                    </Select.Option>
                  ))}
                </Select.Content>
              </Select>
              <FieldHint>Empty: the service's team</FieldHint>
            </FormField>
            <FormField>
              <Label>Escalation policy</Label>
              <Select value={draft.then.policyId ?? null} onChange={(v) => setThen({ policyId: v ?? undefined })} clearable>
                <Select.Content>
                  {(data?.policies ?? []).map((p) => (
                    <Select.Option key={p.id} value={p.id}>
                      {p.name}
                    </Select.Option>
                  ))}
                </Select.Content>
              </Select>
              <FieldHint>Empty: the service's policy, then the team's default</FieldHint>
            </FormField>
            <FormField>
              <Label>Priority</Label>
              <Select value={draft.then.priority ?? "mapping"} onChange={(v) => setThen({ priority: !v || v === "mapping" ? undefined : (v as Priority) })}>
                <Select.Content>
                  <Select.Option value="mapping">Use priority mapping</Select.Option>
                  {PRIORITIES.map((p) => (
                    <Select.Option key={p} value={p}>
                      {p}
                    </Select.Option>
                  ))}
                </Select.Content>
              </Select>
            </FormField>
            <FormField>
              <Label>Add tags</Label>
              <TextInput
                value={(draft.then.addTags ?? []).join(", ")}
                onChange={(v) => setThen({ addTags: v.split(",").map((x) => x.trim()).filter(Boolean) })}
                placeholder="env:prod, customer-facing"
              />
            </FormField>
            <Switch value={!!draft.then.suppress} onChange={(v) => setThen({ suppress: v || undefined })}>
              Suppress (create the incident, page nobody)
            </Switch>
          </Flex>
        </FieldSet>
      </Flex>
    </Sheet>
  );
};
