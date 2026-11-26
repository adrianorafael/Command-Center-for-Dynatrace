import React, { useMemo } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { AppHeader, HelpMenu } from "@dynatrace/strato-components/layouts";
import { Button } from "@dynatrace/strato-components/buttons";
import { Tooltip } from "@dynatrace/strato-components/overlays";
import { Menu } from "@dynatrace/strato-components/navigation";
import { Avatar } from "@dynatrace/strato-components/content";
import { NotificationActiveIcon, SettingIcon, WarningIcon } from "@dynatrace/strato-icons";
import { useAppData } from "../hooks/AppDataContext";
import { isRuntimeMissing, onCallAt } from "../hooks/domain";
import { formatDayTime, initials, zoneAbbr } from "./format";

interface OnCallEntry {
  scheduleId: string;
  scheduleName: string;
  teamName: string;
  uid?: string;
  until?: number;
  timeZone: string;
}

/** Global "who is on call now" indicator (DESIGN §3.3). */
const OnCallNowAction = () => {
  const { data, error, now, currentUser, userName } = useAppData();
  const navigate = useNavigate();

  const entries = useMemo<OnCallEntry[]>(() => {
    if (!data) return [];
    return data.schedules.map((s) => {
      const oc = onCallAt(s, now);
      const team = data.teams.find((t) => t.id === s.teamId);
      return {
        scheduleId: s.id,
        scheduleName: s.name,
        teamName: team?.name ?? "No team",
        uid: oc?.uid,
        until: oc?.to,
        timeZone: s.timeZone,
      };
    });
  }, [data, now]);

  const mine = entries.some((e) => e.uid === currentUser.uid);
  const covered = entries.filter((e) => e.uid);
  let label = "On call";
  if (data && entries.length === 0) label = "No one on call";
  else if (mine) label = "You're on call";
  else if (covered.length > 0) {
    const first = userName(covered[0].uid).split(" ")[0];
    const others = new Set(covered.map((c) => c.uid)).size - 1;
    label = others > 0 ? `On call: ${first} +${others}` : `On call: ${first}`;
  }

  if (error) {
    return (
      <Tooltip text="Couldn't load schedules. Open the on-call overview for details.">
        <AppHeader.ActionButton prefixIcon={<WarningIcon />} onClick={() => navigate("/on-call")}>
          On call
        </AppHeader.ActionButton>
      </Tooltip>
    );
  }

  const byTeam = new Map<string, OnCallEntry[]>();
  entries.forEach((e) => byTeam.set(e.teamName, [...(byTeam.get(e.teamName) ?? []), e]));

  return (
    <Menu>
      <Menu.Trigger>
        <AppHeader.ActionButton prefixIcon={<NotificationActiveIcon />}>{label}</AppHeader.ActionButton>
      </Menu.Trigger>
      <Menu.Content>
        {[...byTeam.entries()].map(([team, list]) => (
          <Menu.Group key={team}>
            <Menu.Label>{team}</Menu.Label>
            {list.map((e) => (
              <Menu.Item key={e.scheduleId} onSelect={() => navigate(`/on-call/schedules/${e.scheduleId}`)}>
                <Menu.Prefix>
                  <Avatar size="small" abbreviation={e.uid ? initials(userName(e.uid)) : "–"} />
                </Menu.Prefix>
                {e.uid
                  ? `${userName(e.uid)} · until ${formatDayTime(e.until ?? now, e.timeZone)} ${zoneAbbr(e.until ?? now, e.timeZone)}`
                  : `No one on call (${e.scheduleName})`}
              </Menu.Item>
            ))}
          </Menu.Group>
        ))}
        <Menu.Group>
          {entries.length === 0 ? (
            <Menu.Item onSelect={() => navigate("/on-call/schedules/new")}>New schedule</Menu.Item>
          ) : null}
          <Menu.Item onSelect={() => navigate("/on-call")}>Open on-call overview</Menu.Item>
        </Menu.Group>
      </Menu.Content>
    </Menu>
  );
};

export const ShellHeader = () => {
  const navigate = useNavigate();
  return (
    <AppHeader>
      {/* Inside Dynatrace the logo and app name come from the platform automatically; offline the
          runtime reports "dt.missing.app.name", so name the app explicitly there. */}
      <AppHeader.Navigation>
        {isRuntimeMissing() && <AppHeader.Logo appName="Command Center" />}
        <AppHeader.NavigationItem as={NavLink} to="/" end>
          Console
        </AppHeader.NavigationItem>
        <AppHeader.NavigationItem as={NavLink} to="/on-call">
          On-call
        </AppHeader.NavigationItem>
        <AppHeader.NavigationItem as={NavLink} to="/teams">
          Teams
        </AppHeader.NavigationItem>
        <AppHeader.NavigationItem as={NavLink} to="/escalations">
          Escalations
        </AppHeader.NavigationItem>
        <AppHeader.NavigationItem as={NavLink} to="/services">
          Services
        </AppHeader.NavigationItem>
        <AppHeader.NavigationItem as={NavLink} to="/integrations">
          Integrations
        </AppHeader.NavigationItem>
        <AppHeader.NavigationItem as={NavLink} to="/reports">
          Reports
        </AppHeader.NavigationItem>
      </AppHeader.Navigation>
      <AppHeader.ActionItems>
        <OnCallNowAction />
      </AppHeader.ActionItems>
      <AppHeader.Menus>
        <Tooltip text="Settings">
          <Button aria-label="Settings" onClick={() => navigate("/settings")}>
            <Button.Prefix>
              <SettingIcon />
            </Button.Prefix>
          </Button>
        </Tooltip>
        <HelpMenu
          entries={{
            whatsNew: "default",
            getStarted: { onSelect: () => navigate("/help#get-started") },
            documentation: [
              { label: "In-app guide", href: "/ui/help", onSelect: () => navigate("/help") },
              { label: "Sending events (API)", href: "/ui/help#inbound", onSelect: () => navigate("/help#inbound") },
            ],
            keyboardShortcuts: { onSelect: () => navigate("/help#shortcuts") },
            about: "default",
          }}
        />
      </AppHeader.Menus>
    </AppHeader>
  );
};
