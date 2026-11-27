import React, { useMemo, useState } from "react";
import { Link as RouterLink, useNavigate, useParams } from "react-router-dom";
import { Flex, Grid, PageLayout } from "@dynatrace/strato-components/layouts";
import { Button, InlineButton } from "@dynatrace/strato-components/buttons";
import { Avatar, Chip, InformationOverlay } from "@dynatrace/strato-components/content";
import { Menu, Tabs, Tab } from "@dynatrace/strato-components/navigation";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import { Heading, Link, Paragraph, Text } from "@dynatrace/strato-components/typography";
import { DotMenuIcon, PlusIcon, WarningIcon } from "@dynatrace/strato-icons";
import Colors from "@dynatrace/strato-design-tokens/colors";
import type { TeamMember, TeamRole } from "../../domain/contracts";
import { useAppData, nextRev } from "../../hooks/AppDataContext";
import { newId, onCallAt } from "../../hooks/domain";
import { Cell, CellText, LIST_TABLE_VARIANT, withCreatedMarker } from "../../components/tableKit";
import { PageTitle } from "../../components/PageTitle";
import { QueryState, SimpleEmpty } from "../../components/QueryState";
import { ShiftGantt } from "../../components/ShiftGantt";
import { ConfirmModal } from "../../components/ConfirmModal";
import { initials, maskAddress } from "../../components/format";
import { CHANNEL_LABEL } from "../../components/ChannelIcon";
import { OnCallCard } from "../oncall/OnCallPage";
import { OverrideModal } from "../oncall/OverrideModal";
import { PolicyView } from "../escalations/PolicyView";
import { TeamFormModal, deleteTeamAndDefault, teamReferences } from "./TeamsPage";
import { ContactSheet } from "./ContactSheet";
import { QuietHoursEditor } from "./QuietHoursEditor";
import { AddPeopleModal } from "./AddPeopleModal";
import { TeamReadiness, deliveryIssues, teamReadiness, type ReadinessFix } from "./TeamReadiness";

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
  const { data, isLoading, error, refresh, now, userName, users, mutate, demo } = useAppData();
  const team = data?.teams.find((t) => t.id === id);
  const [tab, setTab] = useState(0);
  const [addPeople, setAddPeople] = useState(false);
  /** True while contact methods are being filled in for one person after another (checklist flow). */
  const [contactSequence, setContactSequence] = useState(false);
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
  const readiness = teamReadiness(team, data, userName);
  const back = `returnTo=${encodeURIComponent(`/teams/${team.id}`)}`;
  const hasContact = (uid: string) => (data.contacts.find((c) => c.uid === uid)?.methods.length ?? 0) > 0;
  /** People who get paged but have no contact method yet, in table order. */
  const missingContacts = team.members.filter((m) => m.role !== "observer" && !hasContact(m.uid)).map((m) => m.uid);
  const nextContactUid = contactSequence ? missingContacts.find((u) => u !== contactUid) : undefined;
  const fix = (key: ReadinessFix) => {
    if (key === "members") {
      setTab(0);
      setAddPeople(true);
    } else if (key === "contacts") {
      setTab(0);
      const first = missingContacts[0];
      if (first) {
        setContactSequence(true);
        setContactUid(first);
      }
    } else if (key === "schedule") navigate(`/on-call/schedules/new?teamId=${team.id}&${back}`);
    else if (key === "policy") {
      if (data.policies.some((p) => p.teamId === team.id)) setEdit(true);
      else navigate(`/escalations/new?teamId=${team.id}&${back}`);
    } else if (readiness.find((r) => r.key === "routing")?.routingFix === "default-team") {
      // No default team yet: one click makes this team receive everything that no rule routes elsewhere.
      void mutate(
        (s) => s.saveSettings(nextRev({ ...data.settings, defaults: { ...data.settings.defaults, teamId: team.id } })),
        `${team.name} now receives every alert that no routing rule sends elsewhere`,
      ).catch(() => undefined);
    } else navigate(`/services?tab=rules&newRule=1&teamId=${encodeURIComponent(team.id)}`);
  };
  const help = (text: string) => (
    <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued }}>
      {text}
    </Text>
  );
  const addPeopleButton = (
    <Button color="primary" variant="accent" onClick={() => setAddPeople(true)}>
      <Button.Prefix>
        <PlusIcon />
      </Button.Prefix>
      Add people
    </Button>
  );

  const columns: DataTableColumnDef<MemberRow>[] = [
    {
      id: "person",
      header: "Person",
      accessor: "name",
      width: "1fr",
      minWidth: 240,
      cell: ({ rowData }) => (
        <Cell>
          <Avatar abbreviation={initials(rowData.name)}>
            <Avatar.Label>{rowData.name}</Avatar.Label>
            {rowData.email && <Avatar.Subtitle>{rowData.email}</Avatar.Subtitle>}
          </Avatar>
        </Cell>
      ),
    },
    {
      id: "role",
      header: () => (
        // Custom headers don't get the default header inset; match plain headers (12 px).
        <Flex alignItems="center" gap={4} style={{ paddingLeft: 12 }}>
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
        <Cell>
          <Chip size="condensed" color={rowData.role === "admin" ? "primary" : "neutral"}>
            {ROLE_LABEL[rowData.role]}
          </Chip>
        </Cell>
      ),
    },
    {
      id: "methods",
      header: "Contact methods",
      accessor: "methods",
      width: 320,
      cell: ({ rowData }) =>
        rowData.methods ? (
          <Flex alignItems="center" gap={8} style={{ minWidth: 0, paddingRight: 12 }}>
            <Flex style={{ minWidth: 0 }} flexGrow={1}>
              <CellText>{rowData.methods}</CellText>
            </Flex>
            <InlineButton onClick={() => (setContactSequence(false), setContactUid(rowData.uid))} aria-label={`Edit the contact methods of ${rowData.name}`}>
              Edit
            </InlineButton>
          </Flex>
        ) : (
          <Cell>
          <Flex alignItems="center" gap={8}>
            <WarningIcon style={{ color: Colors.Icon.Warning.Default }} />
            <Text>{rowData.role === "observer" ? "No contact method" : "No contact method: can't be paged"}</Text>
            <InlineButton onClick={() => (setContactSequence(true), setContactUid(rowData.uid))} aria-label={`Add a contact method for ${rowData.name}`}>
              Add
            </InlineButton>
          </Flex>
          </Cell>
        ),
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
        <TeamReadiness items={readiness} onFix={fix} delivery={deliveryIssues(team, data, demo)} onOpen={(to) => navigate(to)} />
        <Tabs selectedIndex={tab} onChange={setTab}>
          <Tab title={`Members (${team.members.length})`}>
            <Flex flexDirection="column" gap={12} paddingTop={16}>
              {team.members.length > 0 && (
                <Flex alignItems="center" justifyContent="space-between" gap={8} flexWrap="wrap">
                  {help("Responders and team admins get paged. Observers only watch.")}
                  {addPeopleButton}
                </Flex>
              )}
              {team.members.length === 0 ? (
                <SimpleEmpty title="Add the people who respond for this team" details="Search your Dynatrace users and choose who gets paged." />
              ) : (
              <DataTable data={rows} columns={withCreatedMarker(columns, "member", (r) => r.uid)} rowId={(r) => r.uid} fullWidth sortable variant={LIST_TABLE_VARIANT}>
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
                          <Menu.Item onSelect={() => (setContactSequence(false), setContactUid(r.uid))}>Edit contact methods</Menu.Item>
                          <Menu.Item onSelect={() => void saveMembers(team.members.filter((m) => m.uid !== r.uid), "Member removed")}>Remove</Menu.Item>
                        </Menu.Content>
                      </Menu>
                    );
                  }}
                </DataTable.RowActions>
              </DataTable>
              )}
            </Flex>
          </Tab>
          <Tab title="On-call">
            <Flex flexDirection="column" gap={16} paddingTop={16}>
              {help("A schedule rotates the team's members and decides who is on call at any moment. Escalation steps that target the schedule page that person.")}
              {schedules.length === 0 ? (
                <SimpleEmpty
                  title="This team has no schedule"
                  details="Create a schedule so escalation policies can page whoever is on call."
                  actions={<Button onClick={() => navigate(`/on-call/schedules/new?teamId=${team.id}&${back}`)}>New schedule</Button>}
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
              {help("The default escalation policy decides who is notified, on which channels, and how long to wait before the next step when an incident for this team triggers.")}
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
                  actions={
                    <Flex gap={8}>
                      <Button onClick={() => navigate(`/escalations/new?teamId=${team.id}&${back}`)}>New escalation policy</Button>
                      {data.policies.length > 0 && <Button onClick={() => setEdit(true)}>Choose existing policy</Button>}
                    </Flex>
                  }
                />
              )}
            </Flex>
          </Tab>
          <Tab title={`Quiet hours (${team.quietHours?.length ?? 0})`}>
            <Flex flexDirection="column" gap={12} paddingTop={16}>
              {help("Quiet hours hold or soften paging for less urgent incidents in a time window, for example at night. Urgent incidents still page.")}
              <QuietHoursEditor team={team} />
            </Flex>
          </Tab>
          <Tab title={`Services (${services.length})`}>
            <Flex flexDirection="column" gap={8} paddingTop={16}>
              {help(
                data.settings.defaults.teamId === team.id
                  ? "This is the default team: it receives every alert that no routing rule sends elsewhere. Services and routing rules refine that."
                  : "Routing rules decide which alerts become this team's incidents. An event can also name one of the team's services in cc.service.",
              )}
              {services.length === 0 ? (
                <Flex flexDirection="column" gap={8}>
                  <Paragraph>No services are routed to this team.</Paragraph>
                  <Flex>
                    <Button onClick={() => navigate(`/services/new?teamId=${team.id}&${back}`)}>New service for this team</Button>
                  </Flex>
                </Flex>
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
      <ContactSheet
        uid={contactUid}
        show={!!contactUid}
        onClose={() => setContactUid(undefined)}
        next={nextContactUid ? { uid: nextContactUid, name: userName(nextContactUid) } : undefined}
        onNext={(uid) => setContactUid(uid)}
      />
      <AddPeopleModal team={team} show={addPeople} onClose={() => setAddPeople(false)} />
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
          onConfirm={() => mutate((s) => deleteTeamAndDefault(s, team.id, data), "Team deleted").then(() => navigate("/teams"), () => undefined)}
        >
          The team and its member list are deleted.
        </ConfirmModal>
      )}
    </PageLayout.Content>
  );
};
