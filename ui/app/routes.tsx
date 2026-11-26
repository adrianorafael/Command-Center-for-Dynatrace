import React, { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { PageLayout } from "@dynatrace/strato-components/layouts";
import { ProgressCircle } from "@dynatrace/strato-components/content";
import { Flex } from "@dynatrace/strato-components/layouts";
import { ConsolePage } from "./pages/console/ConsolePage";

const OnCallPage = lazy(() => import("./pages/oncall/OnCallPage").then((m) => ({ default: m.OnCallPage })));
const ScheduleEditorPage = lazy(() =>
  import("./pages/oncall/ScheduleEditorPage").then((m) => ({ default: m.ScheduleEditorPage })),
);
const TeamsPage = lazy(() => import("./pages/teams/TeamsPage").then((m) => ({ default: m.TeamsPage })));
const TeamDetailPage = lazy(() => import("./pages/teams/TeamDetailPage").then((m) => ({ default: m.TeamDetailPage })));
const PoliciesPage = lazy(() => import("./pages/escalations/PoliciesPage").then((m) => ({ default: m.PoliciesPage })));
const PolicyEditorPage = lazy(() =>
  import("./pages/escalations/PolicyEditorPage").then((m) => ({ default: m.PolicyEditorPage })),
);
const ServicesPage = lazy(() => import("./pages/services/ServicesPage").then((m) => ({ default: m.ServicesPage })));
const ServiceDetailPage = lazy(() =>
  import("./pages/services/ServiceDetailPage").then((m) => ({ default: m.ServiceDetailPage })),
);
const IntegrationsPage = lazy(() =>
  import("./pages/integrations/IntegrationsPage").then((m) => ({ default: m.IntegrationsPage })),
);
const SettingsPage = lazy(() => import("./pages/settings/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const ReportsPage = lazy(() => import("./pages/reports/ReportsPage").then((m) => ({ default: m.ReportsPage })));
const HelpPage = lazy(() => import("./pages/help/HelpPage").then((m) => ({ default: m.HelpPage })));

const Loading = () => (
  <PageLayout.Content>
    <Flex justifyContent="center" padding={32}>
      <ProgressCircle aria-label="Loading page" />
    </Flex>
  </PageLayout.Content>
);

/**
 * Canonical paths follow DESIGN §2; the spec §9 paths (/schedules, /policies, /routing)
 * redirect so bookmarks and scripts using either list work.
 */
export const AppRoutes = () => (
  <Suspense fallback={<Loading />}>
    <Routes>
      <Route path="/" element={<ConsolePage />} />
      <Route path="/incidents/:id" element={<ConsolePage />} />
      <Route path="/on-call" element={<OnCallPage />} />
      <Route path="/on-call/schedules/:id" element={<ScheduleEditorPage />} />
      <Route path="/schedules" element={<Navigate to="/on-call?tab=schedules" replace />} />
      <Route path="/schedules/:id" element={<ScheduleEditorPage />} />
      <Route path="/teams" element={<TeamsPage />} />
      <Route path="/teams/:id" element={<TeamDetailPage />} />
      <Route path="/escalations" element={<PoliciesPage />} />
      <Route path="/escalations/:id" element={<PolicyEditorPage />} />
      <Route path="/policies" element={<Navigate to="/escalations" replace />} />
      <Route path="/policies/:id" element={<PolicyEditorPage />} />
      <Route path="/services" element={<ServicesPage />} />
      <Route path="/services/:id" element={<ServiceDetailPage />} />
      <Route path="/routing" element={<Navigate to="/services?tab=rules" replace />} />
      <Route path="/integrations" element={<IntegrationsPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/reports" element={<ReportsPage />} />
      <Route path="/help" element={<HelpPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </Suspense>
);
