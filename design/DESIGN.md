# Command Center for Dynatrace v2 — Design Spec (NOC event console + on-call)

Owner: product design. Audience: the developers implementing `ui/app`. Status: ready to implement.
Target stack (verified in `node_modules`): `@dynatrace/strato-components` **3.18.1**, `@dynatrace/strato-design-tokens` **1.8.1**,
`@dynatrace/strato-icons` **2.7.0**, `react` 18, `react-router-dom` 6.

## 0. How to read this spec

- **Verification legend.** Every component, subcomponent, prop, token and icon named below was checked against
  one of these sources. Each is cited inline with a tag:
  - `[MCP]`: `dt-app-mcp get_strato_component` / `get_strato_usecases` (props table and official use-case code).
  - `[DTS]`: the installed `.d.ts`, path relative to `node_modules/@dynatrace/strato-components/` (or the named package).
  - `[STD:<id>]`: `dt-app-mcp get_experience_standard`, with the standard id that came back.
  - **UNVERIFIED**: could not be confirmed. Developer must check before use, or follow the stated fallback.
- **Import rule (R3).** Always import from a subpath: `@dynatrace/strato-components/<layouts|content|tables|charts|filters|forms|buttons|navigation|overlays|typography|notifications|core>`.
  Icons come from `@dynatrace/strato-icons`, a flat root export. Tokens come from `@dynatrace/strato-design-tokens/<colors|spacings|borders|box-shadows|typography|breakpoints>`.
  Never import from `@dynatrace/strato-components-preview`. v1 `App.tsx` still does this and must be migrated.
- **No literal colors.** v1 `Problems.tsx` hand-rolls ~60 inline `style={{…}}` blocks, raw `<button>`-like styles (`ICON_BTN`)
  and an inline SVG logo with hex fills. v2 must not do any of this: no hex/rgb values, no inline SVG, no `<div onClick>`.
  The AppHeader renders the app logo automatically `[STD:AppHeader-Compliance-Checklist]`.

### Things that do NOT exist (do not use)

| Wanted | Reality | Use instead |
| --- | --- | --- |
| `Page` / `Page.Main` / `Page.DetailView` | `Page` is **deprecated** (`list_strato_components` description: "The `Page` component is deprecated") `[MCP]` | `PageLayout` with `.Header/.Sidebar/.Content/.Details` `[MCP][DTS layouts/page-layout/PageLayout.d.ts]` |
| `Drawer` | Only exported as internal `_Drawer` `[DTS overlays/index.d.ts]` | `PageLayout.Details` (becomes a drawer below its breakpoint automatically), or `Sheet` |
| `Badge`, `Tag`, `Card`, `Timeline` component | No such exports (searches for badge/tag/card/timeline/stepper returned none) `[MCP]` | `Chip`, `Surface`, `Container`; timeline is composed (section 5.3) |
| Multi-select `Combobox` | `Combobox` is single-value: `value: string \| null` `[DTS forms/combobox/Combobox.d.ts]` | `Select multiple` + `Select.Filter` for type-ahead |
| Underscore exports (`_SankeyChart`, `_Form`, `_Drawer`, `_useForm`…) | Internal and unstable | Not allowed |

---

## 1. Visual language

### 1.1 Layout and density

- **Full-width layout** for Console, On-call, Reports and every list page, because these are data-heavy. Use a **centered 960px column** only for the
  Help page and long-form settings text `[STD:foundations/layout]` ("restrict the main content to 960px").
- **Surfaces** structure content. Inset is `Spacings.Size16` (dense NOC layout), not 24 `[STD:foundations/layout]`.
  `Surface elevation="flat"` by default. Use `raised` only for the KPI tiles on the Console.
- **Containers** carry semantic messages: `Container color="critical|warning|…"`, inset `Spacings.Size16`.
- **Spacing tokens only** (`Spacings.Size0…Size64` `[DTS strato-design-tokens/spacings]`). Use `Flex`/`Grid` `gap={8|12|16|24}`.
  For page sections use `gap={16}`. For form groups use `gap={32}`, fields `gap={16}`, label-to-field 4 `[STD:patterns/forms-validation]`.
- **Table density.** The Console `DataTable` uses `variant={{ rowDensity: 'condensed', rowSeparation: 'horizontalDividers' }}`
  (`rowDensity` values `'default' | 'condensed' | 'comfortable'` from use case `VisualConfigurationRowDensity` `[MCP]`;
  the `rowSeparation` value name is **UNVERIFIED**, so check `DataTableVisualVariantProps` in `tables/index.d.ts`).
  Settings → General offers a "Table density" `ToggleButtonGroup` (Default / Condensed), persisted per user.
- **Breakpoints** (`Breakpoints.Max.Mobile` 640, `Min.Tablet` 641, `Min.Desktop` 961 `[DTS strato-design-tokens/breakpoints]`).
  The minimum target is 320px. Below tablet width, the KPI strip wraps 2-up and the details panel becomes a drawer (automatic).

### 1.2 Color semantics

The universal status levels are Ideal / Good / Neutral / Warning / Critical `[STD:patterns/status-and-health]`.
Never use color alone. Every colored element also carries **text** and, for status, a **shape/icon**
(HealthIndicator gives circle / triangle / diamond shapes).

#### Incident status → `HealthIndicator` (status column, detail header) + chart token

| Status | `HealthIndicator status=` `[MCP]` | Chart token (`Colors.` …) `[DTS colors]` | Icon (timeline/toasts) |
| --- | --- | --- | --- |
| Triggered | `critical` | `Charts.Status.Critical.Default` | `CriticalIcon` |
| Acknowledged | `warning` | `Charts.Status.Warning.Default` | `CheckmarkIcon` |
| Snoozed | `neutral` | `Charts.Status.Neutral.Default` | `PauseIcon` |
| Resolved | `ideal` | `Charts.Status.Ideal.Default` | `SuccessIcon` |

Render `<HealthIndicator status="critical"><HealthIndicator.Label>Triggered</HealthIndicator.Label></HealthIndicator>`.
Subcomponents `HealthIndicator.Visual`, `HealthIndicator.Label` and prop `visual: 'shape' | 'icon'` are verified `[MCP]`.
Use `visual="shape"` in tables and `visual="icon"` in the detail header.

#### Priority P1–P5 → `Chip` (always shows the text "P1"…"P5") + chart token

`Chip` supports only `color: 'neutral'|'primary'|'success'|'warning'|'critical'` and `variant: 'accent'|'emphasized'`,
with `size: 'default'|'condensed'` `[MCP]`. Chip cannot express orange. The ramp below is built from the chip palette,
and the charts use the matching **`Charts.SecurityRiskLevel.*`** severity family so that a priority reads as the same hue in
tables and charts.

| Priority | Meaning (default) | Chip `color` / `variant` | Chart token | Token default (light) |
| --- | --- | --- | --- | --- |
| P1 | Critical: page now, all channels | `critical` / `accent` (solid red) | `Colors.Charts.SecurityRiskLevel.Critical.Default` | dark red |
| P2 | High: page on-call | `critical` / `emphasized` (red tint) | `Colors.Charts.SecurityRiskLevel.High.Default` | red |
| P3 | Moderate: notify, business hours escalate | `warning` / `emphasized` (amber tint) | `Colors.Charts.SecurityRiskLevel.Medium.Default` | amber |
| P4 | Low: notify only | `primary` / `emphasized` (blue tint) | `Colors.Charts.SecurityRiskLevel.Low.Default` | blue |
| P5 | Informational: no notification | `neutral` / `emphasized` (grey) | `Colors.Charts.SecurityRiskLevel.None.Default` | grey |

Hue check: chip red ↔ dark-red/red, amber tint ↔ amber, blue ↔ blue, grey ↔ grey. The values
were read from the token file comments and are **not** to be hardcoded. P1 vs P2 are separated by intensity (solid vs tint)
plus the label. P1 also gets `Chip.Prefix` with `<CriticalIcon />`, so the highest priority has a shape cue as well.
Implement once as `<PriorityChip priority="P1" />` (`size="condensed"` in tables).

#### Other semantic mappings

| Concept | Component / token |
| --- | --- |
| Notification delivery: Delivered / Sent (pending) / Failed / Skipped | `HealthIndicator` `ideal` / `good` / `critical` / `neutral`; icons `SuccessIcon` / `PendingIcon` / `CriticalFailedIcon` / `MuteIcon` |
| Workflow / integration health: Healthy / Degraded / Failing / Not installed | `HealthIndicator` `ideal` / `warning` / `critical` / `neutral` |
| SLA vs target (MTTA) | `MeterBarChart.ThresholdIndicator` with `Colors.Charts.Threshold.Good|Warning|Bad.Default` (use case `Thresholds` `[MCP]`) |
| Series colors for team/service comparisons | Let Strato assign (default categorical palette). Never hand-pick |
| Text emphasis | `Colors.Text.Neutral.Default` / `.Subdued` (timestamps, secondary), `Colors.Text.Critical.Default` (overdue age) |
| Icon color in composed visuals | `Colors.Icon.Success.Default`, `Colors.Icon.Primary.Default`, `Colors.Icon.Neutral.Subdued`, `Colors.Icon.Critical.Default` |
| Selected / current item backgrounds | `Colors.Background.Field.Primary.Emphasized`; borders `Colors.Border.Neutral.Default`, radius `Borders.Radius.Container.Default` |

All token paths above appear in `strato-design-tokens/colors/index.d.ts` (dark-theme values come from `variables-dark`, so a token switches with the
platform theme automatically). **Never** add a custom theme toggle.

### 1.3 Iconography

All of these names exist in `@dynatrace/strato-icons@2.7.0` `[DTS strato-icons/index.d.ts]`. Labels follow `[STD:patterns/common-actions]`.

| Meaning | Icon | | Meaning | Icon |
| --- | --- | --- | --- | --- |
| Acknowledge | `CheckmarkIcon` | | Escalate now | `ArrowUpIcon` |
| Resolve | `SuccessIcon` | | Snooze | `PauseIcon` |
| Assign / user | `AccountIcon` | | Team | `GroupIcon` |
| Notes | `DescriptionIcon` | | Edit | `EditIcon` |
| New / Add | `PlusIcon` | | Delete | `DeleteIcon` |
| Remove / clear | `XmarkIcon` | | Copy | `CopyIcon` |
| Duplicate | `DuplicateIcon` | | More actions | `DotMenuIcon` |
| Settings | `SettingIcon` | | Refresh / auto-refresh | `RefreshIcon` / `RefreshAutoIcon` |
| Filter | `FilterIcon` | | Search | `MagnifyingGlassIcon` |
| Davis problem link | `DavisAIIcon` + `ExternalLinkIcon` | | System event | `EventIcon` |
| Timeline item | `TimelineEventIcon` | | History | `HistoryIcon` |
| Schedule | `CalendarIcon` | | Time / age / MTTA | `ClockIcon`, `StopwatchIcon` |
| Rotation | `CycleIcon` | | Repeat (escalation) | `RepeatIcon` |
| Escalation step | `StepIcon` | | Routing rule / conditions | `ConditionsIcon` |
| Services | `ServicesIcon` | | Flow / routing chain | `FlowIcon` |
| Integrations | `ConnectorIcon` | | Workflows | `WorkflowsIcon` |
| Credential vault | `KeyIcon` / `LockIcon` | | API token | `TokenIcon` |
| Code / snippet | `TerminalIcon`, `CodeIcon` | | Test / run | `PlayIcon` |
| SMS | `MobileIcon` | | Voice call | `CallIcon` |
| Chat (Slack, Teams, Telegram, WhatsApp) | `ChatIcon` | | Email | `MailIcon` |
| Webhook (IFTTT, generic) | `HttpIcon` | | Notification on / off | `NotificationActiveIcon` / `NotificationOffIcon` |
| Reports | `AnalyticsIcon` | | Gantt / shifts | `GanttChartIcon` |
| Info / help | `InformationIcon`, `HelpIcon`, `GuideIcon` | | Warning / Critical | `WarningIcon` / `CriticalIcon` (failed: `WarningFailedIcon` / `CriticalFailedIcon`) `[STD:patterns/error-messages]` |
| Entities: host / service / process / app / db | `HostsIcon`, `ServicesIcon`, `ProcessIcon`, `ApplicationsIcon`, `DatabaseIcon` | | Demo mode | `InformationIcon` |

Brand logos for Slack/Teams/Twilio etc. are **not** in strato-icons. Use the channel icons above plus the provider name as text.
Do not embed third-party SVG logos.

### 1.4 Typography and copy tone

- Use `Heading level={1..6}`, `Text textStyle="base|base-emphasized|small|small-emphasized"`, `fontStyle="code"` for IDs `[MCP]`, plus `Paragraph`, `Strong`,
  `Code`, `TextEllipsis` (table cells with long titles), `ExternalLink` (leaves Dynatrace), `Link` (in-app routes; polymorphic `as={RouterLink}`).
- English UI, American spelling, **sentence case**, serial comma, contractions, digits in UI, no emoji,
  no closing punctuation or "-ing" verbs on buttons and headings `[STD:foundations/content-checklist]`.
- Action labels (`[STD:patterns/common-actions]`): **New** for top-level objects ("New team", "New schedule", "New escalation policy", "New rule"),
  **Add** for children ("Add member", "Add layer", "Add step", "Add condition"), **Delete** with a confirmation `Modal` whose
  button says "Delete" (not "Confirm"), **Remove** for low-impact unlinking without confirmation, **Duplicate**, **Copy** (tooltip "Copied").
- Domain verbs: **Acknowledge**, **Resolve**, **Reassign**, **Escalate now**, **Snooze**, **Add note**, **Reopen**.
- Errors say what happened and what to do, with no blame and no "Oops" (`[STD:patterns/error-messages]`). Example: "Couldn't load incidents. Check your
  connection and select Retry." with a **Retry** button. Never a bare "Something went wrong".
- Times: relative age in tables ("12 min", "3 h 4 min"), absolute timestamp in the tooltip and detail, both in the **tenant time zone** from Settings
  and suffixed with the zone abbreviation where ambiguity matters (schedules).

### 1.5 Accessibility (WCAG 2.2 AA, `[STD:foundations/accessibility]`)

- Every icon-only `Button` has `aria-label` **and** is wrapped in `Tooltip text="…"` with the same text `[STD:AppHeader-Compliance-Checklist]`.
- Every form control sits in `FormField` with a visible `Label`. Placeholders never replace labels. Required fields get the asterisk via `FormField required`.
- Priority and status never rely on color (text label always shown; HealthIndicator shape).
- `DataTable` built-ins give keyboard navigation and selection semantics. Don't override default mouse/keyboard interactions `[STD:DataTable-Compliance-Checklist]`.
- Auto-refresh must not move focus or reset selection: give the table a stable `rowId={(row) => row.id}` `[MCP DataTable props: rowId]`. Announce
  "N new incidents" through a `showToast({ role: 'status' })` instead of reflowing focus.
- The details panel uses the `split` layout by default, because the overlay mode can hide the focused element `[MCP PageLayout usage]`.
- Destructive actions get a confirmation `Modal`. Nothing is hidden when unavailable. Disable instead, with a `Tooltip` explaining why `[STD:foundations/interaction-states]`.

### 1.6 The four states (apply on every data view)

| State | Component |
| --- | --- |
| Loading (first load, page) | `Skeleton` / `SkeletonText` shaped like the content; tables use `DataTable loading` `[MCP]`; charts use their `loading` prop `[MCP]` |
| Loading (refresh) | Keep the data; spinner `ProgressCircle size="small"` in the toolbar after a ~500 ms delay, shown ≥200 ms `[STD:patterns/loading-saving]` |
| Saving | `Button loading` on the submit button; `ProgressBar` only for uploads/long saves |
| Empty | `EmptyState` (+ `EmptyState.Title`, `.Details`, `.Actions`, optional `.Visual` with `EmptyState.VisualPreset context="table" type="create-new"`) `[MCP use cases Basic, VisualPreset]` |
| Error | `MessageContainer variant="critical"` with `.Title`, `.Description` (the actual error text), `.Actions` (Retry) `[MCP]`; full-section failure can use `EmptyState preset="something-wrong"` `[DTS content/empty-state/types]` |
| No permission | `EmptyState preset={{ reason: 'no-permission', missingPermissions: [...] }}` `[DTS content/empty-state/types]` |

`EmptyState.VisualPreset` `context: 'chart'|'document'|'generic'|'table'|'query'`, `type: 'something-missing'|'no-result'|'something-wrong'|'create-new'|'no-permission'`
`[DTS]`. The preset images load from a CDN (`useVisualPresetCdnUrl`). Whether the app CSP allows this is **UNVERIFIED**, so render the headless rendering test
with and without the visual.

---

## 2. Information architecture

The standard allows 6–8 top-level pages for flat navigation `[STD:foundations/navigation]`. Seven `AppHeader.NavigationItem`s:

| # | Nav label | Route | Contains |
| --- | --- | --- | --- |
| 1 | Console | `/` (and `/incidents/:id` deep link that opens the details panel) | KPI strip, filters, incident table, incident details panel |
| 2 | On-call | `/on-call` | `Tabs`: **Now** · **Schedules** · **Overrides**; schedule editor at `/on-call/schedules/:id` |
| 3 | Teams | `/teams`, `/teams/:id` | Team list + team detail (members, roles, contact methods) |
| 4 | Escalations | `/escalations`, `/escalations/:id` | Escalation policies list + ordered steps editor |
| 5 | Services | `/services`, `/services/:id` | Services, routing rules, priority mapping, rule tester |
| 6 | Integrations | `/integrations` | `Tabs`: **Inbound** · **Outbound** · **Workflows** |
| 7 | Reports | `/reports` | MTTA/MTTR, volume, noisy sources, on-call load |

Not in the tab bar:
- **Settings** at `/settings` opens from the `SettingIcon` button in `AppHeader.Menus`, left of `HelpMenu` `[STD:AppHeader-Compliance-Checklist]`.
- **Help** at `/help` opens from `HelpMenu entries.documentation` and `entries.getStarted` `[STD:HelpMenu-Compliance-Checklist]`.

Nested pages (`/teams/:id`, `/on-call/schedules/:id`, `/escalations/:id`, `/services/:id`) show `Breadcrumbs`
(`Breadcrumbs.Item` `[MCP]`; use case `ReactRouter`) above the page `TitleBar`, because they form a nested hierarchy `[STD:foundations/navigation]`.

Use `AppHeader.NavigationItem as={NavLink} to="/…"` from `react-router-dom` for auto-active state `[STD:AppHeader-Compliance-Checklist]`.
The Console item needs `end` so it is not always active.

---

## 3. App shell

### 3.1 Structure

```tsx
// App.tsx
import { AppRoot } from '@dynatrace/strato-components/core';            // [DTS core/index.d.ts]
import { PageLayout, AppHeader, HelpMenu, Flex } from '@dynatrace/strato-components/layouts'; // [MCP]
import { ToastContainer } from '@dynatrace/strato-components/notifications'; // [MCP Toast use case Basic]

<AppRoot>
  <ToastContainer />
  <PageLayout>
    <PageLayout.Header>
      <ShellHeader />           {/* AppHeader, see 3.2 */}
      <DemoModeBanner />        {/* only when demo mode is on, see 3.4 */}
    </PageLayout.Header>
    <PageLayout.Content>
      <Routes>…</Routes>        {/* each page renders its own content and, if needed, its own PageLayout.Details */}
    </PageLayout.Content>
  </PageLayout>
</AppRoot>
```

Whether `PageLayout.Details` can be rendered deep inside `PageLayout.Content` (slot portal) is suggested by `usePageLayoutPortalContext` /
`PageLayoutPortalContext` `[DTS layouts/page-layout/shared/slots]` but is **UNVERIFIED**. **Fallback:** each route renders its own `<PageLayout>`
with Header/Content/Details, and the header element is shared as a component.

`PageLayout` slots verified `[MCP][DTS layouts/page-layout/PageLayout.d.ts]`: `Header`, `Sidebar`, `Content`, `Details` (+ `Details.ControlBar`).
`Details` props: `collapsed`, `defaultCollapsed`, `onCollapsedChange`, `breakpoint`, `onBreakpointTransition`, `minWidth`, `maxWidth`, `defaultWidth`, `width`,
`resizable`, `layout`/`defaultLayout: 'split'|'overlay'`, `onLayoutChange` `[DTS details-region/slots.d.ts, panel-state/collapsible.d.ts]`.

### 3.2 AppHeader

```tsx
<AppHeader>
  <AppHeader.Navigation>
    <AppHeader.NavigationItem as={NavLink} to="/" end>Console</AppHeader.NavigationItem>
    <AppHeader.NavigationItem as={NavLink} to="/on-call">On-call</AppHeader.NavigationItem>
    <AppHeader.NavigationItem as={NavLink} to="/teams">Teams</AppHeader.NavigationItem>
    <AppHeader.NavigationItem as={NavLink} to="/escalations">Escalations</AppHeader.NavigationItem>
    <AppHeader.NavigationItem as={NavLink} to="/services">Services</AppHeader.NavigationItem>
    <AppHeader.NavigationItem as={NavLink} to="/integrations">Integrations</AppHeader.NavigationItem>
    <AppHeader.NavigationItem as={NavLink} to="/reports">Reports</AppHeader.NavigationItem>
  </AppHeader.Navigation>

  <AppHeader.ActionItems>                         {/* max 2 app-wide actions, neutral-emphasized */}
    <OnCallNowAction />                            {/* 3.3 */}
    {/* OPTIONAL, pending lead decision: manual incidents must still enter via the Events API (inbound-only-via-API rule) */}
    <AppHeader.ActionButton prefixIcon={<PlusIcon />} onClick={openNewIncident}>New incident</AppHeader.ActionButton>
  </AppHeader.ActionItems>

  <AppHeader.Menus>
    <Tooltip text="Settings">
      <Button aria-label="Settings" onClick={() => navigate('/settings')}>
        <Button.Prefix><SettingIcon /></Button.Prefix>
      </Button>
    </Tooltip>
    <HelpMenu entries={{
      whatsNew: 'default',                                    // mandatory item
      getStarted: { onSelect: () => navigate('/help#get-started') },
      documentation: [
        { label: 'In-app guide', href: '/help', onSelect: () => navigate('/help') },
        { label: 'Sending events (API)', href: '/help#inbound', onSelect: () => navigate('/help#inbound') },
      ],
      keyboardShortcuts: 'default',
      feedback: { onSelect: openFeedback },                   // omit if not implemented (hide, don't disable)
      about: 'default',
    }} />
  </AppHeader.Menus>
</AppHeader>
```

Verified: subcomponents `AppHeader.Navigation`, `NavigationItem`, `ActionItems`, `ActionItemGroup`, `ActionButton`, `Logo` `[MCP]`; `AppHeader.Menus` `[DTS layouts/app-header/Menus.d.ts]`;
`ActionButton` props `prefixIcon`, `showLabel`, `onClick`; `HelpMenu entries` keys `whatsNew|getStarted|documentation|keyboardShortcuts|playground|feedback|about`
`[STD:AppHeader-Compliance-Checklist][STD:HelpMenu-Compliance-Checklist]`. Do **not** add `AppHeader.Logo` (automatic). Do not use primary/accent variants for action buttons.
Optional: `keyboardShortcuts` custom entry that opens a `Modal` listing the app shortcuts (section 13), using `KeyboardShortcut keys="a"` `[MCP]`.

### 3.3 Global "who is on-call now" indicator (`OnCallNowAction`)

- `AppHeader.ActionButton prefixIcon={<NotificationActiveIcon />}`. Label: **"On call: <first name> +2"** (the current user's primary team, or
  the first team), or **"You're on call"** when the current user is on call. Where the user is off call it shows "On call" only.
- Click opens a `Menu` (`Menu.Trigger` wraps the button, `Menu.Content`, `Menu.Group`, `Menu.Label`, `Menu.Item`, `Menu.Prefix` `[MCP]`) listing per team:
  `Menu.Label` = team name; items = on-call person(s) by layer, with `<Avatar size="small" abbreviation="AB" />` in `Menu.Prefix` and the shift end
  ("until 18:00 CET") as secondary text. The last item is `Menu.Item` "Open on-call overview" → `/on-call`.
  Wrapping `ActionButton` in `Menu.Trigger` is **UNVERIFIED**. **Fallback:** the ActionButton navigates to `/on-call`, and its tooltip lists the names.
- States: loading → label "On call" with no names; error → label "On call" + `WarningIcon` prefix and a tooltip with the error; no schedules → "No one on call"
  (menu offers "New schedule").

### 3.4 Demo-mode banner

When Settings → General → Demo mode is on (or no tenant data is available), render it directly under the AppHeader:

```tsx
<MessageContainer variant="primary">           {/* primary appears once per page [STD:foundations/layout] */}
  <MessageContainer.Prefix><InformationIcon /></MessageContainer.Prefix>   {/* UNVERIFIED that Prefix accepts a custom icon: use case 'CustomIcon' suggests yes [MCP] */}
  <MessageContainer.Title>Demo mode</MessageContainer.Title>
  <MessageContainer.Description>You're viewing sample incidents, teams, and schedules. Actions don't send notifications.</MessageContainer.Description>
  <MessageContainer.Actions><Button onClick={goToSettings}>Turn off demo mode</Button></MessageContainer.Actions>
</MessageContainer>
```
`MessageContainer` props `variant`, `onDismiss`; slots `Prefix|Title|Description|Actions` `[MCP]`. **Not dismissible** while demo mode is on: the user
must always know that the data is fake. Inside page bodies, primary containers are not used elsewhere while the banner shows.

### 3.5 Page header pattern (every page)

`TitleBar` with `TitleBar.Title`, `TitleBar.Subtitle`, `TitleBar.Action`, `TitleBar.Prefix`, `TitleBar.Suffix`, `TitleBar.Navigation`, prop `showDivider` `[MCP]`.
- `TitleBar.Navigation` holds `Breadcrumbs` on nested pages.
- `TitleBar.Title` is the page name. `TitleBar.Subtitle` is a one-line purpose ("Incidents from Davis problems and ingested events, newest first").
- `TitleBar.Action` holds the page primary action (`Button color="primary" variant="accent"` with `PlusIcon`, e.g. "New team"), at most one accent button per page.

---

## 4. Console (main NOC screen) — `/`

### 4.1 Layout

```
PageLayout.Content
 ├─ TitleBar            "Console" · subtitle · Suffix: auto-refresh control + last updated
 ├─ KPI strip           Grid (6 tiles)                                            4.2
 ├─ Filter row          Flex: FilterBar (grow) + TimeframeSelector + SearchInput   4.3
 └─ Incident table      DataTable (fullWidth)                                     4.4
PageLayout.Details      Incident details (collapsed unless a row is active)       section 5
```

Grid: `<Grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap={12}>` (`Grid` props `gridTemplateColumns`, `gap` `[MCP]`).

### 4.2 KPI strip ("is it OK right now?" headline layer, R8)

Each tile is `Surface elevation="raised" padding={16}` (`Surface` props `elevation: 'flat'|'raised'|'floating'`, `padding` `[MCP]`). The whole tile is a button
that applies a filter: it wraps `Button`-like semantics via `Surface as="button"` (polymorphic `as`; **UNVERIFIED** for Surface, so use the `Interactive`
use case pattern `[MCP Surface usecases: Interactive]`). On click, the tile sets the matching filter. Each tile has `aria-label="Show triggered incidents"`.

| Tile | Visualization | Component / key props | Data |
| --- | --- | --- | --- |
| Triggered | Count + 24 h trend | `SingleValue data={n} label="Triggered" prefixIcon={<CriticalIcon />}` + `<SingleValue.Sparkline data={timeseries} variant="area" color={Colors.Charts.Status.Critical.Default} />` `[MCP use case AddSparkline][DTS charts/single-value/SingleValue.d.ts]` | count by status; hourly makeTimeseries |
| Acknowledged | Count + trend arrow | `SingleValue` + `<SingleValue.Trend direction value label="vs. 1 h ago" inverseTrend />` (TrendProps `direction, value, label, inverseTrend, showIcon` `[DTS]`) | |
| Open P1 | Count, red background when > 0 | `SingleValue applyThresholdBackground` + `SingleValue.ColorRule` (threshold: > 0 → `Colors.Charts.Status.Critical.Default`). ColorRule prop names are **UNVERIFIED**, so copy use case `ColorRules` `[MCP]` | |
| MTTA today | Duration vs target | `MeterBarChart value={mttaMs} max={targetMs*2} unit="millisecond"` with `MeterBarChart.Label` "MTTA today", `MeterBarChart.Value` "4 min 12 s", `ThresholdIndicator` at target (Good/Warning/Bad threshold tokens) `[MCP use case Thresholds]` | median(ack − created) today |
| My incidents | Count | `SingleValue data={n} label="Assigned to me" prefixIcon={<AccountIcon />}` | assignee = current user |
| Open by priority | Composition P1–P5 | `MultiMeterBarChart` with five `MultiMeterBarChart.Segment`s colored with the `Charts.SecurityRiskLevel.*` tokens of 1.2 (segment props **UNVERIFIED**; use case `ChangeSegmentColor` `[MCP]`) | count open by priority |

All tiles take `loading` while the first query runs `[MCP]`. Error state: one `MessageContainer variant="critical"` above the strip ("Couldn't load
KPIs: <error>. Retry"), and the tiles show "–". Empty (0 open) is a valid value, not an empty state: "0" with the success copy "All clear" in `Text textStyle="small"`.

### 4.3 Filter bar

The console needs seven FilterBar dimensions (status, priority, team, assignee, service, source, escalation level), plus a timeframe and free-text search.
`FilterBar` is meant for five or fewer visible categories `[STD:patterns/filtering]`, so pin four (status, priority, team, assignee), show service as pinned-optional,
and put source and escalation behind the FilterBar's **additional filters** menu (`defaultPinnedState` values `'pinned' | 'pinned-optional' | 'optional'`, use case
`AdditionalFilters` `[MCP]`). The standard pairs a FilterBar with an optional `TimeframeSelector` `[STD:patterns/filtering]`. The free-text `SearchInput` is this spec's addition for ID/title lookup.

```tsx
<Flex gap={8} alignItems="end" flexWrap="wrap">
  <FilterBar onFilterChange={applyFilters}
    defaultPinnedState={{ status: 'pinned', priority: 'pinned', team: 'pinned', assignee: 'pinned',
                          service: 'pinned-optional', source: 'optional', escalation: 'optional' }}>
    <FilterBar.Item name="status" label="Status">
      <Select multiple clearable name="status">…Triggered | Acknowledged | Snoozed | Resolved…</Select>
    </FilterBar.Item>
    <FilterBar.Item name="priority" label="Priority">
      <Select multiple clearable name="priority">{['P1','P2','P3','P4','P5'].map(p => <Select.Option value={p}><PriorityChip …/></Select.Option>)}</Select>
    </FilterBar.Item>
    <FilterBar.Item name="team" label="Team"><Select multiple clearable>…</Select></FilterBar.Item>
    <FilterBar.Item name="assignee" label="Assignee"><Select multiple clearable>{/* "Me" first, "Unassigned", then users */}</Select></FilterBar.Item>
    <FilterBar.Item name="service" label="Service"><Select multiple clearable><Select.Filter />…</Select></FilterBar.Item>
    <FilterBar.Item name="source" label="Source"><Select multiple>Davis problem | Event API | Custom…</Select></FilterBar.Item>
    <FilterBar.Item name="escalation" label="Escalation level"><Select multiple>Step 1…n | Exhausted</Select></FilterBar.Item>
    <FilterBar.ResetButton />
  </FilterBar>
  <TimeframeSelector value={tf} onChange={setTf} />          {/* default from Settings, e.g. last 24 h */}
  <SearchInput placeholder="Search title, ID, entity" />     {/* [MCP list: SearchInput] */}
</Flex>
```

Verified: `FilterBar.Item` props `name*`, `label*`, `children*` (one element), `showLabel`; `FilterBar.ResetButton`; `onFilterChange`; controlled `pinnedState`/`onPinnedStateChange`
or uncontrolled `defaultPinnedState` `[MCP][DTS filters/index.d.ts ControlledFilterBarProps/UncontrolledFilterBarProps]`; `Select` props `multiple`, `clearable`, `name`,
subcomponents `Select.Content`, `Select.Option`, `Select.Filter`, `Select.Group`, `Select.GroupLabel`, `Select.Prefix` `[DTS forms/select/Select.d.ts]`;
`TimeframeSelector value/onChange` `[MCP]`, presets via `TIMEFRAME_SELECTOR_PRESETS` (used in v1) `[DTS filters/index.d.ts]`.

Behavior: filter state is synced to the URL query (`?status=TRIGGERED,ACKNOWLEDGED&priority=P1`) so NOC screens can be bookmarked. The default view is
"Status: Triggered + Acknowledged, all priorities". KPI tiles write into the same state. A `Chip` row is **not** needed because the FilterBar shows values.

### 4.4 Incident table

`DataTable` from `@dynatrace/strato-components/tables` `[MCP]`.

```tsx
<DataTable
  data={incidents} columns={columns} rowId={(r) => r.id}
  fullWidth sortable resizable columnOrdering
  sortBy={[{ id: 'priority', desc: false }, { id: 'age', desc: true }]}    // sortBy shape UNVERIFIED: see DataTableColumnSort
  variant={{ rowDensity: 'condensed' }}
  selectableRows selectedRows={sel} onRowSelectionChange={setSel}
  interactiveRows activeRow={activeId} onActiveRowChange={openDetails}
  rowThresholds={[/* optional subtle row tint for P1 Triggered; UNVERIFIED shape, see use case RowThresholds */]}
  loading={isFirstLoad}
>
  <DataTable.TableActions>{/* bulk hint text or nothing */}</DataTable.TableActions>
  <DataTable.Toolbar>
    <DataTable.LineWrap />
    <DataTable.ColumnOrderSettings />
    <DataTable.VisibilitySettings />
    <DataTable.DownloadData />
  </DataTable.Toolbar>
  <DataTable.SelectedRowsActions>{(rows) => <BulkActions rows={rows} />}</DataTable.SelectedRowsActions>
  <DataTable.RowActions>{(row, { rowDensity }) => <RowQuickActions row={row} size={rowDensity !== 'comfortable' ? rowDensity : 'default'} />}</DataTable.RowActions>
  <DataTable.ExpandableRow>{({ row }) => <DataTable.ExpandableRowWrapper><IncidentPreview incident={row} /></DataTable.ExpandableRowWrapper>}</DataTable.ExpandableRow>
  <DataTable.CellActions>{() => <TableActionsMenu><TableActionsMenu.CopyItem />{/* "Filter for value" */}</TableActionsMenu>}</DataTable.CellActions>
  <DataTable.EmptyState><ConsoleEmptyState /></DataTable.EmptyState>
  <DataTable.Pagination />
</DataTable>
```

Verified `[MCP props + use cases][DTS tables/DataTable/DataTable.d.ts]`: props `data*`, `columns*`, `rowId`, `fullWidth`, `sortable`, `resizable`, `columnOrdering`,
`sortBy`/`onSortByChange`, `selectableRows`, `selectedRows`, `onRowSelectionChange`, `interactiveRows`, `activeRow`, `onActiveRowChange`, `rowThresholds`, `loading`,
`variant`, `columnVisibility`, `pinnedColumns`; slots `TableActions`, `Toolbar`, `LineWrap`, `ColumnOrderSettings`, `VisibilitySettings`, `DownloadData`,
`SelectedRowsActions` (+ `DataTable.SelectionChip`), `RowActions`, `ExpandableRow`/`ExpandableRowWrapper` (props `defaultExpandedRows`, `expandedRows`,
`onExpandedRowsChange`, `disableExpand` `[DTS features/RowDetails/row-details-types.d.ts]`), `CellActions`, `EmptyState`, `Pagination`; `TableActionsMenu.CopyItem`
must come first in cell actions `[STD:DataTable-Compliance-Checklist]`. Row click opens the details panel **in context** and never navigates `[STD:DataTable-Compliance-Checklist]`.

#### Columns (default order; `id` = accessor unless noted)

| id | Header | Width | Cell |
| --- | --- | --- | --- |
| `priority` | Priority | 84 | `<PriorityChip size="condensed" />`; sort by numeric rank |
| `status` | Status | 140 | `HealthIndicator visual="shape"` + label; snoozed shows "Snoozed until 14:30" in `Text textStyle="small"` |
| `title` | Incident | `1fr`, min 280 | `Text textStyle="base-emphasized"` + `TextEllipsis`; second line `Text textStyle="small"` with `#ID` in `fontStyle="code"` and the primary affected entity |
| `age` | Age | 90 | relative "12 min". Over the ack SLA: `Colors.Text.Critical.Default` + `ClockIcon`. Tooltip shows absolute time |
| `source` | Source | 120 | `DavisAIIcon` "Davis" / `EventIcon` "Event API" |
| `service` | Service | 160 | text |
| `team` | Team | 140 | text |
| `assignee` | Assignee | 160 | `Avatar size="small" abbreviation` + `Avatar.Label` (name). Unassigned: `Text` "Unassigned" in `Colors.Text.Neutral.Subdued` |
| `escalation` | Escalation | 140 | "Step 2 of 4" + `ProgressBar value={2} max={4} density="condensed"` (`ProgressBar` props `value, min, max, density, color` `[MCP]`); exhausted: `color="critical"` + "Exhausted" |
| `notified` | Last notified | 140 | channel icon + relative time; failed delivery: `CriticalFailedIcon` with `Colors.Icon.Critical.Default` |
| `createdAt` | Created | hidden by default | `columnType: 'datetime'` `[DTS ColumnTypes/column-types-types.d.ts]` |

`DataTableColumnDef` keys `id`, `header`, `accessor`, `width`, `minWidth`, `columnType`, `config`, `cell` (custom renderer via `DataTable.DefaultCell`) `[MCP use cases
Accessors, CustomCellRendering, ColumnWidthsSizing]`. The exact name of the custom cell key (`cell`) is **UNVERIFIED**, so check `DataTableCustomCell` in `tables/index.d.ts`.

#### Row quick actions (`DataTable.RowActions`)

Icon-only buttons, condensed, each in `Tooltip` + `aria-label`, max three visible plus overflow `Menu`:
1. **Acknowledge** (`CheckmarkIcon`), disabled when not Triggered (tooltip "Already acknowledged").
2. **Resolve** (`SuccessIcon`).
3. `Menu` (`DotMenuIcon` trigger, label "More actions"): **Reassign…** (`AccountIcon`, opens Reassign modal), **Escalate now** (`ArrowUpIcon`),
   **Snooze** (`PauseIcon`, `Menu.Sub` with 15 min / 30 min / 1 h / 4 h / Custom…), **Add note** (`DescriptionIcon`), **Open Davis problem** (`DavisAIIcon`, only for Davis source),
   **Copy link** (`CopyIcon`). `Menu.Sub`, `Menu.SubTrigger`, `Menu.SubContent` `[MCP]`.

Optimistic update: the row changes status immediately. A toast confirms, with an **Undo** action for Acknowledge/Resolve within 10 s:
`showToast({ type: 'success', title: 'Incident acknowledged', message: '#1234 · Checkout latency', actions: <Button onClick={undo}>Undo</Button>, lifespan: 10000 })`.
`ToastOptions` = `title*`, `type: 'info'|'warning'|'critical'|'success'`, `message`, `lifespan: number|'infinite'`, `actions`, `role`, `position`, `id` `[DTS notifications/toast/Toast.d.ts]`.
Failure: `type: 'critical'`, title "Couldn't acknowledge #1234", message = error text, action "Retry". The row reverts.

#### Bulk actions (`DataTable.SelectedRowsActions`)

`<DataTable.SelectionChip />` ("3 selected") + `Button`s: **Acknowledge**, **Resolve**, **Reassign…**, **Snooze…**, `Menu` (**Escalate now**, **Set priority…**).
Buttons that don't apply to all of the selection are disabled with a reason tooltip ("2 of 3 are already resolved"). Resolving more than 10 incidents asks for confirmation (`Modal`).

#### Expanded row (`DataTable.ExpandableRow`)

A 3-column `Grid` inside `ExpandableRowWrapper`: (1) description `ExpandableText` + affected entities `ChipGroup` (2) last 3 timeline events (3) escalation step mini-view (5.4).
This is a preview. "Open details" `Button` opens the panel.

#### Auto-refresh

`TitleBar.Suffix`: a `Select` "Auto-refresh" (Off / 15 s / 30 s / 1 min / 5 min; default from Settings) with `RefreshAutoIcon` in `Select.Prefix`, a `Button`
icon-only "Refresh now" (`RefreshIcon`), and `Text textStyle="small"` "Updated 14:02:31". During refresh the data stays and the small `ProgressCircle` shows.
New rows since the last refresh get a transient row highlight (UNVERIFIED mechanism, otherwise skip) and a `showToast({ type: 'info', role: 'status', title: '3 new incidents' })`
when the user is scrolled away or a details panel is open. Auto-refresh pauses while a modal is open and resumes after.

#### States

- Loading: `DataTable loading` (keeps the header) `[MCP use cases LoadingStateInitial, LoadingStateData]`.
- Empty with default filter: `EmptyState` title "No open incidents", details "Everything is quiet. New Davis problems and ingested events appear here
  automatically.", actions "Show resolved" (sets status filter). Visual: `context="table" type="no-result"`.
- Empty because of filters: title "No incidents match your filters", action "Clear filters".
- No data source yet (first run): title "Connect your first event source", details "Send events through the Dynatrace Events API or let Davis
  problems flow in.", action "Set up inbound integration" → `/integrations`, secondary "Turn on demo mode".
- Error: `MessageContainer variant="critical"` above the table with the real DQL error (reuse v1 `formatQueryError`, which maps errorType to a sentence), action **Retry**.

---

## 5. Incident details — `PageLayout.Details`

### 5.1 Container

```tsx
<PageLayout.Details
  collapsed={!activeId} onCollapsedChange={(c) => c && setActiveId(null)}
  defaultLayout="split" defaultWidth="40%" minWidth={420} resizable>
  <Flex flexDirection="column" gap={16} padding={16}>
    <Flex alignItems="center" gap={8}>
      <Heading level={2}>…</Heading>
      <PageLayout.Details.ControlBar>{/* custom buttons appear before close/layout toggle */}</PageLayout.Details.ControlBar>
    </Flex>
    …
  </Flex>
</PageLayout.Details>
```
A controlled `collapsed` derived from the selection is the documented pattern ("open on select, close on deselect") `[MCP PageLayout usage]`. The
`ControlBar` renders close + split/overlay toggle `[MCP PageLayout usage]`. The `/incidents/:id` route sets `activeId` on load. The `defaultWidth` value
format (`PanelWidth`: number or percent string) is from `[DTS split-layout/slots.d.ts]`, and the exact union is **UNVERIFIED**.

### 5.2 Header

- Line 1: `PriorityChip` + `HealthIndicator visual="icon"` with label + `Text fontStyle="code"` "#1234" + `CopyIcon` icon button ("Copy link").
- Line 2: `Heading level={2}` title (wraps, no truncation: "Nothing important is truncated" `[STD:foundations/content-checklist]`).
- Line 3 (meta, `Text textStyle="small"`, `Colors.Text.Neutral.Subdued`): "Opened 14:02 CET · 23 min ago · Service: checkout · Team: Payments · Source: Davis".
- Actions row: primary `Button color="primary" variant="accent"` **Acknowledge** (when Triggered) or **Resolve** (when Acknowledged); then `Button` **Reassign**,
  **Escalate now**, **Snooze** (`Menu`), and a `Menu` with **Change priority**, **Add note**, **Reopen** (when Resolved), **Copy link**.
  Only one accent button.
- Davis problem link: `IntentButton` or `AppLink` to the Problems app. Both are verified components (`AppLink` props `appId*`, `pageToken` `[MCP]`;
  `IntentButton` `[MCP list]`), but the **Problems app id, page token and intent payload are UNVERIFIED**. **Fallback:** `ExternalLink` to the problem URL built from
  `getEnvironmentUrl()` (as v1 does) with the label "Open in Problems app" and `DavisAIIcon`.

### 5.3 Body — `Tabs`

`Tabs selectedIndex onChange` (controlled; props `selectedIndex*`, `onChange*`, `panelOverflow` `[MCP]`) with `Tab title prefixIcon keepMounted` `[DTS navigation/tabs/Tab.d.ts]`.

1. **Timeline** (`TimelineEventIcon`, default)
2. **Escalation** (`StepIcon`)
3. **Entities** (`HostsIcon`) — count in title, e.g. "Entities (3)"
4. **Notes** (`DescriptionIcon`) — count in title

#### Timeline (composed; no Strato timeline component exists)

Vertical list, newest first, grouped by day (`Text textStyle="small-emphasized"` day header + `Divider`). Each item is a
`Flex gap={12}`: a 24px icon column (icon colored with `Colors.Icon.*`), then a content column:

| Event type | Icon / color | Primary text | Secondary |
| --- | --- | --- | --- |
| Created (system) | `EventIcon` / `Icon.Neutral.Default` | "Incident created from Davis problem P-2411" | source, rule matched ("Rule: Payments – latency → P2") |
| Routed / priority set (system) | `ConditionsIcon` / neutral | "Routed to Payments, priority P2" | rule name link |
| Escalation step started | `StepIcon` / `Icon.Primary.Default` | "Escalation step 2 started: notify on-call Payments primary" | policy name |
| Notification sent (per channel, per person) | channel icon (`MobileIcon`/`CallIcon`/`ChatIcon`/`MailIcon`/`HttpIcon`) | "SMS to <person>" | `HealthIndicator` delivery status (Delivered/Sent/Failed/Skipped) + provider ("Twilio") + workflow execution link |
| User action (ack/resolve/reassign/snooze/priority/reopen) | `CheckmarkIcon` / `SuccessIcon` / `AccountIcon` / `PauseIcon` / `EditIcon` / `RefreshIcon`, `Icon.Neutral.Default` | "<Avatar small> <name> acknowledged" | via "Console" / "SMS reply" |
| Note | `DescriptionIcon` | note text (`Markdown`, read-only `[MCP]`) | author, time |
| Davis update | `DavisAIIcon` | "Davis problem closed" / "Root cause updated" | |
| Resolved | `SuccessIcon` / `Icon.Success.Default` | "Resolved by <name>" | duration "open for 1 h 4 min" |

Timestamps are right-aligned `Text textStyle="small"` (absolute HH:mm:ss, tooltip with full date + zone). A failed notification item uses
`Container color="critical" variant="default"` around the item, with the provider error text and a "Retry notification" `Button`.
Top of tab: `ToggleButtonGroup` filter "All · Actions · Notifications · System" (`ToggleButtonGroup.Item value` `[MCP]`).
Loading: 5 rows of `SkeletonText`. Empty is not possible (always ≥ "Created").

#### Escalation progress (composed stepper)

The Strato stepper (`createStepper`, `StepperNavigation`, `StepperPanel`, `StepperFooter` `[DTS navigation/index.d.ts]`) is a **form wizard** (`onNext`, `onComplete`,
step values `[DTS navigation/stepper/Stepper.types.d.ts]`). It is **not** used for read-only progress. Compose instead:

- Summary: `ProgressBar value={currentStep} max={steps.length}` with `ProgressBar.Label` "Step 2 of 4" and `ProgressBar.Value` "next in 3 min" `[MCP]`; color `primary`,
  `critical` when exhausted.
- Ordered list (`Flex flexDirection="column" gap={8}`), one row per step:
  - done: `SuccessIcon` (`Icon.Success.Default`) + "Step 1 · Notify Payments primary on-call · SMS, Voice · completed 14:05 · acknowledged: no"
  - current: `ProgressCircle size="small"` (indeterminate) + emphasized text + countdown "escalates in 03:12"
  - upcoming: `CircleIcon` (`Icon.Neutral.Subdued`) + subdued text + "after 10 min"
  - repeat marker: `RepeatIcon` "Repeats 2 more times"
  - Step targets: `AvatarGroup` (`AvatarGroup.Item abbreviation tooltipText` `[MCP]`) for users, `GroupIcon` + team name for team/schedule targets.
- Actions: **Escalate now** (`ArrowUpIcon`), **Pause escalation** (only while Acknowledged: escalation stops automatically on ack; copy explains this).

#### Entities

`DataTable` (small, structured list): Entity (icon by type + name, `Link`/`AppLink` to the entity, target **UNVERIFIED**), Type, Entity ID (`fontStyle="code"`,
`TableActionsMenu.CopyItem`). Empty: `EmptyState size="small"` "No affected entities" "This event wasn't linked to a Dynatrace entity."

#### Notes

`TextArea` (in `FormField` + `Label` "Add note") + `Button` "Add note" (`variant="emphasized"`), then the note list (newest first) with `Avatar` + name + time + `Markdown`.
Notes are append-only (audit). No edit/delete. `TextArea` props `value`, `onChange`, `disabled`, `required` `[MCP]`.

### 5.4 Modals used from Console/detail

All use `Modal` (`title*`, `show`, `onDismiss`, `footer`, `size`, `dismissible` `[MCP]`). The footer buttons are right-aligned (allowed in modals `[STD:patterns/forms-validation]`).
- **Reassign**: `FormField` "Assign to" with `Select` (single) grouped `Select.Group` "Teams" / "People", `Select.Filter`; `TextArea` "Note (optional)". Buttons "Reassign" (accent) / "Cancel".
- **Snooze custom**: `DateTimePicker type="datetime"` "Snooze until" (`DateTimePickerType = 'time' | 'date' | 'datetime'` `[DTS forms/date-time-picker]`) + note. Button "Snooze".
- **Change priority**: `RadioGroup` P1–P5 with `PriorityChip` + meaning (`[DTS forms/radio/RadioGroup.d.ts]`).
- **New incident** (OPTIONAL, pending the lead's decision; manual, from AppHeader): title*, priority*, service*, description (`TextArea`), "Notify according to service routing" `Checkbox` (default on). Creation goes through the
  Events API path the backend uses (see the architecture doc). That path is **UNVERIFIED** here.
- **Bulk resolve confirm**: title "Resolve 14 incidents?", body states the consequence ("Escalations stop and responders are notified that the incidents are resolved."), buttons "Resolve" (`color="primary" variant="accent"`) / "Cancel". **Delete confirmations** (config objects only; incidents are never deleted) use `Button color="critical" variant="accent"` "Delete".

---

## 6. On-call — `/on-call`

`TitleBar` "On-call", subtitle "Who's responsible right now and who's next". Action: `Button` accent **New override** (`PlusIcon`).
Below: `Tabs` (controlled, synced to `?tab=`) **Now** · **Schedules** · **Overrides**.

### 6.1 Tab "Now"

- Toolbar: `Select` "Team" (multiple, default = my teams), `ToggleButtonGroup` "Range": 24 h / 7 days / 14 days, `TimeframeSelector` not needed.
- **On call now cards**: `Grid gridTemplateColumns="repeat(auto-fill, minmax(280px, 1fr))" gap={12}`. One `Surface padding={16}` per team:
  - `Heading level={3}` team name + `Chip size="condensed"` with the schedule name.
  - Per layer (Primary, Secondary…): `Avatar abbreviation` + `Avatar.Label` name + `Avatar.Subtitle` "until Fri 09:00 CET" `[MCP use case Slots]`, then the contact method
    icons available for that person (`MobileIcon`, `CallIcon`, `ChatIcon`, `MailIcon`; muted `Colors.Icon.Neutral.Disabled` where not configured).
  - Override active: `Chip color="primary" size="condensed"` "Override" with tooltip "Covers for <name> until 18:00".
  - Gap in coverage: `Container color="warning"` "No one is on call for Secondary until 18:00" + `Button` "Add override".
  - Footer: `Link` "View schedule" → `/on-call/schedules/:id`.
- **Upcoming shifts (gantt)**: `DataTable` with a `columnType: 'gantt'` column `[DTS ColumnTypes/column-types-types.d.ts][MCP use case ColumnTypeGantt]`.
  - Rows = team → `subRows` = layer → person (DataTable `subRows`, `defaultOpenSubRows` `[MCP use case ColumnTypeGantt]`).
  - Columns: "Who" (`Avatar` + name, width 240), "Shifts" (`columnType: 'gantt'`, `width: '1fr'`, `minWidth: 600`).
  - The gantt cell accepts **one segment or an array of segments** (`data: GanttSegmentData | GanttSegmentData[]` `[DTS features/GanttChart/DataTableGanttChartCell.d.ts]`),
    where `GanttSegmentData = Record<string, unknown> & { start: number; end?: number }` `[DTS charts/gantt-chart/types/gantt-chart.d.ts]`.
    So each person row's accessor returns all of their shifts in the range as `{ name, kind, start: epochMs, end: epochMs }[]`.
  - `config`: `{ xAxisType: 'time', min: rangeStartMs, max: rangeEndMs, nameAccessor: 'name', colorAccessor: 'kind',
    colorPalette: { Shift: Colors.Charts.Status.Good.Default, Override: Colors.Charts.Categorical.Color05.Default, Gap: Colors.Charts.Status.Warning.Default },
    showBackground: true, tooltip: (seg) => <ShiftTooltip seg={seg} />,
    annotationsHeader: { tracks: [{ markers: [{ title: 'Now', start: Date.now() }] }] } }` (`GanttChartConfig` keys `min, max, xAxisType, nameAccessor, colorAccessor,
    colorPalette, showBackground, annotationsHeader, tooltip | tooltipActions, formatter` `[DTS]`). Colors come only from tokens: the official example uses rgb() literals,
    and those must not be copied.
  - Whether `xAxisType: 'time'` expects epoch ms numbers is implied by `start: number` but **UNVERIFIED**. Check `useScaleAndFormatter.d.ts` and render with demo data.
- States: loading → `DataTable loading`; no schedules → `EmptyState` "No on-call schedules yet" / "Create a schedule to define who gets notified and when." /
  action "New schedule"; error → `MessageContainer critical` + Retry.

### 6.2 Tab "Schedules"

A structured-list `DataTable` (sortable, `interactiveRows` → navigate is **not** allowed on row click `[STD:DataTable-Compliance-Checklist]`, so the name cell is a
`Link` to `/on-call/schedules/:id` (context switch), and row click opens a small `PageLayout.Details` preview with the current/next on-call and coverage).
Columns: Name (Link), Team, Time zone, Layers (count), On call now (`AvatarGroup`), Next handoff (relative), Coverage next 7 days (`columnType: 'meterbar'` with
`config: { min: 0, max: 100, showValue: 'right', thresholds: [{ value: 100, color: Colors.Charts.Threshold.Good.Default }] }` `[DTS DataTableMeterbarColumnConfig]`).
Row actions: Edit, Duplicate, Delete (confirm). `TitleBar.Action`: **New schedule**.

### 6.3 Tab "Overrides"

`DataTable`: Who covers (Avatar), For (Avatar, original person), Schedule/layer, From, To (`columnType: 'datetime'`), Reason, Created by. Filter: `Select` schedule, toggle
"Upcoming / Past". Row actions: Edit, Delete. **New override** modal: `Select` schedule*, `Select` layer*, user picker* (6.5), `DateTimePicker` from*/to*, `TextInput` reason.
A preview `MessageContainer variant="neutral"` says "<A> will cover for <B> from Mon 18:00 to Tue 09:00 CET (15 h)". Validation: "Add an end time after the start time." `[STD:patterns/error-messages]`.

### 6.4 Schedule editor — `/on-call/schedules/:id` (screen 6 of the brief)

Layout: `Breadcrumbs` (On-call › Schedules › Payments primary) in `TitleBar.Navigation`; `TitleBar.Title` editable name; `TitleBar.Action`: **Save** (accent, `loading`), `Button` **Cancel**;
dirty-state guard modal "Discard unsaved changes?".

Two columns on desktop (`Grid gridTemplateColumns="minmax(360px, 480px) 1fr" gap={24}`); stacked below `Breakpoints.Max.Tablet`.

**Left: form** (max width 480 `[STD:patterns/forms-validation]`):
1. `FieldSet` + `FieldSet.Legend` "Schedule" `[MCP]`: Name* (`TextInput`), Team* (`Select`), Time zone* (`Select` with `Select.Filter`, IANA zones, default = tenant zone
   from Settings), Description (`TextArea`).
2. `Accordion` (`Accordion.Section`, `Accordion.SectionLabel`, `Accordion.SectionContent`, `multiple`, `showDividers` `[MCP]`). One section per **layer**
   ("Layer 1 · Primary"), section label shows a summary "Weekly · 4 people · handoff Mon 09:00".
   Layer fields:
   - Layer name* (`TextInput`)
   - Rotation type* (`RadioGroup`: Daily / Weekly / Custom). Custom shows `NumberInput` "Every" + `Select` unit (hours/days/weeks).
   - Handoff* (`Select` weekday for weekly rotations + time of day. Use `DateTimePicker type="time" precision="minutes"` (`DateTimePickerType = 'time'|'date'|'datetime'`, `DateTimePickerPrecision = 'minutes'|'seconds'|'milliseconds'` `[DTS forms/date-time-picker]`; `precision?: DateTimePickerPrecision` is a verified prop (it is `never` for `type="date"`) `[DTS forms/date-time-picker]`)
   - Start date* (`DateTimePicker type="date"`)
   - Restrict to hours (optional `Switch` "Only during specific hours" → weekday `Checkbox` group + from/to time)
   - **Participants (ordered)**: a `DataTable` with drag-and-drop row ordering: `rowOrdering={{ enableDragAndDrop: true }}`, `rowOrder`, `onRowOrderChange`, `rowId`
     `[MCP use case RowOrderControlled]`. Columns: position "1.", person (`Avatar` + name), contact methods icons, row action **Remove** (`XmarkIcon`).
     Above it: user picker (6.5) + `Button` **Add member**. Sorting is disabled when row ordering is on `[STD:DataTable-Compliance-Checklist]`.
   - Layer actions: **Duplicate layer**, **Delete layer** (confirm).
   `Button` **Add layer** (`PlusIcon`) below the accordion.

**Right: coverage preview** (live, recomputed on change, debounced 300 ms):
- `ToggleButtonGroup` 1 week / 2 weeks / 4 weeks.
- `DataTable` gantt as in 6.1, rows = layers + a final row **"Final schedule"** (the effective on-call after layers and overrides). Gaps are `kind: 'Gap'` in the warning color.
- Summary line: `HealthIndicator status="ideal"` "Full coverage" or `status="warning"` "3 gaps, 14 h uncovered in the next 2 weeks".
- Empty (no participants): `EmptyState size="small"` "Add members to preview coverage".

Validation summary on save, near the Save button: "To save this schedule: · Add at least one member to Layer 1 · Choose a time zone" `[STD:patterns/error-messages]`.

### 6.5 User picker (tenant IAM users, type-ahead): shared component `UserPicker`

Members must be Dynatrace IAM users. The search is server-side: `usersAndGroupsClient.getActiveUsersForOrganizationalLevel({ levelType: 'environment'|'account', levelId,
partialString })`. `partialString` matches the email substring and the name/surname prefix, **minimum 3 characters**, plus cursor pagination `pageKey`. It returns `RestUserPublicListResponse.results: RestUserPublic[]` with
`{ uid: string; email: string; name?: string; surname?: string; description?: string }` `[DTS @dynatrace-sdk/client-iam/types/index.d.ts]`. `name`/`surname` are optional, so fall back to the email local part for display and initials.
(Which `levelType`/`levelId` an app can use, and the required IAM scope, are **UNVERIFIED** here and belong to the architect.)

```tsx
<FormField label="Add member">     {/* label API per FormField use case SetLabel: UNVERIFIED prop vs <Label> child */}
  <Select multiple value={ids} onChange={setIds} name="members">
    <Select.Filter value={q} onChange={setQ} disableFiltering />   {/* server filters [DTS forms/select/SelectFilter.d.ts] */}
    <Select.Content loading={isSearching}>                       {/* [DTS forms/select/SelectContent.d.ts] */}
      {results.map(u => (
        <Select.Option key={u.uid} value={u.uid} textValue={`${u.name} ${u.surname} ${u.email}`}>
          <Select.Prefix><Avatar size="small" abbreviation={initials(u)} /></Select.Prefix>
          {u.name} {u.surname} <Text textStyle="small">{u.email}</Text>
        </Select.Option>
      ))}
    </Select.Content>
    <Select.EmptyState>{q.length < 3 ? 'Type at least 3 characters' : 'No users found'}</Select.EmptyState>
  </Select>
</FormField>
```
Debounce 300 ms, abort the previous request (`abortSignal`). Selected users render as removable `Chip`s (`Chip.DeleteButton` `[MCP]`) inside a `ChipGroup` when a multi-add
flow is used. In demo mode, the picker searches the demo user list locally. Emails are personal data: show them only in the picker and the team member list, never in logs or toasts.

---

## 7. Teams — `/teams`, `/teams/:id`

### 7.1 List

`TitleBar` "Teams" · Action **New team**. `SearchInput` in `DataTable.TableActions` (structured-list pattern `[STD:DataTable-Compliance-Checklist]`).
`DataTable` columns: Name (`Link`), Members (`AvatarGroup` max 5 + "+3"), On call now (Avatar + name), Escalation policy (Link), Services (count), Open incidents
(compact `PriorityChip size="condensed"` per non-zero priority with the count, e.g. "P1 2", "P3 1"). Row actions: Edit, Delete (confirm; blocked with reason if the team is referenced
by a policy or rule: "Remove this team from 2 escalation policies first").
Empty: `EmptyState` + `VisualPreset context="generic" type="create-new"`, "Create your first team" / "Teams group the people who respond to incidents for a set of services." /
"New team".

### 7.2 Team detail — `/teams/:id`

`Breadcrumbs` Teams › Payments. `TitleBar.Title` team name, `Subtitle` description, `Action` **Edit team**; `Menu`: Duplicate, Delete.
`Tabs`: **Members** · **On-call** · **Escalation** · **Services**.

**Members tab**
- `UserPicker` + `Select` role + `Button` **Add member** in one `Flex` row above the table.
- `DataTable`: Person (`Avatar` + `Avatar.Label` + `Avatar.Subtitle` email), Role (`Chip size="condensed"` "Team admin" / "Responder" / "Observer"; interactive controls belong in
  `DataTable.RowActions`, not in cells `[STD:DataTable-Compliance-Checklist]`, so the role changes via the row action **Change role**), Contact methods (icons with
  `HealthIndicator visual="shape"`: verified/unverified), On call now (yes/no), row actions **Edit contact methods**, **Remove** (no confirm; it's a low-impact unlink `[STD:patterns/common-actions]`).
- Roles: **Team admin** (edit team, schedules, policies), **Responder** (receives pages, can ack/resolve), **Observer** (read-only, no pages). The copy for each role is
  shown via `InformationOverlay` next to the column header (`InformationOverlay`, `.Trigger`, `.Icon` `[MCP]`).

**Contact methods** (`Sheet` from the row action: `Sheet title show onDismiss actions` `[MCP]`, title "Contact methods · <name>"):
- One `Surface` per method, with fields per type in `FieldSet`s:
  - SMS / Voice / WhatsApp: phone in E.164 (`TextInput`, hint "Include country code, for example +43…"), `Switch` "Use for SMS", "Use for voice", "Use for WhatsApp".
  - Slack: member ID or channel; Microsoft Teams: user/channel webhook reference; Telegram: chat ID; Email: address (prefilled from IAM, read-only).
  - Each method: `Button` **Send test** (`PlayIcon`), result shown inline with `HealthIndicator` (Delivered / Failed + reason).
- Notification rules per person (VictorOps/Opsgenie parity): an ordered list "When I'm paged: 1. Push to Slack immediately, 2. SMS after 2 min, 3. Voice after 5 min"
  with `NumberInput` delays and `Select` method. Uses the same composed step-list style as escalation steps (8.2).
- Contact data storage location (app state vs settings) is decided by the architect. The design only requires that the phone number is masked in lists ("+43 ••• ••• 123").

**On-call tab**: the 6.1 card for this team + gantt for its schedules + link "Manage schedules".
**Escalation tab**: read-only rendering of the team's default policy (8.2 view mode) + "Edit policy".
**Services tab**: list of services routed to this team (from routing rules), with `Link`s.

---

## 8. Escalation policies — `/escalations`, `/escalations/:id`

### 8.1 List

`DataTable`: Name (Link), Team, Steps (count + compact summary "SMS → Voice → Team lead"), Repeat ("2×"), Used by (services count), Last triggered (relative).
Action **New escalation policy**. Empty: "No escalation policies yet" / "Define who gets notified, on which channels, and how long to wait before escalating." / "New escalation policy".

### 8.2 Policy editor

`Breadcrumbs` Escalations › <name>. Form column (max 640 here: the step rows need room) + a right "Simulation" `Surface`.

- `FieldSet` "Policy": Name*, Team* (`Select`), Description.
- **Steps (ordered)**: a vertical list of step `Surface`s (`padding={16}`, `Flex gap={12}`), connected by a "wait" row between steps:
  ```
  [1]  Notify ▸ [target picker]              Channels ▸ [ChipGroup of channel chips]        (⋯ menu)
       ── wait [NumberInput 5] minutes for acknowledgement, then ──
  [2]  Notify ▸ …
  ```
  - Step number: `Text textStyle="base-emphasized"` inside a 24px circle field (`Colors.Background.Field.Neutral.Emphasized`, radius `Borders.Radius.Field.Default`).
  - **Target** (`Select` with `Select.Group`s): "On-call of schedule…" (schedules), "Team…" (all responders), "User…" (UserPicker), "Team admin of…".
  - **Channels**: `Select multiple` with options SMS (`MobileIcon`), Voice (`CallIcon`), WhatsApp, Slack, Microsoft Teams, Telegram (`ChatIcon`), Email (`MailIcon`), Webhook (`HttpIcon`),
    and "Person's notification rules" (default). Channels whose outbound provider isn't configured are **disabled** with the tooltip "Configure Twilio in Integrations first" (link).
  - **Delay** before the next step: `NumberInput min={0} max={1440} step={1}` + unit text "minutes" (`min`, `max`, `step` `[DTS forms/number-input]`).
  - Step `Menu`: Move up, Move down, Duplicate step, Delete step. Reordering by drag is optional. The Move up/down actions are the accessible path and are required.
    (A `DataTable rowOrdering` variant is acceptable if the developer prefers a table; see 6.4.)
  - `Button` **Add step** (`PlusIcon`) at the end.
- **Repeat**: `Switch` "Repeat policy if nobody acknowledges" + `NumberInput` "times" (1–5) + `NumberInput` "minutes between repeats".
- **When exhausted**: `RadioGroup`: "Keep incident triggered" / "Notify team admins" / "Raise priority to P1".
- **Simulation panel** (right): "If an incident is triggered now:" then a timeline preview: "00:00 SMS + Voice to <current on-call>", "00:05 Voice to <secondary>", …, computed from
  schedules (who would be paged *now*). It uses the composed timeline style from 5.3. Warnings in `Container color="warning"`: "Step 2 targets a schedule with a gap now."
- Save validation summary: "To save this policy: · Add at least one step · Choose a target for step 2".

---

## 9. Services and routing — `/services`, `/services/:id`

### 9.1 Services list

`DataTable`: Service (Link), Team (default owner), Escalation policy, Rules (count), Open incidents (count by priority), Noise last 7 days (`columnType: 'sparkline'`,
`config: { variant: 'bar' }` `[DTS DataTableSparklineColumnConfig]`; the data must be a `Timeseries` per row, a contract the developer has to prove with demo data per R7).
Action **New service**.

### 9.2 Service detail: `Tabs` **Routing rules** · **Priority mapping** · **Test a rule** · **Settings**

**Routing rules** (evaluated top to bottom, first match wins; the copy says so in `TitleBar.Subtitle`):
- Ordered `DataTable` with `rowOrdering={{ enableDragAndDrop: true }}` `[MCP]`. Columns: order, Name, Conditions (summary text like `event.type = "AVAILABILITY" AND entity.tags contains "prod"`
  in `Text fontStyle="code"` + `TextEllipsis`), Actions (summary "→ Payments, P2, policy Payments default"), Enabled (`Switch` in `DataTable.RowActions` `[STD:DataTable-Compliance-Checklist]`),
  Matched last 24 h (count). Final row, locked: **"Default (no rule matched)"**, which uses the `useLockedRowOrder` hook `[DTS tables/index.d.ts]` (exact use **UNVERIFIED**; see use case
  `RowOrderLockedRows` `[MCP]`).
- Rule editor in `Sheet` ("Edit rule"):
  - Name*, `Switch` Enabled.
  - **Conditions builder**: `RadioGroup` "Match **all** / **any** of the following". Rows of `Flex gap={8}`: Field (`Select` with `Select.Filter`: `event.name`, `event.type`, `event.category`,
    `event.status`, `dt.davis.is_frequent_event`… the field list comes from the architect's event schema, **UNVERIFIED**), Operator (`Select`: equals, not equals, contains, starts with,
    matches regex, exists, in), Value (`TextInput`, or `Select` when the field has known values), `Button` icon-only **Remove condition** (`XmarkIcon`). `Button` **Add condition**.
    Power-user alternative: a `ToggleButtonGroup` "Builder / DQL filter" switching to `DQLEditor` `[DTS editors/index.d.ts]` (filter expression only). Label it "Advanced"; any DQL shown is UNVALIDATED.
  - **Then**: Team (`Select`), Escalation policy (`Select`), Priority (`RadioGroup` P1–P5 with `PriorityChip`, or "Use priority mapping"), `Switch` "Suppress (don't create incident)",
    `NumberInput` "Deduplicate for minutes", `TextInput` "Title template" with hint listing placeholders `{event.name}`.
  - Sheet `actions`: **Save** (accent), **Cancel**.

**Priority mapping**: a `SimpleTable`-like editable `DataTable` mapping Davis/event severity to P-levels:
| Event category / severity | → Priority |
| AVAILABILITY | P1 |
| ERROR | P2 |
| SLOWDOWN / PERFORMANCE | P3 |
| RESOURCE_CONTENTION | P3 |
| CUSTOM_ALERT | P3 |
| INFO / CUSTOM_INFO | P5 |
Each row's priority is a `Select` rendered through `DataTable.RowActions` (interactive elements are allowed there). The category names follow Davis event categories, which is **UNVERIFIED** (the architect owns the schema).
Plus `Switch` "Raise one level when the event affects more than [NumberInput] entities".

**Test a rule**: split view. Left: `CodeEditor` (`[DTS editors/index.d.ts]`, JSON language **UNVERIFIED**; fallback `TextArea` with `fontStyle` code) prefilled with a sample event,
`Select` "Load sample" (Davis availability problem / custom event / last real event from this service). `Button` **Run test** (`PlayIcon`, accent).
Right: result `Surface`:
- matched: `HealthIndicator status="ideal"` "Matched rule 2: Payments latency" + resulting `PriorityChip`, team, policy, a "would page now" `AvatarGroup`, and per-condition
  check rows (`SuccessIcon` / `XmarkIcon` + the condition + the actual value from the sample).
- no match: `HealthIndicator status="neutral"` "No rule matched; default route applies" + the same per-condition table for the closest rule.
- invalid JSON: inline `FormFieldMessages` critical "Fix the JSON on line 4." (`FormFieldMessages` `[DTS forms/index.d.ts]`).
Tests are evaluated client-side with the same matcher the backend uses (architect).

---

## 10. Integrations — `/integrations`

`TitleBar` "Integrations", subtitle "Events come in through Dynatrace APIs. Notifications go out through Dynatrace Workflows." `Tabs`: **Inbound** · **Outbound** · **Workflows**.

### 10.1 Inbound

- Explainer `Container color="neutral"` with `Paragraph`s: (1) Davis problems are picked up automatically. (2) Custom events are sent to the Dynatrace Events API and read from Grail. (3) Routing rules decide team and priority.
- **Sources table** (`DataTable`): Source (icon + name: "Davis problems", "Events API: <source tag>"), Status (`HealthIndicator`: Receiving / Quiet > 1 h (warning) / Never seen (neutral)),
  Last event (relative + tooltip), Events last 24 h (`columnType: 'sparkline'`), Incidents created 24 h, row action "Show events" (opens Console filtered by source).
- **Send an event** section, `Tabs` by format: **curl** · **PowerShell** · **Python** · **Dynatrace Workflow (HTTP action)**. Each is a `CodeSnippet` with copy
  (`CodeSnippet` with `language`, use cases `Basic`, `ChangeLanguage`, `OnCopy`, `LineWrap` `[MCP]`; on copy show tooltip/toast "Copied" `[STD:patterns/common-actions]`).
  The snippet uses placeholders only: `https://{your-environment-id}.live.dynatrace.com/api/v2/events/ingest`, `Authorization: Api-Token {your-token}` with the scope name
  given by the architect. **No real tenant URL or token in code or demo data (R1).** The endpoint path, required scope and payload fields are **UNVERIFIED** in this design doc. The integration
  engineer must confirm them against the Dynatrace docs and keep the snippet in one constant shared with the Help page.
- Field reference: `SimpleTable` (`[MCP]`) of the event properties the app reads (title, `event.type`, severity, entity selector, custom properties such as `cc.team`, `cc.priority`),
  each with "Used for" (routing, priority, dedup key).
- `MessageContainer variant="warning"` when no event arrived in 24 h and no Davis problems exist: "No events received in the last 24 hours."

### 10.2 Outbound (notification providers)

A `Grid` of provider `Surface`s (`minmax(320px, 1fr)`), each showing: provider name `Heading level={3}`, channel icons, `HealthIndicator` (Configured / Not configured /
Last test failed), last test result + time, `Button` **Configure** and **Send test**.

Providers: **Twilio SMS**, **Twilio Voice**, **Twilio WhatsApp** (one Twilio card with three `Switch`es), **IFTTT Webhooks**, **Slack**, **Microsoft Teams**, **Telegram**, **Generic webhook**.

Configure `Sheet` (title "Configure Twilio"):
- Non-secret fields: Account SID reference/label, sender number (`TextInput`), messaging service, voice language (`Select`), message template (`TextArea` with placeholders
  `{incident.id}`, `{incident.title}`, `{priority}`, `{ack_url}`). Use a live preview `Surface` of the rendered SMS (character count `Text textStyle="small"`, warn above 160).
- **Credentials: vault reference only.** `Select` "Credential" listing Dynatrace credential-vault entries by name (`KeyIcon` prefix) + `ExternalLink` "Manage credentials in the
  credential vault". **The app never asks for, stores, or displays a secret value.** No `PasswordInput`/`SecretInput` is used for provider secrets. (`SecretInput` exists `[DTS forms/secret-input/SecretInput.d.ts]`,
  but it is deliberately not used here.) How the vault list is read (SDK, scope) is **UNVERIFIED** and belongs to the architect/security. **Fallback:** a `TextInput` "Credential ID"
  with the hint "Paste the credential vault ID (CREDENTIALS_VAULT-…)".
- Generic webhook: URL (`TextInput`, validated `https://`), method (`Select`), headers as key → vault-reference rows, body template (`CodeEditor`/`TextArea`).
- **Send test**: modal "Send test notification" with recipient `UserPicker` (single) or channel field + `Button` "Send test". The result appears inline (`HealthIndicator` + provider response
  summary) and in a toast. In demo mode the button is disabled with the tooltip "Not available in demo mode".

### 10.3 Workflows

The notification pipeline lives in Dynatrace Workflows. This tab shows its install and health:
- `DataTable`: Workflow (name + `ExternalLink` "Open in Workflows" with `WorkflowsIcon`. The app id / intent for the Workflows app is **UNVERIFIED**; the fallback is a URL built from the environment URL),
  Purpose ("Escalation notifier", "Delivery status collector"), Installed version vs bundled version (`Chip color="warning"` "Update available"), Trigger, Last run (`HealthIndicator` from execution
  state: Success → ideal, Running → good, Error → critical), Runs 24 h, Failures 24 h.
- `TitleBar.Action` **Install workflows** / **Update workflows** (accent) with a confirmation `Modal` that lists exactly what will be created/updated.
- Not installed: `EmptyState` "Notification workflows aren't installed" / "Install the bundled workflows to send SMS, voice, chat, and webhook notifications." / "Install workflows".
- Install/health come from `@dynatrace-sdk/client-automation` (installed: `^8.10.0`). Specific client methods and workflow **action ids** are **UNVERIFIED** in this design doc (R2).

---

## 11. Settings — `/settings`

Opened from the `SettingIcon` header button. Layout: `PageLayout.Sidebar` (or a left `Flex` column at mobile) with in-page section navigation as `Link`s (General, Data retention,
Notifications, Permissions, About). Content is a single form column (max 480). Each section has its own **Save** button (left-aligned `[STD:patterns/forms-validation]`). Unsaved changes
show the `Text` "Unsaved changes" next to Save.

- **General**: Tenant time zone* (`Select` + `Select.Filter`, default = browser zone, hint "Used for schedules, handoffs, and report days"); Default timeframe (`TimeframeSelector`);
  Auto-refresh default (`Select` Off/15 s/30 s/1 min/5 min); Table density (`ToggleButtonGroup` Default/Condensed); Keyboard shortcuts (`Switch`, see 13); Acknowledge SLA target (`NumberInput` minutes, drives the age color + MTTA meter);
  **Demo mode** (`Switch`, hint "Shows sample data. Actions don't send notifications."). Turning it **off** while no data source exists shows `MessageContainer variant="warning"`
  "No incidents will appear until events arrive. See Integrations".
- **Data retention**: incident history retention (`Select` 30/90/180/365 days) + resolved incident auto-archive (`NumberInput` days), with an explanation of where data lives
  (app state vs Grail, from the architect) and a `MessageContainer variant="neutral"` noting that Grail retention is governed by the tenant bucket settings.
- **Notifications** (personal): link to "My contact methods" (opens the 7.2 `Sheet` for the current user) + `NotificationSettings` is **not** used (it's the platform notification component, a separate concept).
- **Permissions**: read-only `SimpleTable` of the app scopes and what each enables (from `app.config.json`, maintained by the architect), plus the role model (Team admin / Responder / Observer) and
  "Who can change settings". `EmptyState preset={{ reason: 'no-permission', missingPermissions }}` is used anywhere a scope is missing `[DTS content/empty-state/types]`.
- **About**: app version, build, links to Help. `HelpMenu about: 'default'` covers the rest.

---

## 12. Reports — `/reports`

`TitleBar` "Reports" + `TitleBar.Suffix`: `TimeframeSelector` (default last 30 days) + `Select` Team (multiple). Tables get `DataTable.DownloadData` inside their own `DataTable.Toolbar`; charts use their `.Toolbar` slot (download CSV use cases `[MCP]`). Each panel is a `Surface padding={16}` with `Heading level={3}`,
a one-line `Text textStyle="small"` question, and the chart. R8 monotony test: 9 panels, 8 distinct visualization types (SingleValueGrid, line, time bars, categorical bars, top list, donut, honeycomb, histogram, plus a table), exactly one donut, and a table for exact values.

| # | Question | Visualization | Component / key props |
| --- | --- | --- | --- |
| 1 | Are we fast enough right now? (headline) | 4 KPIs | `SingleValueGrid data={[{label:'MTTA',value:…},{label:'MTTR',…},{label:'Incidents',…},{label:'Escalated',…}]} labelAccessor="label"` + `SingleValueGrid.Value`, `.Trend` slots `[DTS charts/single-value-grid/SingleValueGrid.d.ts]` (accessor config **UNVERIFIED** in detail; see `SingleValueGridAccessorsConfig`) |
| 2 | How are MTTA and MTTR changing? | 2 lines, unit ms | `TimeseriesChart data={[mtta, mttr]}` (each `Timeseries` `{ name, unit: 'millisecond', datapoints: [{ start: Date, end: Date, value }] }`), `TimeseriesChart.Line`, `.Legend`, `.YAxis`, plus `ChartInteractions` zoom `[MCP]`. Use `convertQueryResultToTimeseries` for DQL results `[DTS charts/index.d.ts]` |
| 3 | When do incidents arrive? | bars over time by priority | `TimeseriesChart` with `TimeseriesChart.Bar` series (subcomponent verified `[MCP]`), one series per P-level colored with the `SecurityRiskLevel` tokens (`colorPalette` custom map key shape for timeseries **UNVERIFIED**; fallback: default palette) |
| 4 | Which teams get the most incidents? | stacked bars team × priority | `CategoricalBarChart data={[{ category: 'Payments', value: { P1: 3, P2: 8, … } }]} groupMode="stacked" layout="horizontal"` (data shape from use case `GroupMode` `[MCP]`; `groupModeOptions = ['grouped','stacked']`, `layoutOptions = ['horizontal','vertical']` `[DTS charts/index.d.ts]`) |
| 5 | Which sources are the noisiest? | ranked list | `TopList data labelAccessor="source" valueAccessor="count"` `[MCP]`, top 10 |
| 6 | How is the load split across priorities? | donut, 5 slices | `DonutChart data labelAccessor="priority" valueAccessor="count"` with `DonutChart.Legend` `[MCP]`, colors from the P tokens |
| 7 | Which services are unhealthy now? | hive, one tile per service | `HoneycombChart data={services.map(s => ({ name: s.name, value: s.worstOpenPriority ?? 'OK' }))} colorPalette={{ P1: …SecurityRiskLevel.Critical, P2: …High, P3: …Medium, P4: …Low, P5: …None, OK: Colors.Charts.Status.Ideal.Default }}` with `HoneycombChart.Legend`. Categorical data uses `colorPalette`, numeric uses `colorScheme`: they're mutually exclusive `[DTS charts/honeycomb types]`. Use only when there are ≥ 20 services, otherwise show a `DataTable` |
| 8 | How long until acknowledgement? | distribution | `HistogramChart data={[{ name: 'Time to acknowledge', bins: … }]}` (`HistogramSeries` shape **UNVERIFIED**: read `charts/histogram` types), x unit minutes |
| 9 | Who carries the on-call load? | table with in-cell bars | `DataTable`: Person, Team, On-call hours (`columnType: 'meterbar'`), Pages received, Off-hours pages, Night pages (00–06), Acks, Avg time to ack. Sortable, `DataTable.DownloadData` |

Every panel has the 4 states: `loading` prop on charts; empty: `EmptyState size="small"` with `VisualPreset context="chart" type="no-result"` "No incidents in this timeframe"; error:
`MessageContainer critical` inside the panel with the DQL error. All DQL is **UNVALIDATED** until run on a tenant. Charts must pass the R7 shape check with demo data in headless Chromium.
Layout: `Grid gridTemplateColumns="repeat(12, 1fr)" gap={16}`: row 1 = panel 1 (12); row 2 = panel 2 (8) + panel 6 (4); row 3 = panel 3 (12); row 4 = panel 4 (6) + panel 5 (6); row 5 = panel 7 (6) + panel 8 (6);
row 6 = panel 9 (12). Below the desktop breakpoint every panel spans 12.

---

## 13. Help — `/help`

Centered 960px column `[STD:foundations/layout]`. Left: in-page table of contents (`Link`s to anchors). Right: content rendered with `Markdown` (`[MCP]`, read-only, no `dangerouslySetInnerHTML`)
from a bundled `help.md`, plus live components where useful.

Sections (H2): **Get started** (a 4-step checklist using `Checkbox`-like read-only status rows: 1 Create a team · 2 Create a schedule · 3 Create an escalation policy · 4 Send a test event; each row
shows `SuccessIcon` when done, computed from app state, plus a `Link` to the screen) · **Concepts** (incident, priority, status, team, schedule, layer, override, escalation policy, routing rule;
technical terms get `TerminologyOverlay` `[MCP]`) · **Console workflow** (ack, resolve, snooze, reassign, bulk actions) · **Sending events (inbound)** (the same `CodeSnippet` constant as 10.1) ·
**Notifications (outbound)** (Workflows, providers, credential vault, test) · **Keyboard shortcuts** (`KeyboardShortcut keys="…"` `[MCP]`) · **Troubleshooting** (no incidents, notification failed,
workflow not installed, permissions) · **Privacy** (what personal data the app stores).

### Keyboard shortcuts (Console)

| Keys | Action |
| --- | --- |
| `j` / `k` | Next / previous row (moves the active row) |
| `Enter` | Open details |
| `Esc` | Close details |
| `a` | Acknowledge active incident |
| `r` | Resolve active incident |
| `x` | Select / deselect row |
| `/` | Focus search |
| `Shift+R` | Refresh now |

Shortcuts are off while focus is in an input, and are active only while focus is inside the Console table region. Settings → General has a `Switch` "Keyboard shortcuts" (default on) so single-key shortcuts can be turned off (WCAG 2.1.4 Character Key Shortcuts). They are shown in `Tooltip`s via `KeyboardShortcutTooltip` (`[DTS content/index.d.ts]`; props **UNVERIFIED**). Whether DataTable's own keyboard
model conflicts with `j`/`k` is **UNVERIFIED**. If it conflicts, drop `j`/`k` and keep the rest.

---

## 14. Shared app components (build once, in `ui/app/components/`)

| Component | Built from | Notes |
| --- | --- | --- |
| `ShellHeader` | `AppHeader`, `HelpMenu`, `Tooltip`, `Button`, `Menu` | 3.2/3.3 |
| `DemoModeBanner` | `MessageContainer variant="primary"` | 3.4 |
| `PageTitle` | `TitleBar` (+ `Breadcrumbs`) | 3.5 |
| `PriorityChip` | `Chip` (+ `Chip.Prefix` `CriticalIcon` for P1) | mapping table 1.2; `size` prop passthrough |
| `StatusIndicator` | `HealthIndicator` + `.Label` | mapping 1.2 |
| `DeliveryStatus` | `HealthIndicator` | Delivered/Sent/Failed/Skipped |
| `UserAvatar` | `Avatar` (+ `.Label`, `.Subtitle`), `Tooltip` | initials from IAM name; never shows email in tables |
| `UserPicker` | `Select multiple` + `Select.Filter disableFiltering` + `Select.Content loading` + `Select.EmptyState` | 6.5 |
| `AgeText` | `Text` + `Tooltip` + `ClockIcon` | SLA-aware color |
| `EscalationProgress` | `ProgressBar`, `ProgressCircle`, icons, `AvatarGroup` | compact (table cell) and full (detail) variants |
| `IncidentTimeline` | `Flex`, `Divider`, `Text`, icons, `HealthIndicator`, `Markdown` | 5.3 |
| `QueryState` | `Skeleton`/`ProgressCircle`, `EmptyState`, `MessageContainer` | one wrapper for the 4 states; takes `{ isLoading, error, isEmpty, empty: ReactNode }` |
| `ConfirmModal` | `Modal` + footer `Button`s | "Delete" / "Cancel", critical color only for destructive |
| `CopyCode` | `CodeSnippet` | shared snippet constants for Integrations + Help |
| `ChannelIcon` | strato-icons map | SMS→`MobileIcon`, Voice→`CallIcon`, WhatsApp/Slack/Teams/Telegram→`ChatIcon`, Email→`MailIcon`, Webhook/IFTTT→`HttpIcon` |

Bespoke styling is allowed only through tokens imported from `@dynatrace/strato-design-tokens/*` (e.g. the 24px step-number field in 8.2). Use the `style` prop with token values, never literals.

## 15. Demo data requirements (for headless rendering and the demo mode)

Fake but realistic and **non-identifying** (R1): people as "Alex Example", "Sam Sample", emails as `alex@example.invalid`, phone numbers as `+00 000 000 0000` (masked), no tenant URLs. <!-- scan-secrets:allow synthetic placeholders -->
Include: ~40 incidents across all P-levels and statuses (≥1 P1 triggered, ≥1 escalation exhausted, ≥1 failed SMS delivery, ≥1 snoozed); 4 teams, 12 users, 3 schedules (one with a gap in the
next 7 days, one with an active override); 3 escalation policies (one with repeat); 6 services with rules; 30 days of report data. All charts must render populated from this set.

## 16. UNVERIFIED register (the implementer must resolve or use the stated fallback)

| # | Item | Where | Fallback |
| --- | --- | --- | --- |
| U1 | `PageLayout.Details` rendered from inside a routed page (portal) | 3.1 | one `PageLayout` per route |
| U2 | `Menu.Trigger` wrapping `AppHeader.ActionButton` | 3.3 | ActionButton navigates to `/on-call` |
| U3 | `MessageContainer.Prefix` custom icon | 3.4 | omit Prefix (variant default icon) |
| U4 | `DataTable variant.rowSeparation` value name, `sortBy` item shape, `rowThresholds` shape, custom-cell column key | 4.4 | check `tables/index.d.ts` types |
| U5 | `SingleValue.ColorRule` props; `MultiMeterBarChart.Segment` props; `SingleValueGrid` accessor config | 4.2, 12 | use cases `ColorRules`, `ChangeSegmentColor` |
| U6 | `Surface` as an interactive button | 4.2 | `Button` with `variant="default" width="full"` containing the SingleValue |
| U7 | Problems app id / page token / intent payload for "Open in Problems"; Workflows app link; entity links | 5.2, 10.3, 5.3 | `ExternalLink` to environment URL |
| U8 | Gantt `xAxisType: 'time'` value unit (epoch ms assumed) | 6.1, 6.4 | render-test with demo data |
| U9 | (resolved) `DateTimePicker type="time" precision="minutes"` verified in d.ts | 6.4 | — |
| U10 | IAM user search level/scope for the app | 6.5 | demo list in demo mode |
| U11 | Event field names, Davis categories, Events API endpoint/scope/payload in snippets | 9, 10.1 | architect/integration engineer confirm vs docs |
| U12 | Credential vault listing API | 10.2 | "Credential ID" text field |
| U13 | client-automation methods and workflow action ids | 10.3 | integration engineer verifies |
| U14 | `CodeEditor` JSON language; `KeyboardShortcutTooltip` props; `useLockedRowOrder` usage | 9.2, 13 | `TextArea`; plain `Tooltip`; unlocked default row rendered separately below the table |
| U15 | `EmptyState.VisualPreset` CDN images under the app CSP | 1.6 | omit `.Visual` |
| U16 | `TimeseriesChart` custom color map for priority series; `HistogramSeries` shape | 12 | default palette; read `charts/histogram` types |
| U17 | `FormField` label API (`label` prop vs `<Label>` child) | 6.5 and all forms | follow `FormField` use case `SetLabel` `[MCP]` |
| U18 | All DQL | 4, 6, 12 | labelled UNVALIDATED until run on a tenant |

## 17. Verification appendix

- `list_strato_components` queries run: page, layout, appheader, navigation, table, datatable, chip, badge, tag, avatar, tabs, drawer, sheet, modal, form, select, switch, timeline,
  progress, chart, honeycomb, single value, meter, toast, empty, skeleton, surface, card, tooltip, menu, filter, gantt, stepper, indicator, code. Notable results: `Page` deprecated;
  no badge/tag/card/timeline/stepper/drawer component.
- `get_strato_component` read for: PageLayout, AppHeader, HelpMenu, DataTable, Chip, ChipGroup, Avatar, AvatarGroup, HealthIndicator, EmptyState, MessageContainer, Sheet, Modal, Tabs,
  FilterBar, TimeframeSelector, Select, Switch, ToggleButtonGroup, SingleValue, MeterBarChart, MultiMeterBarChart, Sparkline, TimeseriesChart, CategoricalBarChart, TopList, DonutChart,
  HoneycombChart, HistogramChart, AnnotationsChart, GaugeChart, CodeSnippet, Markdown, Toast, TitleBar, Surface, Container, ProgressBar, ProgressCircle, Skeleton, Menu, Tooltip, FormField,
  FieldSet, NumberInput, TextInput, TextArea, DateTimePicker, Accordion, Breadcrumbs, KeyboardShortcut, TerminologyOverlay, InformationOverlay, Checkbox, Button, Text, TextEllipsis, Heading,
  Grid, Flex, Divider, SimpleTable, ExternalLink, Link, AppLink, ExpandableText.
- Not in the MCP index but verified in `.d.ts`: `Combobox` (`forms/combobox/Combobox.d.ts`), `SingleValueGrid` (`charts/single-value-grid/SingleValueGrid.d.ts`), `SecretInput` (`forms/secret-input/SecretInput.d.ts`),
  `InlineButton` (`buttons/inline-button/InlineButton.d.ts`), `RadioGroup` (`forms/radio/RadioGroup.d.ts`), stepper (`navigation/stepper/*`), `AppHeader.Menus` (`layouts/app-header/Menus.d.ts`),
  `PageLayout.Details` props (`layouts/page-layout/details-region/slots.d.ts`), Gantt column (`tables/DataTable/features/GanttChart/*`, `charts/gantt-chart/types/gantt-chart.d.ts`),
  `ToastOptions` (`notifications/toast/Toast.d.ts`), `EmptyState` presets (`content/empty-state/types/*`), IAM user search (`@dynatrace-sdk/client-iam/types/index.d.ts`).
- Dev-standard rules honored: R1 (placeholders only, section 15), R2 (citations + U-register), R3 (Strato subpaths only), R6 (DQL marked UNVALIDATED), R7/R8 (section 12), R11 (app name "Command Center for Dynatrace" comes from `app.config.json` and the AppHeader shows it automatically). R4: developer.dynatrace.com pages were not fetched in this session. The dt-app-mcp docs and the installed `.d.ts` are the sources.
- Experience standards used: `AppHeader-Compliance-Checklist`, `HelpMenu-Compliance-Checklist`, `DataTable-Compliance-Checklist`, `foundations/navigation`, `foundations/layout`,
  `patterns/status-and-health`, `patterns/filtering`, `patterns/forms-validation`, `patterns/loading-saving`, `patterns/error-messages`, `patterns/common-actions`,
  `foundations/content-checklist`, `foundations/accessibility`, `foundations/interaction-states`, `foundations/data-visualization-basics`.
  Keywords that returned off-target content (no dedicated standard came back): "app layout", "dashboard", "color", "settings", "detail view", "empty state", "writing"
  (the content checklist), "notifications" (navigation). For those topics this spec relies on component usage docs instead.
- Tokens: every `Colors.*`, `Spacings.*`, `Borders.*`, `Breakpoints.*` path in this document exists in `@dynatrace/strato-design-tokens@1.8.1` (flattened from `*/index.d.ts`).
  Icons: every `*Icon` name exists in `@dynatrace/strato-icons@2.7.0/index.d.ts`.
