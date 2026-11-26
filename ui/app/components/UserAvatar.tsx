import React from "react";
import { Avatar } from "@dynatrace/strato-components/content";
import { Text } from "@dynatrace/strato-components/typography";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { useAppData } from "../hooks/AppDataContext";
import type { Assignee } from "../domain/contracts";
import { initials } from "./format";

/** Avatar + name. Never shows the email in tables (DESIGN §14). */
export const UserAvatar = ({ uid, subtitle, size = "small" }: { uid: string; subtitle?: React.ReactNode; size?: "small" | "default" }) => {
  const { userName } = useAppData();
  const name = userName(uid);
  return (
    <Avatar size={size} abbreviation={initials(name)}>
      <Avatar.Label>{name}</Avatar.Label>
      {subtitle && <Avatar.Subtitle>{subtitle}</Avatar.Subtitle>}
    </Avatar>
  );
};

export const AssigneeView = ({ assignee }: { assignee?: Assignee }) => {
  const { data } = useAppData();
  if (!assignee) return <Text style={{ color: Colors.Text.Neutral.Subdued }}>Unassigned</Text>;
  if (assignee.type === "team") {
    const team = data?.teams.find((t) => t.id === assignee.id);
    return (
      <Avatar size="small" abbreviation={initials(team?.name ?? assignee.id)}>
        <Avatar.Label>{team?.name ?? assignee.id}</Avatar.Label>
      </Avatar>
    );
  }
  return <UserAvatar uid={assignee.id} />;
};
