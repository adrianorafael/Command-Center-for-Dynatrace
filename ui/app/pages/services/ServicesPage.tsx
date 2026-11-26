import React from "react";
import { PageLayout, Flex } from "@dynatrace/strato-components/layouts";
import { PageTitle } from "../../components/PageTitle";

export const ServicesPage = () => (
  <PageLayout.Content>
    <Flex flexDirection="column" gap={16} padding={16}>
      <PageTitle title="ServicesPage" />
    </Flex>
  </PageLayout.Content>
);
