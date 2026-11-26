import React from "react";
import { PageLayout, Flex } from "@dynatrace/strato-components/layouts";
import { PageTitle } from "../../components/PageTitle";

export const PoliciesPage = () => (
  <PageLayout.Content>
    <Flex flexDirection="column" gap={16} padding={16}>
      <PageTitle title="PoliciesPage" />
    </Flex>
  </PageLayout.Content>
);
