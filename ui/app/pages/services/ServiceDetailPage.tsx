import { FieldHint } from "../../components/FieldHint";
import React, { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Flex, PageLayout } from "@dynatrace/strato-components/layouts";
import { Button } from "@dynatrace/strato-components/buttons";
import { MessageContainer } from "@dynatrace/strato-components/content";
import { FieldSet, FormField, Label, Select, TextArea, TextInput } from "@dynatrace/strato-components/forms";
import { Tabs, Tab } from "@dynatrace/strato-components/navigation";
import { PRIORITIES, type Priority, type Service } from "../../domain/contracts";
import { useAppData, nextRev } from "../../hooks/AppDataContext";
import { validateService } from "../../hooks/domain";
import { PageTitle } from "../../components/PageTitle";
import { QueryState, SimpleEmpty } from "../../components/QueryState";
import { RulesTab, TestTab, newService } from "./ServicesPage";

export const ServiceDetailPage = () => {
  const { id = "new" } = useParams();
  const [search] = useSearchParams();
  const presetTeam = search.get("teamId") ?? undefined;
  /** Only in-app paths, so a crafted link can't send the user elsewhere. */
  const returnTo = (() => {
    const r = search.get("returnTo");
    return r && r.startsWith("/") && !r.startsWith("//") ? r : undefined;
  })();
  const navigate = useNavigate();
  const { data, isLoading, error, refresh, mutate } = useAppData();
  const existing = data?.services.find((s) => s.id === id);
  const isNew = id === "new";
  const [draft, setDraft] = useState<Service>();
  const [tab, setTab] = useState(0);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!draft && data) setDraft(existing ?? { ...newService(presetTeam ?? data.teams[0]?.id), policyId: data.teams.find((t) => t.id === presetTeam)?.defaultPolicyId });
  }, [data, existing, draft, presetTeam]);

  if (!draft || isLoading || error)
    return (
      <PageLayout.Content>
        <Flex padding={16} flexDirection="column">
          <QueryState isLoading={isLoading || !draft} error={error} onRetry={() => void refresh()}>
            {null}
          </QueryState>
        </Flex>
      </PageLayout.Content>
    );
  if (!isNew && !existing)
    return (
      <PageLayout.Content>
        <Flex padding={16}>
          <SimpleEmpty title="Service not found" actions={<Button onClick={() => navigate("/services")}>Back to services</Button>} />
        </Flex>
      </PageLayout.Content>
    );

  const errors = validateService(draft, { teams: data?.teams, policies: data?.policies });
  const save = () => {
    setTried(true);
    if (errors.length) return;
    setSaving(true);
    mutate((s) => s.saveService(nextRev(draft)), isNew ? "Service created" : "Service saved")
      .then(() => isNew && navigate(returnTo ?? `/services/${draft.id}`, { replace: !returnTo }))
      .catch(() => undefined)
      .finally(() => setSaving(false));
  };

  const form = (
    <Flex flexDirection="column" gap={16} style={{ maxWidth: 480 }}>
      {tried && errors.length > 0 && (
        <MessageContainer variant="critical">
          <MessageContainer.Title>To save this service:</MessageContainer.Title>
          <MessageContainer.Description>
            {errors.map((e) => `· ${e.path === "name" ? "Enter a name" : e.path === "teamId" ? "Choose an owning team" : e.message}`).join("  ")}
          </MessageContainer.Description>
        </MessageContainer>
      )}
      <FieldSet>
        <FieldSet.Legend>Service</FieldSet.Legend>
        <Flex flexDirection="column" gap={16}>
          <FormField required>
            <Label>Name</Label>
            <TextInput value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} />
            <FieldHint>Events can reference the service by this name or its ID ({draft.id}) in cc.service</FieldHint>
          </FormField>
          <FormField>
            <Label>Description</Label>
            <TextArea value={draft.description ?? ""} onChange={(v) => setDraft({ ...draft, description: v || undefined })} />
          </FormField>
          <FormField required>
            <Label>Owning team</Label>
            <Select value={draft.teamId || null} onChange={(v) => setDraft({ ...draft, teamId: v ?? "" })}>
              <Select.Content>
                {(data?.teams ?? []).map((t) => (
                  <Select.Option key={t.id} value={t.id}>
                    {t.name}
                  </Select.Option>
                ))}
              </Select.Content>
            </Select>
          </FormField>
          <FormField>
            <Label>Escalation policy</Label>
            <Select value={draft.policyId ?? null} onChange={(v) => setDraft({ ...draft, policyId: v ?? undefined })} clearable>
              <Select.Content>
                {(data?.policies ?? []).map((p) => (
                  <Select.Option key={p.id} value={p.id}>
                    {p.name}
                  </Select.Option>
                ))}
              </Select.Content>
            </Select>
            <FieldHint>Empty: the team's default policy</FieldHint>
          </FormField>
          <FormField>
            <Label>Default priority</Label>
            <Select value={draft.defaultPriority ?? null} onChange={(v) => setDraft({ ...draft, defaultPriority: (v as Priority) ?? undefined })} clearable>
              <Select.Content>
                {PRIORITIES.map((p) => (
                  <Select.Option key={p} value={p}>
                    {p}
                  </Select.Option>
                ))}
              </Select.Content>
            </Select>
            <FieldHint>Used when no rule and no cc.priority set one</FieldHint>
          </FormField>
        </Flex>
      </FieldSet>
    </Flex>
  );

  return (
    <PageLayout.Content>
      <Flex flexDirection="column" gap={16} padding={16}>
        <PageTitle
          crumbs={[{ label: "Services", to: "/services" }, { label: draft.name || "New service" }]}
          title={draft.name || "New service"}
          subtitle={isNew ? "Create the service, then add routing rules for it" : "Rules are evaluated top to bottom; first match wins"}
          action={
            <Flex gap={8}>
              <Button onClick={() => navigate(returnTo ?? "/services")}>Cancel</Button>
              <Button color="primary" variant="accent" loading={saving} onClick={save}>
                Save
              </Button>
            </Flex>
          }
        />
        {isNew ? (
          form
        ) : (
          <Tabs selectedIndex={tab} onChange={setTab}>
            <Tab title="Settings">
              <Flex paddingTop={16} flexDirection="column">
                {form}
              </Flex>
            </Tab>
            <Tab title="Routing rules">
              <Flex paddingTop={16} flexDirection="column">
                <RulesTab onlyService={draft.id} />
              </Flex>
            </Tab>
            <Tab title="Test a rule">
              <Flex paddingTop={16} flexDirection="column">
                <TestTab />
              </Flex>
            </Tab>
          </Tabs>
        )}
      </Flex>
    </PageLayout.Content>
  );
};
