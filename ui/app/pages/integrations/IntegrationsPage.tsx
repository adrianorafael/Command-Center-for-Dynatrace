import React from "react";
import { PageLayout, Flex } from "@dynatrace/strato-components/layouts";
import { PageTitle } from "../../components/PageTitle";

export const IntegrationsPage = () => (
  <PageLayout.Content>
    <Flex flexDirection="column" gap={16} padding={16}>
      <PageTitle title="IntegrationsPage" />
    </Flex>
  </PageLayout.Content>
);
