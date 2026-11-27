import React from "react";
import { Text } from "@dynatrace/strato-components/typography";
import type { ActionWidget } from "@dynatrace-sdk/automation-action-utils";

/** The action takes no input: every setting is read from the Command Center app at run time. */
const RunEngineWidget: ActionWidget<Record<string, never>> = () => (
  <Text>
    Runs one Command Center cycle: reads alerts, updates incidents and escalations, and sends notifications. Configure teams,
    schedules, policies and providers in the Command Center app; nothing needs to be set here.
  </Text>
);

export default RunEngineWidget;
