/** Shared page header (breadcrumbs, title, subtitle, primary action) used by every page. */
import React from "react";
import { Link as RouterLink } from "react-router-dom";
import { Flex, TitleBar } from "@dynatrace/strato-components/layouts";
import { Breadcrumbs } from "@dynatrace/strato-components/navigation";

/** One breadcrumb; without `to` it is the current page. */
export interface Crumb {
  label: string;
  to?: string;
}

/** Page header pattern (DESIGN §3.5): breadcrumbs, title, subtitle, one primary action. */
export const PageTitle = ({
  title,
  subtitle,
  action,
  suffix,
  crumbs,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  suffix?: React.ReactNode;
  crumbs?: Crumb[];
}) => (
  <TitleBar>
    {crumbs && crumbs.length > 0 && (
      <TitleBar.Navigation>
        <Breadcrumbs>
          {crumbs.map((c) =>
            c.to ? (
              <Breadcrumbs.Item key={c.label} as={RouterLink} to={c.to}>
                {c.label}
              </Breadcrumbs.Item>
            ) : (
              <Breadcrumbs.Item key={c.label}>{c.label}</Breadcrumbs.Item>
            ),
          )}
        </Breadcrumbs>
      </TitleBar.Navigation>
    )}
    <TitleBar.Title>{title}</TitleBar.Title>
    {subtitle && <TitleBar.Subtitle>{subtitle}</TitleBar.Subtitle>}
    {(suffix || action) && (
      <TitleBar.Suffix>
        {/* TitleBar.Action truncates longer button labels ("New te…"), so the primary action sits in the suffix. */}
        <Flex alignItems="center" gap={8}>
          {suffix}
          {action}
        </Flex>
      </TitleBar.Suffix>
    )}
  </TitleBar>
);
