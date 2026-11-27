/** App header: navigation, notification bell, on-call indicator and switch, settings and help menu. */
import React, { useMemo, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { AppHeader, HelpMenu } from "@dynatrace/strato-components/layouts";
import { Button } from "@dynatrace/strato-components/buttons";
import { Tooltip } from "@dynatrace/strato-components/overlays";
import { Menu } from "@dynatrace/strato-components/navigation";
import { Avatar, Chip } from "@dynatrace/strato-components/content";
import {
  LogoutIcon,
  CallIcon,
  CheckmarkIcon,
  CriticalIcon,
  InformationIcon,
  NotificationActiveIcon,
  NotificationIcon,
  NotificationOffIcon,
  SettingIcon,
  SuccessIcon,
  WarningIcon,
} from "@dynatrace/strato-icons";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { useAppData } from "../hooks/AppDataContext";
import { isRuntimeMissing, onCallAt } from "../hooks/domain";
import { formatDayTime, formatRelative, initials, zoneAbbr } from "./format";
import { OnCallSwitchModal, scheduleParticipants, type OnCallSwitchRequest } from "./OnCallSwitch";
import {
  CATEGORY_LABEL,
  clearNotifications,
  markAllRead,
  setNotificationPrefs,
  useNotifications,
  type AppNotification,
  type NotificationCategory,
} from "../hooks/notifications";

const TYPE_ICON: Record<AppNotification["type"], React.ReactElement> = {
  critical: <CriticalIcon style={{ color: Colors.Icon.Critical.Default }} />,
  warning: <WarningIcon style={{ color: Colors.Icon.Warning.Default }} />,
  success: <SuccessIcon style={{ color: Colors.Icon.Success.Default }} />,
  info: <InformationIcon style={{ color: Colors.Icon.Primary.Default }} />,
};

/**
 * Header bell: unread count, recent notifications, pop-ups on/off (silenced = count only)
 * and which categories may pop up.
 */
const NotificationBell = () => {
  const { items, prefs, unread } = useNotifications();
  const navigate = useNavigate();
  const now = Date.now();
  const icon = !prefs.popups ? <NotificationOffIcon /> : unread > 0 ? <NotificationActiveIcon /> : <NotificationIcon />;
  const label = unread > 0 ? `${unread} unread notification${unread === 1 ? "" : "s"}` : "Notifications";
  return (
    <Menu onOpenChange={(open: boolean) => { if (!open) markAllRead(); }}>
      <Menu.Trigger>
        <AppHeader.ActionButton aria-label={label}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            {icon}
            {unread > 0 ? String(unread > 99 ? "99+" : unread) : null}
          </span>
        </AppHeader.ActionButton>
      </Menu.Trigger>
      <Menu.Content>
        <Menu.Group>
          <Menu.Label>{items.length === 0 ? "No notifications yet" : "Recent notifications"}</Menu.Label>
          {items.slice(0, 10).map((n) => (
            <Menu.Item key={n.id} onSelect={() => n.link && navigate(n.link)}>
              <Menu.Prefix>{TYPE_ICON[n.type]}</Menu.Prefix>
              {n.read ? n.title : `● ${n.title}`}
              <Menu.Suffix>
                <span style={{ whiteSpace: "nowrap" }}>{formatRelative(n.at, now)}</span>
              </Menu.Suffix>
            </Menu.Item>
          ))}
        </Menu.Group>
        <Menu.Group>
          <Menu.Label>Settings</Menu.Label>
          <Menu.Item onSelect={() => setNotificationPrefs({ ...prefs, popups: !prefs.popups })}>
            <Menu.Prefix>{prefs.popups ? <NotificationIcon /> : <NotificationOffIcon />}</Menu.Prefix>
            {prefs.popups ? "Pop-ups on (click to silence)" : "Silenced: only counting (click to show pop-ups)"}
          </Menu.Item>
          <Menu.Sub>
            <Menu.SubTrigger>Show pop-ups for…</Menu.SubTrigger>
            <Menu.SubContent>
              {(Object.keys(CATEGORY_LABEL) as NotificationCategory[]).map((c) => (
                <Menu.Item
                  key={c}
                  onSelect={() => setNotificationPrefs({ ...prefs, categories: { ...prefs.categories, [c]: !prefs.categories[c] } })}
                >
                  <Menu.Prefix>{prefs.categories[c] ? <CheckmarkIcon /> : <span style={{ display: "inline-block", width: 20 }} />}</Menu.Prefix>
                  {CATEGORY_LABEL[c]}
                </Menu.Item>
              ))}
            </Menu.SubContent>
          </Menu.Sub>
          {items.length > 0 && <Menu.Item onSelect={clearNotifications}>Clear all</Menu.Item>}
        </Menu.Group>
      </Menu.Content>
    </Menu>
  );
};

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
  const [switchReq, setSwitchReq] = useState<OnCallSwitchRequest>();

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
  // Schedules where I'm on call now (can leave) and where I take part but am not on call (can take over).
  const mineNow = entries.filter((e) => e.uid === currentUser.uid).map((e) => e.scheduleId);
  const canTake = (data?.schedules ?? [])
    .filter((s) => !mineNow.includes(s.id) && scheduleParticipants(s).includes(currentUser.uid))
    .map((s) => s.id);

  return (
    <>
    <Menu>
      <Menu.Trigger>
        <AppHeader.ActionButton aria-label={mine ? "You're on call: open to leave on-call" : label}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {mine ? (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  // Same box as a header icon (20 px), so the header keeps its height when you go on call.
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  background: Colors.Background.Container.Success.Accent,
                  color: Colors.Text.Success.OnAccent.Default,
                }}
              >
                <CallIcon size="small" />
              </span>
            ) : (
              <CallIcon />
            )}
            {label}
          </span>
        </AppHeader.ActionButton>
      </Menu.Trigger>
      <Menu.Content>
        {(mineNow.length > 0 || canTake.length > 0) && (
          <Menu.Group>
            <Menu.Label>{mine ? "You're on call" : "You're off call"}</Menu.Label>
            {mineNow.length > 0 && (
              <Menu.Item onSelect={() => setSwitchReq({ mode: "off", scheduleIds: mineNow })}>
                <Menu.Prefix>
                  <LogoutIcon style={{ color: Colors.Icon.Critical.Default }} />
                </Menu.Prefix>
                Leave on-call now…
              </Menu.Item>
            )}
            {canTake.length > 0 && (
              <Menu.Item onSelect={() => setSwitchReq({ mode: "on", scheduleIds: canTake })}>
                <Menu.Prefix>
                  <CallIcon style={{ color: Colors.Icon.Success.Default }} />
                </Menu.Prefix>
                Take on-call now…
              </Menu.Item>
            )}
          </Menu.Group>
        )}
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
    {switchReq && <OnCallSwitchModal request={switchReq} onClose={() => setSwitchReq(undefined)} />}
    </>
  );
};

export const ShellHeader = () => {
  const navigate = useNavigate();
  const { data } = useAppData();
  const openRooms = (data?.warRooms ?? []).filter((r) => r.status === "open").length;
  return (
    <AppHeader>
      {/* Inside Dynatrace the logo and app name come from the platform automatically; offline the
          runtime reports "dt.missing.app.name", so name the app explicitly there. */}
      <AppHeader.Navigation>
        {isRuntimeMissing() && <AppHeader.Logo appName="Command Center" appIcon="/ui/assets/icons/command-center-icon.svg" />}
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
        <AppHeader.NavigationItem
          as={NavLink}
          to="/war-rooms"
          aria-label={openRooms ? `War rooms, ${openRooms} in progress` : "War rooms"}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            War rooms
            {openRooms > 0 && (
              <Chip size="condensed" color="critical" variant="accent">
                {openRooms}
              </Chip>
            )}
          </span>
        </AppHeader.NavigationItem>
        <AppHeader.NavigationItem as={NavLink} to="/reports">
          Reports
        </AppHeader.NavigationItem>
      </AppHeader.Navigation>
      <AppHeader.ActionItems>
        <NotificationBell />
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
