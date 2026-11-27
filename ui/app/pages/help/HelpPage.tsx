import React, { useEffect } from "react";
import { Link as RouterLink, useLocation } from "react-router-dom";
import { Flex, Grid, PageLayout, Surface } from "@dynatrace/strato-components/layouts";
import { KeyboardShortcut, Markdown } from "@dynatrace/strato-components/content";
import { SimpleTable } from "@dynatrace/strato-components/tables";
import { Heading, Link, Paragraph, Text } from "@dynatrace/strato-components/typography";
import { CircleIcon, SuccessIcon } from "@dynatrace/strato-icons";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { useAppData } from "../../hooks/AppDataContext";
import { PageTitle } from "../../components/PageTitle";
import { SendEventSnippets } from "../../components/CopyCode";
import { EVENT_FIELDS, TOKEN_SCOPE } from "../../components/snippets";

const TOC = [
  { id: "get-started", label: "Get started" },
  { id: "concepts", label: "Concepts" },
  { id: "console", label: "Console workflow" },
  { id: "inbound", label: "Sending events" },
  { id: "outbound", label: "Notifications" },
  { id: "shortcuts", label: "Keyboard shortcuts" },
  { id: "troubleshooting", label: "Troubleshooting" },
  { id: "privacy", label: "Privacy" },
];

const CONCEPTS = `
- **Incident**: one alert from Davis or the Events API after deduplication. It moves from *Triggered* to *Acknowledged* to *Resolved*; *Snoozed* hides it until a time, then it triggers again.
- **Priority**: P1 (critical) to P5 (informational). Set by a routing rule, the event's \`cc.priority\`, the service default, or the priority mapping. Priority doesn't decide *whether* someone is paged (the escalation policy does, and a routing rule can suppress); it selects people's notification rules and quiet-hours behaviour.
- **Team**: Dynatrace users with a role. *Team admins* edit the team and get paged, *Responders* get paged, *Observers* only watch and are never paged.
- **Schedule**: who is on call, built from **layers**. Each layer rotates its members daily, weekly or every N hours, optionally only in certain hours. Later layers win; **overrides** win over everything.
- **Escalation policy**: ordered steps. Each step waits a number of minutes, then notifies an on-call schedule, a whole team, or a person. It can repeat; it stops as soon as someone acknowledges.
- **Service and routing rule**: rules are checked top to bottom and the first match decides service, team, policy and priority, or suppresses the alert.
`;

const CONSOLE = `
1. **Acknowledge** to stop escalation and tell your team you're on it. The confirmation pop-up offers Undo for 10 seconds (also after Resolve), unless you silenced pop-ups.
2. **Reassign** to a team or a person, optionally with a note.
3. **Snooze** for 15 minutes to 4 hours, or until a custom time. Escalation resumes afterwards.
4. **Escalate now** jumps to the next step immediately.
5. **Resolve** when the problem is fixed. Davis problems also resolve automatically when Davis closes them.
6. **Notes** are append-only and part of the audit timeline.

Select several rows to act on them together. Filters are part of the URL, so you can bookmark a NOC view.
`;

const OUTBOUND = `
Notifications leave Dynatrace only through the **Command Center · Engine** workflow, a simple workflow that runs this app's engine action every 1, 2 or 5 minutes:

1. In **Integrations → Workflows**, choose the interval and select **Install in Workflows**, then deploy the workflow. If it shows up as a standard workflow, upload the downloaded JSON instead (or ask an admin to run \`scripts/install-workflow.mjs\`).
2. In the Workflows app's **Authorization settings**, grant the workflow actor (the person who deploys it, or a service user) the permissions the engine uses: Grail read, app state and credential vault read.
3. Create one **Credential Vault** entry per provider (Twilio, IFTTT, Slack, Microsoft Teams, Telegram, or your webhook) with scope **AppEngine**, owned by the workflow actor. Its ID looks like \`CREDENTIAL_VAULT_ENTRY-…\`.
4. In **Integrations → Outbound**, paste the credential vault ID, set the sender, enable the provider, and send a test.
5. Add the provider hosts to **Settings → General → Environment management → External requests**.

The app never sees secrets: it only stores vault IDs. Delivery results come back to the incident timeline and the notification ledger.
`;

const TROUBLE = `
- **No incidents appear**: check that a source is on in Settings and that events arrive (Integrations → Inbound). The engine workflow must be running: a banner on the Console tells you when its heartbeat is late (older than two intervals plus one minute).
- **A notification failed**: open the incident's Notifications tab for the provider error. Common causes are a missing host in External requests, a vault entry the workflow actor can't read (make the actor its owner), the wrong credential type, or an invalid phone number (use E.164).
- **The workflow isn't installed or is outdated**: in Integrations → Workflows select **Reinstall in Workflows** (or upload the downloaded JSON), then delete the old workflow.
- **Permission errors**: the app needs the scopes listed in Settings → Permissions, and your user needs IAM access to the app.
- **People can't be found in the user picker**: type at least 3 characters of the email or the first name. Only active users of the account that owns this environment are listed: people who were invited but never signed in are not found yet. If the picker says user search is unavailable, IAM returned 403: check that your user belongs to the Dynatrace account that owns this environment and may view users; ask your account admin.
`;

const PRIVACY = `
The app stores IAM user IDs and display names, phone numbers and chat IDs that people enter as contact methods, and the audit trail of actions. All of it lives in this app's app state in your environment and is readable by every user of the app. Emails are read live from IAM and shown only in the user picker and team member list. The engine workflow's execution results contain only counts, never message texts or phone numbers.
`;

const SHORTCUTS = [
  { keys: "j", action: "Next row" },
  { keys: "k", action: "Previous row" },
  { keys: "Escape", action: "Close details" },
  { keys: "a", action: "Acknowledge the active incident" },
  { keys: "r", action: "Resolve the active incident" },
  { keys: "x", action: "Select or deselect the active row" },
  { keys: "/", action: "Focus search" },
  { keys: "Shift+R", action: "Refresh now" },
];

const Section = ({ id, title, children }: { id: string; title: string; children: React.ReactNode }) => (
  <Flex flexDirection="column" gap={12} id={id}>
    <Heading level={2}>{title}</Heading>
    {children}
  </Flex>
);

export const HelpPage = () => {
  const { data } = useAppData();
  const location = useLocation();
  useEffect(() => {
    const id = location.hash.replace("#", "");
    if (id) window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
  }, [location.hash]);

  const steps = [
    { done: (data?.teams.length ?? 0) > 0, label: "Create a team", to: "/teams" },
    { done: (data?.schedules.length ?? 0) > 0, label: "Create a schedule", to: "/on-call?tab=schedules" },
    { done: (data?.policies.length ?? 0) > 0, label: "Create an escalation policy", to: "/escalations" },
    { done: !!data?.settings.providers.some((p) => p.enabled), label: "Configure a notification provider", to: "/integrations?tab=outbound" },
    { done: !!data?.heartbeat, label: "Install the engine workflow", to: "/integrations?tab=workflows" },
    { done: (data?.incidents.length ?? 0) > 0, label: "Send a test event", to: "/integrations" },
  ];

  return (
    <PageLayout.Content>
      <Flex flexDirection="column" gap={16} padding={16} style={{ maxWidth: 1200, margin: "0 auto", width: "100%" }}>
        <PageTitle title="Help" subtitle="How Command Center turns Dynatrace alerts into incidents, pages and reports" />
        <Grid gridTemplateColumns="200px minmax(0, 960px)" gap={32}>
          <Flex flexDirection="column" gap={8} style={{ position: "sticky", top: 16, alignSelf: "start" }}>
            <Text textStyle="small-emphasized">On this page</Text>
            {TOC.map((t) => (
              <Link key={t.id} as={RouterLink} to={`/help#${t.id}`}>
                {t.label}
              </Link>
            ))}
          </Flex>
          <Flex flexDirection="column" gap={32}>
            <Section id="get-started" title="Get started">
              <Paragraph>Six steps take you from an empty app to paging people. Completed steps are checked from the app's current data.</Paragraph>
              <Surface padding={16}>
                <Flex flexDirection="column" gap={12}>
                  {steps.map((s, i) => (
                    <Flex key={s.label} gap={12} alignItems="center">
                      {s.done ? (
                        <SuccessIcon style={{ color: Colors.Icon.Success.Default }} aria-label="Done" />
                      ) : (
                        <CircleIcon style={{ color: Colors.Icon.Neutral.Subdued }} aria-label="To do" />
                      )}
                      <Text textStyle="base-emphasized">{i + 1}.</Text>
                      <Link as={RouterLink} to={s.to}>
                        {s.label}
                      </Link>
                    </Flex>
                  ))}
                </Flex>
              </Surface>
            </Section>
            <Section id="concepts" title="Concepts">
              <Markdown>{CONCEPTS}</Markdown>
            </Section>
            <Section id="console" title="Console workflow">
              <Markdown>{CONSOLE}</Markdown>
            </Section>
            <Section id="inbound" title="Sending events (inbound)">
              <Paragraph>
                Davis problems arrive automatically. Any other tool posts events to the Dynatrace Events API v2 with a platform token that has the {TOKEN_SCOPE} permission; each event opens a Davis problem that carries its cc.* properties for routing. Use placeholders
                below and keep tokens in your tool's secret store.
              </Paragraph>
              <SendEventSnippets />
              <SimpleTable
                data={EVENT_FIELDS}
                columns={[
                  { id: "field", header: "Event property", accessor: "field", width: 240 },
                  { id: "usedFor", header: "Used for", accessor: "usedFor", width: 520 },
                ]}
              />
            </Section>
            <Section id="outbound" title="Notifications (outbound)">
              <Markdown>{OUTBOUND}</Markdown>
            </Section>
            <Section id="shortcuts" title="Keyboard shortcuts">
              <Paragraph>Console only, and never while you type in a field. Turn single-key shortcuts off in Settings → General.</Paragraph>
              <Flex flexDirection="column" gap={8}>
                {SHORTCUTS.map((s) => (
                  <Flex key={s.keys} gap={16} alignItems="center">
                    <Flex style={{ width: 120 }}>
                      <KeyboardShortcut keys={s.keys} />
                    </Flex>
                    <Text>{s.action}</Text>
                  </Flex>
                ))}
              </Flex>
            </Section>
            <Section id="troubleshooting" title="Troubleshooting">
              <Markdown>{TROUBLE}</Markdown>
            </Section>
            <Section id="privacy" title="Privacy">
              <Markdown>{PRIVACY}</Markdown>
            </Section>
          </Flex>
        </Grid>
      </Flex>
    </PageLayout.Content>
  );
};
