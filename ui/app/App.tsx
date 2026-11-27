import React from "react";
import { PageLayout } from "@dynatrace/strato-components/layouts";
import { ToastContainer } from "@dynatrace/strato-components/notifications";
import { ShellHeader } from "./components/ShellHeader";
import { TOAST_CLASS, ToastAnchor } from "./components/ToastPlacement";
import { DemoModeBanner } from "./components/Banners";
import { AppDataProvider } from "./hooks/AppDataContext";
import { AppRoutes } from "./routes";

/**
 * One app-level PageLayout. Routed pages render their own PageLayout.Content (and, where
 * needed, PageLayout.Details / PageLayout.Sidebar): the slots register through context, so
 * they work from any depth below <PageLayout> (layouts/page-layout/shared/slots).
 * AppRoot lives in main.tsx (exactly one).
 */
export const App = () => (
  <AppDataProvider>
    <ToastContainer className={TOAST_CLASS} />
    <PageLayout>
      <PageLayout.Header>
        <ToastAnchor>
          <ShellHeader />
        </ToastAnchor>
        <DemoModeBanner />
      </PageLayout.Header>
      <AppRoutes />
    </PageLayout>
  </AppDataProvider>
);
