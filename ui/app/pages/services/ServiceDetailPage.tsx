import React from "react";
import { PageLayout, Flex } from "@dynatrace/strato-components/layouts";
import { PageTitle } from "../../components/PageTitle";

export const ServiceDetailPage = () => (
  <PageLayout.Content>
    <Flex flexDirection="column" gap={16} padding={16}>
      <PageTitle title="ServiceDetailPage" />
    </Flex>
  </PageLayout.Content>
);
