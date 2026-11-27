/** Escalation policies list (route `/escalations`). */
import { markCreated } from "../../components/NewItemHighlight";
import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Flex, PageLayout } from "@dynatrace/strato-components/layouts";
import { Button } from "@dynatrace/strato-components/buttons";
import { DataTable, type DataTableColumnDef } from "@dynatrace/strato-components/tables";
import { Text } from "@dynatrace/strato-components/typography";
import { PlusIcon } from "@dynatrace/strato-icons";
import type { EscalationPolicy } from "../../domain/contracts";
import { useAppData } from "../../hooks/AppDataContext";
import { newId } from "../../hooks/domain";
import { CellEmpty, CellText, LIST_TABLE_VARIANT, CellLink, Cell, withCreatedMarker } from "../../components/tableKit";
import { PageTitle } from "../../components/PageTitle";
import { QueryState, SimpleEmpty } from "../../components/QueryState";
import { ConfirmModal } from "../../components/ConfirmModal";
import { formatRelative } from "../../components/format";

interface PolicyRow {
  id: string;
  name: string;
  team: string;
  steps: number;
  summary: string;
  repeat: number;
  usedBy: number;
  lastTriggered: number;
  policy: EscalationPolicy;
}

export const PoliciesPage = () => {
  const { data, isLoading, error, refresh, now, mutate, userName } = useAppData();
  const navigate = useNavigate();
  const [toDelete, setToDelete] = useState<EscalationPolicy>();
  const rows = useMemo<PolicyRow[]>(
    () =>
      (data?.policies ?? []).map((p) => {
        // Who is notified at each step (first target, "+N" for more), with the wait before later steps.
        const summary = p.steps
          .map((s, i) => {
            const t = s.targets[0];
            const who = !t
              ? "nobody"
              : t.type === "user"
                ? userName(t.uid)
                : t.type === "team"
                  ? `team ${data?.teams.find((x) => x.id === t.teamId)?.name ?? "?"}`
                  : `on-call of ${data?.schedules.find((x) => x.id === t.scheduleId)?.name ?? "?"}`;
            const more = s.targets.length > 1 ? ` +${s.targets.length - 1}` : "";
            return `${i > 0 ? `${s.delayMinutes} min → ` : ""}${who}${more}`;
          })
          .join(" → ");
        const used = (data?.services ?? []).filter((s) => s.policyId === p.id).length + (data?.teams ?? []).filter((t) => t.defaultPolicyId === p.id).length;
        const last = Math.max(0, ...(data?.incidents ?? []).filter((i) => i.policyId === p.id).map((i) => i.escalation.startedAt));
        return {
          id: p.id,
          name: p.name,
          team: data?.teams.find((t) => t.id === p.teamId)?.name ?? "–",
          steps: p.steps.length,
          summary,
          repeat: p.repeat,
          usedBy: used,
          lastTriggered: last,
          policy: p,
        };
      }),
    [data, userName],
  );
  const columns: DataTableColumnDef<PolicyRow>[] = [
    {
      id: "name",
      header: "Name",
      accessor: "name",
      width: 220,
      cell: ({ rowData }) => <CellLink to={`/escalations/${rowData.id}`}>{rowData.name}</CellLink>,
    },
    { id: "team", header: "Team", accessor: "team", width: 140 },
    {
      id: "steps",
      header: "Steps",
      accessor: "steps",
      width: "1fr",
      minWidth: 260,
      cell: ({ rowData }) => <CellText>{`${rowData.steps} · ${rowData.summary}`}</CellText>,
    },
    { id: "repeat", header: "Repeat", accessor: (r) => (r.repeat ? `${r.repeat}×` : "No"), width: 90 },
    { id: "used", header: "Used by", accessor: "usedBy", width: 90, sortType: "number" },
    {
      id: "last",
      header: "Last triggered",
      accessor: "lastTriggered",
      sortType: "number",
      width: 140,
      cell: ({ rowData }) =>
        rowData.lastTriggered ? <Cell><Text>{formatRelative(rowData.lastTriggered, now)}</Text></Cell> : <CellEmpty>Never</CellEmpty>,
    },
  ];
  return (
    <PageLayout.Content>
      <Flex flexDirection="column" gap={16} padding={16}>
        <PageTitle
          title="Escalation policies"
          subtitle="Who gets notified, on which channels, and how long to wait before escalating"
          action={
            <Button color="primary" variant="accent" onClick={() => navigate("/escalations/new")}>
              <Button.Prefix>
                <PlusIcon />
              </Button.Prefix>
              New escalation policy
            </Button>
          }
        />
        <QueryState
          isLoading={isLoading}
          error={error}
          errorTitle="Couldn't load escalation policies"
          onRetry={() => void refresh()}
          isEmpty={!!data && rows.length === 0}
          empty={
            <SimpleEmpty
              title="No escalation policies yet"
              details="Define who gets notified, on which channels, and how long to wait before escalating."
              actions={
                <Button variant="accent" color="primary" onClick={() => navigate("/escalations/new")}>
                  New escalation policy
                </Button>
              }
            />
          }
        >
          <DataTable data={rows} columns={withCreatedMarker(columns, "policy", (r) => r.id)} rowId={(r) => r.id} fullWidth sortable variant={LIST_TABLE_VARIANT}>
            <DataTable.RowActions>
              {(row) => {
                const r = row as PolicyRow;
                return (
                  <Flex gap={4}>
                    <Button size="condensed" onClick={() => navigate(`/escalations/${r.id}`)}>
                      Edit
                    </Button>
                    <Button
                      size="condensed"
                      onClick={() =>
                        void mutate((s) => { const id = newId(r.name); markCreated("policy", id); return s.savePolicy({ ...r.policy, id, name: `${r.name} (copy)`, rev: 0 }); }, "Policy duplicated").catch(
                          () => undefined,
                        )
                      }
                    >
                      Duplicate
                    </Button>
                    <Button size="condensed" color="critical" onClick={() => setToDelete(r.policy)}>
                      Delete
                    </Button>
                  </Flex>
                );
              }}
            </DataTable.RowActions>
          </DataTable>
        </QueryState>
      </Flex>
      <ConfirmModal
        show={!!toDelete}
        title={`Delete ${toDelete?.name ?? "policy"}?`}
        onDismiss={() => setToDelete(undefined)}
        onConfirm={() => (toDelete ? mutate((s) => s.deletePolicy(toDelete.id), "Policy deleted").catch(() => undefined) : undefined)}
      >
        Incidents routed to this policy fall back to their team's default policy, or else the default policy from Settings.
      </ConfirmModal>
    </PageLayout.Content>
  );
};
