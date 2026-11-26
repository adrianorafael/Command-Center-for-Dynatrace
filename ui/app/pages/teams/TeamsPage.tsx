import React, { useMemo, useState } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { Flex, PageLayout } from "@dynatrace/strato-components/layouts";
import { Button } from "@dynatrace/strato-components/buttons";
import { AvatarGroup } from "@dynatrace/strato-components/content";
import { SearchInput, FormField, Label, TextInput, TextArea, Select } from "@dynatrace/strato-components/forms";
import { Modal } from "@dynatrace/strato-components/overlays";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import { Link, Text } from "@dynatrace/strato-components/typography";
import { PlusIcon } from "@dynatrace/strato-icons";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { PRIORITIES, SCHEMA_VERSION, type Priority, type Team } from "../../domain/contracts";
import { useAppData } from "../../hooks/AppDataContext";
import { newId, onCallAt, validateTeam } from "../../hooks/domain";
import { PageTitle } from "../../components/PageTitle";
import { QueryState, SimpleEmpty } from "../../components/QueryState";
import { PriorityChip } from "../../components/PriorityChip";
import { ConfirmModal } from "../../components/ConfirmModal";
import { initials } from "../../components/format";

interface TeamRow {
  id: string;
  name: string;
  team: Team;
  memberCount: number;
  onCall: string[];
  policyName?: string;
  policyId?: string;
  services: number;
  open: Partial<Record<Priority, number>>;
  openTotal: number;
}

/** Team create/edit modal (name, description, default policy). */
export const TeamFormModal = ({ team, show, onClose }: { team?: Team; show: boolean; onClose: (saved?: Team) => void }) => {
  const { data, mutate } = useAppData();
  const [name, setName] = useState(team?.name ?? "");
  const [description, setDescription] = useState(team?.description ?? "");
  const [policyId, setPolicyId] = useState<string | null>(team?.defaultPolicyId ?? null);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  React.useEffect(() => {
    if (show) {
      setName(team?.name ?? "");
      setDescription(team?.description ?? "");
      setPolicyId(team?.defaultPolicyId ?? null);
      setTried(false);
    }
  }, [show, team]);
  const draft: Team = {
    schemaVersion: SCHEMA_VERSION,
    id: team?.id ?? newId(name || "team"),
    rev: (team?.rev ?? 0) + 1,
    members: team?.members ?? [],
    name: name.trim(),
    ...(description.trim() ? { description: description.trim() } : {}),
    ...(policyId ? { defaultPolicyId: policyId } : {}),
    ...(team?.quietHours ? { quietHours: team.quietHours } : {}),
  };
  const errors = validateTeam(draft);
  const save = () => {
    setTried(true);
    if (errors.length) return;
    setBusy(true);
    mutate((s) => s.saveTeam(draft), team ? "Team saved" : "Team created")
      .then(() => onClose(draft))
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };
  return (
    <Modal
      title={team ? "Edit team" : "New team"}
      show={show}
      onDismiss={() => onClose()}
      footer={
        <Flex justifyContent="flex-end" gap={8}>
          <Button onClick={() => onClose()}>Cancel</Button>
          <Button color="primary" variant="accent" loading={busy} onClick={save}>
            {team ? "Save" : "Create team"}
          </Button>
        </Flex>
      }
    >
      <Flex flexDirection="column" gap={16}>
        <FormField required>
          <Label>Name</Label>
          <TextInput value={name} onChange={setName} placeholder="For example: Payments" />
          {tried && errors.some((e) => e.path === "name") && <Text style={{ color: Colors.Text.Critical.Default }}>Enter a team name.</Text>}
        </FormField>
        <FormField>
          <Label>Description</Label>
          <TextArea value={description} onChange={setDescription} />
        </FormField>
        <FormField>
          <Label>Default escalation policy</Label>
          <Select value={policyId} onChange={(v) => setPolicyId(v)} clearable>
            <Select.Content>
              {(data?.policies ?? []).map((p) => (
                <Select.Option key={p.id} value={p.id}>
                  {p.name}
                </Select.Option>
              ))}
            </Select.Content>
          </Select>
        </FormField>
      </Flex>
    </Modal>
  );
};

export function teamReferences(teamId: string, data: NonNullable<ReturnType<typeof useAppData>["data"]>): string[] {
  const refs: string[] = [];
  const pol = data.policies.filter((p) => p.teamId === teamId || p.steps.some((s) => s.targets.some((t) => t.type === "team" && t.teamId === teamId)));
  if (pol.length) refs.push(`${pol.length} escalation ${pol.length === 1 ? "policy" : "policies"}`);
  const rules = data.rules.rules.filter((r) => r.then.teamId === teamId);
  if (rules.length) refs.push(`${rules.length} routing ${rules.length === 1 ? "rule" : "rules"}`);
  const svc = data.services.filter((s) => s.teamId === teamId);
  if (svc.length) refs.push(`${svc.length} ${svc.length === 1 ? "service" : "services"}`);
  return refs;
}

export const TeamsPage = () => {
  const { data, isLoading, error, refresh, now, userName, mutate } = useAppData();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [toDelete, setToDelete] = useState<Team>();

  const rows = useMemo<TeamRow[]>(() => {
    if (!data) return [];
    return data.teams
      .filter((t) => !q || t.name.toLowerCase().includes(q.toLowerCase()))
      .map((t) => {
        const onCall = data.schedules
          .filter((s) => s.teamId === t.id)
          .map((s) => onCallAt(s, now)?.uid)
          .filter((u): u is string => !!u);
        const open: Partial<Record<Priority, number>> = {};
        data.incidents
          .filter((i) => i.teamId === t.id && i.status !== "resolved")
          .forEach((i) => (open[i.priority] = (open[i.priority] ?? 0) + 1));
        const policy = data.policies.find((p) => p.id === t.defaultPolicyId);
        return {
          id: t.id,
          name: t.name,
          team: t,
          memberCount: t.members.length,
          onCall: [...new Set(onCall)],
          policyName: policy?.name,
          policyId: policy?.id,
          services: data.services.filter((s) => s.teamId === t.id).length,
          open,
          openTotal: Object.values(open).reduce((a, b) => a + (b ?? 0), 0),
        };
      });
  }, [data, q, now]);

  const columns: DataTableColumnDef<TeamRow>[] = [
    {
      id: "name",
      header: "Name",
      accessor: "name",
      width: 200,
      cell: ({ rowData }) => (
        <Link as={RouterLink} to={`/teams/${rowData.id}`}>
          {rowData.name}
        </Link>
      ),
    },
    {
      id: "members",
      header: "Members",
      accessor: "memberCount",
      width: 180,
      sortType: "number",
      cell: ({ rowData }) => (
        <AvatarGroup>
          {rowData.team.members.map((m) => (
            <AvatarGroup.Item key={m.uid} abbreviation={initials(userName(m.uid))} tooltipText={userName(m.uid)} />
          ))}
        </AvatarGroup>
      ),
    },
    {
      id: "oncall",
      header: "On call now",
      accessor: (r) => r.onCall.map(userName).join(", "),
      width: 200,
      cell: ({ rowData }) =>
        rowData.onCall.length ? <Text>{rowData.onCall.map(userName).join(", ")}</Text> : <Text style={{ color: Colors.Text.Neutral.Subdued }}>No one</Text>,
    },
    {
      id: "policy",
      header: "Escalation policy",
      accessor: (r) => r.policyName ?? "",
      width: 200,
      cell: ({ rowData }) =>
        rowData.policyId ? (
          <Link as={RouterLink} to={`/escalations/${rowData.policyId}`}>
            {rowData.policyName}
          </Link>
        ) : (
          <Text style={{ color: Colors.Text.Neutral.Subdued }}>None</Text>
        ),
    },
    { id: "services", header: "Services", accessor: "services", width: 90, sortType: "number" },
    {
      id: "open",
      header: "Open incidents",
      accessor: "openTotal",
      sortType: "number",
      width: "1fr",
      minWidth: 200,
      cell: ({ rowData }) =>
        rowData.openTotal ? (
          <Flex gap={4} flexWrap="wrap">
            {PRIORITIES.filter((p) => rowData.open[p]).map((p) => (
              <PriorityChip key={p} priority={p} size="condensed" count={rowData.open[p]} />
            ))}
          </Flex>
        ) : (
          <Text style={{ color: Colors.Text.Neutral.Subdued }}>None</Text>
        ),
    },
  ];

  const deleteRefs = toDelete && data ? teamReferences(toDelete.id, data) : [];

  return (
    <PageLayout.Content>
      <Flex flexDirection="column" gap={16} padding={16}>
        <PageTitle
          title="Teams"
          subtitle="Members are Dynatrace users. Roles decide who edits, who is paged, and who only watches."
          action={
            <Button color="primary" variant="accent" onClick={() => setShowNew(true)}>
              <Button.Prefix>
                <PlusIcon />
              </Button.Prefix>
              New team
            </Button>
          }
        />
        <QueryState
          isLoading={isLoading}
          error={error}
          errorTitle="Couldn't load teams"
          onRetry={() => void refresh()}
          isEmpty={!!data && data.teams.length === 0}
          empty={
            <SimpleEmpty
              title="Create your first team"
              details="Teams group the people who respond to incidents for a set of services."
              actions={
                <Button variant="accent" color="primary" onClick={() => setShowNew(true)}>
                  New team
                </Button>
              }
            />
          }
        >
          <DataTable data={rows} columns={columns} rowId={(r) => r.id} fullWidth sortable variant={{ rowDensity: "condensed" }}>
            <DataTable.TableActions>
              <SearchInput value={q} onChange={setQ} placeholder="Search teams" aria-label="Search teams" />
            </DataTable.TableActions>
            <DataTable.RowActions>
              {(row) => {
                const r = row as TeamRow;
                return (
                  <Flex gap={4}>
                    <Button size="condensed" onClick={() => navigate(`/teams/${r.id}`)}>
                      Edit
                    </Button>
                    <Button size="condensed" color="critical" onClick={() => setToDelete(r.team)}>
                      Delete
                    </Button>
                  </Flex>
                );
              }}
            </DataTable.RowActions>
          </DataTable>
        </QueryState>
      </Flex>
      <TeamFormModal show={showNew} onClose={(t) => (setShowNew(false), t && navigate(`/teams/${t.id}`))} />
      {toDelete && deleteRefs.length > 0 ? (
        <ConfirmModal
          show
          title={`Can't delete ${toDelete.name} yet`}
          confirmLabel="OK"
          destructive={false}
          onDismiss={() => setToDelete(undefined)}
          onConfirm={() => undefined}
        >
          {`Remove this team from ${deleteRefs.join(", ")} first.`}
        </ConfirmModal>
      ) : (
        <ConfirmModal
          show={!!toDelete}
          title={`Delete ${toDelete?.name ?? "team"}?`}
          onDismiss={() => setToDelete(undefined)}
          onConfirm={() => (toDelete ? mutate((s) => s.deleteTeam(toDelete.id), "Team deleted").catch(() => undefined) : undefined)}
        >
          The team and its member list are deleted. Schedules keep their participants.
        </ConfirmModal>
      )}
    </PageLayout.Content>
  );
};
