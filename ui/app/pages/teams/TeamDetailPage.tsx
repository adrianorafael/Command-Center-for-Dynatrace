import React, { useMemo, useState } from "react";
import { Link as RouterLink, useNavigate, useParams } from "react-router-dom";
import { Flex, Grid, PageLayout } from "@dynatrace/strato-components/layouts";
import { Button } from "@dynatrace/strato-components/buttons";
import { Avatar, Chip, InformationOverlay } from "@dynatrace/strato-components/content";
import { FormField, Label, Select } from "@dynatrace/strato-components/forms";
import { Menu, Tabs, Tab } from "@dynatrace/strato-components/navigation";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import { Heading, Link, Paragraph, Text } from "@dynatrace/strato-components/typography";
import { DotMenuIcon, PlusIcon } from "@dynatrace/strato-icons";
import Colors from "@dynatrace/strato-design-tokens/colors";
import type { TeamMember, TeamRole } from "../../domain/contracts";
import { useAppData, nextRev } from "../../hooks/AppDataContext";
import { newId, onCallAt } from "../../hooks/domain";
import { CellText, LIST_TABLE_VARIANT } from "../../components/tableKit";
import { PageTitle } from "../../components/PageTitle";
import { QueryState, SimpleEmpty } from "../../components/QueryState";
import { UserPicker } from "../../components/UserPicker";
import { ShiftGantt } from "../../components/ShiftGantt";
import { ConfirmModal } from "../../components/ConfirmModal";
import { initials, maskAddress } from "../../components/format";
import { CHANNEL_LABEL } from "../../components/ChannelIcon";
import { OnCallCard } from "../oncall/OnCallPage";
import { OverrideModal } from "../oncall/OverrideModal";
import { PolicyView } from "../escalations/PolicyView";
import { TeamFormModal, teamReferences } from "./TeamsPage";
import { ContactSheet } from "./ContactSheet";
import { QuietHoursEditor } from "./QuietHoursEditor";

export const ROLE_LABEL: Record<TeamRole, string> = { admin: "Team admin", responder: "Responder", observer: "Observer" };
const ROLE_HELP = "Team admins edit the team, schedules and policies. Responders receive pages and can acknowledge and resolve. Observers have read-only access and get no pages. Roles are guidance: every app user can technically write app state.";

interface MemberRow extends TeamMember {
  name: string;
  email?: string;
  onCall: boolean;
  methods: string;
}

export const TeamDetailPage = () => {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, error, refresh, now, userName, users, mutate } = useAppData();
  const team = data?.teams.find((t) => t.id === id);
  const [tab, setTab] = useState(0);
  const [pick, setPick] = useState<string | null>(null);
  const [role, setRole] = useState<TeamRole>("responder");
  const [edit, setEdit] = useState(false);
  const [contactUid, setContactUid] = useState<string>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [override, setOverride] = useState<{ scheduleId?: string }>();

  const schedules = useMemo(() => (data?.schedules ?? []).filter((s) => s.teamId === id), [data, id]);
  const onCallNow = useMemo(() => new Set(schedules.map((s) => onCallAt(s, now)?.uid).filter(Boolean)), [schedules, now]);
  const rows = useMemo<MemberRow[]>(
    () =>
      (team?.members ?? []).map((m) => {
        const c = data?.contacts.find((x) => x.uid === m.uid);
        return {
          ...m,
          name: userName(m.uid),
          email: users.get(m.uid)?.email,
          onCall: onCallNow.has(m.uid),
          methods: (c?.methods ?? []).map((x) => `${CHANNEL_LABEL[x.channel]} ${maskAddress(x.address)}`).join(", "),
        };
      }),
    [team, data, userName, users, onCallNow],
  );

  if (isLoading || error || !data)
    return (
      <PageLayout.Content>
        <Flex padding={16} flexDirection="column">
          <QueryState isLoading={isLoading} error={error} onRetry={() => void refresh()}>
            {null}
          </QueryState>
        </Flex>
      </PageLayout.Content>
    );
  if (!team)
    return (
      <PageLayout.Content>
        <Flex padding={16}>
          <SimpleEmpty title="Team not found" actions={<Button onClick={() => navigate("/teams")}>Back to teams</Button>} />
        </Flex>
      </PageLayout.Content>
    );

  const saveMembers = (members: TeamMember[], msg: string) => mutate((s) => s.saveTeam(nextRev({ ...team, members })), msg).catch(() => undefined);
  const policy = data.policies.find((p) => p.id === team.defaultPolicyId);
  const services = data.services.filter((s) => s.teamId === team.id || data.rules.rules.some((r) => r.then.teamId === team.id && r.then.serviceId === s.id));
  const refs = teamReferences(team.id, data);

  const columns: DataTableColumnDef<MemberRow>[] = [
    {
      id: "person",
      header: "Person",
      accessor: "name",
      width: "1fr",
      minWidth: 240,
      cell: ({ rowData }) => (
        <Avatar abbreviation={initials(rowData.name)}>
          <Avatar.Label>{rowData.name}</Avatar.Label>
          {rowData.email && <Avatar.Subtitle>{rowData.email}</Avatar.Subtitle>}
        </Avatar>
      ),
    },
    {
      id: "role",
      header: () => (
        <Flex alignItems="center" gap={4}>
          <Text>Role</Text>
          <InformationOverlay>
            <InformationOverlay.Trigger />
            <InformationOverlay.Content>{ROLE_HELP}</InformationOverlay.Content>
          </InformationOverlay>
        </Flex>
      ),
      label: "Role",
      accessor: "role",
      width: 140,
      cell: ({ rowData }) => (
        <Chip size="condensed" color={rowData.role === "admin" ? "primary" : "neutral"}>
          {ROLE_LABEL[rowData.role]}
        </Chip>
      ),
    },
    {
      id: "methods",
      header: "Contact methods",
      accessor: "methods",
      width: 260,
      cell: ({ rowData }) =>
        rowData.methods ? <CellText>{rowData.methods}</CellText> : <Text style={{ color: Colors.Text.Critical.Default }}>None: can't be paged</Text>,
    },
    { id: "oncall", header: "On call now", accessor: (r) => (r.onCall ? "Yes" : "No"), width: 110 },
  ];

  return (
    <PageLayout.Content>
      <Flex flexDirection="column" gap={16} padding={16}>
        <PageTitle
          crumbs={[{ label: "Teams", to: "/teams" }, { label: team.name }]}
          title={team.name}
          subtitle={team.description ?? "No description"}
          action={
            <Flex gap={8}>
              <Button onClick={() => setEdit(true)}>Edit team</Button>
              <Menu>
                <Menu.Trigger>
                  <Button aria-label="More team actions">
                    <Button.Prefix>
                      <DotMenuIcon />
                    </Button.Prefix>
                  </Button>
                </Menu.Trigger>
                <Menu.Content>
                  <Menu.Item
                    onSelect={() => {
                      const copy = { ...team, id: newId(team.name), name: `${team.name} (copy)`, rev: 0 };
                      void mutate((s) => s.saveTeam(copy), "Team duplicated").then(() => navigate(`/teams/${copy.id}`), () => undefined);
                    }}
                  >
                    Duplicate
                  </Menu.Item>
                  <Menu.Item onSelect={() => setConfirmDelete(true)}>Delete</Menu.Item>
                </Menu.Content>
              </Menu>
            </Flex>
          }
        />
        <Tabs selectedIndex={tab} onChange={setTab}>
          <Tab title={`Members (${team.members.length})`}>
            <Flex flexDirection="column" gap={12} paddingTop={16}>
              <Flex gap={8} alignItems="flex-end" flexWrap="wrap">
                <Flex flexDirection="column" style={{ minWidth: 320 }}>
                  <FormField>
                    <Label>Add member</Label>
                    <UserPicker value={pick} onChange={(u) => setPick(u)} exclude={team.members.map((m) => m.uid)} />
                  </FormField>
                </Flex>
                <FormField>
                  <Label>Role</Label>
                  <Select value={role} onChange={(v) => v && setRole(v)}>
                    <Select.Content>
                      {(Object.keys(ROLE_LABEL) as TeamRole[]).map((r) => (
                        <Select.Option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </Select.Option>
                      ))}
                    </Select.Content>
                  </Select>
                </FormField>
                <Button
                  disabled={!pick}
                  onClick={() => {
                    if (!pick) return;
                    void saveMembers([...team.members, { uid: pick, role }], "Member added");
                    setPick(null);
                  }}
                >
                  <Button.Prefix>
                    <PlusIcon />
                  </Button.Prefix>
                  Add member
                </Button>
              </Flex>
              <DataTable data={rows} columns={columns} rowId={(r) => r.uid} fullWidth sortable variant={LIST_TABLE_VARIANT}>
                <DataTable.RowActions>
                  {(row) => {
                    const r = row as MemberRow;
                    return (
                      <Menu>
                        <Menu.Trigger>
                          <Button size="condensed" aria-label={`Actions for ${r.name}`}>
                            <Button.Prefix>
                              <DotMenuIcon />
                            </Button.Prefix>
                          </Button>
                        </Menu.Trigger>
                        <Menu.Content>
                          <Menu.Sub>
                            <Menu.SubTrigger>Change role</Menu.SubTrigger>
                            <Menu.SubContent>
                              {(Object.keys(ROLE_LABEL) as TeamRole[]).map((ro) => (
                                <Menu.Item
                                  key={ro}
                                  disabled={ro === r.role}
                                  onSelect={() => void saveMembers(team.members.map((m) => (m.uid === r.uid ? { ...m, role: ro } : m)), "Role changed")}
                                >
                                  {ROLE_LABEL[ro]}
                                </Menu.Item>
                              ))}
                            </Menu.SubContent>
                          </Menu.Sub>
                          <Menu.Item onSelect={() => setContactUid(r.uid)}>Edit contact methods</Menu.Item>
                          <Menu.Item onSelect={() => void saveMembers(team.members.filter((m) => m.uid !== r.uid), "Member removed")}>Remove</Menu.Item>
                        </Menu.Content>
                      </Menu>
                    );
                  }}
                </DataTable.RowActions>
                <DataTable.EmptyState>
                  <SimpleEmpty size="small" title="No members yet" details="Search tenant users above. Members must be Dynatrace users." />
                </DataTable.EmptyState>
              </DataTable>
            </Flex>
          </Tab>
          <Tab title="On-call">
            <Flex flexDirection="column" gap={16} paddingTop={16}>
              {schedules.length === 0 ? (
                <SimpleEmpty
                  title="This team has no schedule"
                  details="Create a schedule so escalation policies can page whoever is on call."
                  actions={<Button onClick={() => navigate("/on-call/schedules/new")}>New schedule</Button>}
                />
              ) : (
                <>
                  <Grid gridTemplateColumns="repeat(auto-fill, minmax(280px, 1fr))" gap={12}>
                    {schedules.map((s) => (
                      <OnCallCard key={s.id} schedule={s} onAddOverride={(x) => setOverride({ scheduleId: x.id })} />
                    ))}
                  </Grid>
                  <ShiftGantt schedules={schedules} from={now - 2 * 3_600_000} to={now + 7 * 86_400_000} now={now} />
                  <Link as={RouterLink} to="/on-call?tab=schedules">
                    Manage schedules
                  </Link>
                </>
              )}
            </Flex>
          </Tab>
          <Tab title="Escalation">
            <Flex flexDirection="column" gap={12} paddingTop={16}>
              {policy ? (
                <>
                  <Heading level={3}>{policy.name}</Heading>
                  <PolicyView policy={policy} />
                  <Flex>
                    <Button onClick={() => navigate(`/escalations/${policy.id}`)}>Edit policy</Button>
                  </Flex>
                </>
              ) : (
                <SimpleEmpty
                  title="No default escalation policy"
                  details="Choose one in Edit team, or create a policy for this team."
                  actions={<Button onClick={() => navigate("/escalations/new")}>New escalation policy</Button>}
                />
              )}
            </Flex>
          </Tab>
          <Tab title={`Quiet hours (${team.quietHours?.length ?? 0})`}>
            <Flex flexDirection="column" paddingTop={16}>
              <QuietHoursEditor team={team} />
            </Flex>
          </Tab>
          <Tab title={`Services (${services.length})`}>
            <Flex flexDirection="column" gap={8} paddingTop={16}>
              {services.length === 0 ? (
                <Paragraph>No services are routed to this team.</Paragraph>
              ) : (
                services.map((s) => (
                  <Link key={s.id} as={RouterLink} to={`/services/${s.id}`}>
                    {s.name}
                  </Link>
                ))
              )}
            </Flex>
          </Tab>
        </Tabs>
      </Flex>
      <TeamFormModal team={team} show={edit} onClose={() => setEdit(false)} />
      <ContactSheet uid={contactUid} show={!!contactUid} onClose={() => setContactUid(undefined)} />
      <OverrideModal request={override} onClose={() => setOverride(undefined)} />
      {refs.length > 0 ? (
        <ConfirmModal
          show={confirmDelete}
          title={`Can't delete ${team.name} yet`}
          confirmLabel="OK"
          destructive={false}
          onDismiss={() => setConfirmDelete(false)}
          onConfirm={() => undefined}
        >
          {`Remove this team from ${refs.join(", ")} first.`}
        </ConfirmModal>
      ) : (
        <ConfirmModal
          show={confirmDelete}
          title={`Delete ${team.name}?`}
          onDismiss={() => setConfirmDelete(false)}
          onConfirm={() => mutate((s) => s.deleteTeam(team.id), "Team deleted").then(() => navigate("/teams"), () => undefined)}
        >
          The team and its member list are deleted.
        </ConfirmModal>
      )}
    </PageLayout.Content>
  );
};
