import React from "react";
import { Text } from "@dynatrace/strato-components/typography";
import type { ActionWidget } from "@dynatrace-sdk/automation-action-utils";

/**
 * Every setting is read from the Command Center app at run time. The only inputs are the two that the
 * "Engine on problem" workflow passes from its Problem trigger (problemId, problemStatus); they are shown, not edited.
 */
const RunEngineWidget: ActionWidget<{ problemId?: string; problemStatus?: string }> = (props) => (
  <Text>
    Runs one Command Center cycle: reads alerts, updates incidents and escalations, and sends notifications. Configure teams,
    schedules, policies and providers in the Command Center app; nothing needs to be set here.
    {props.value?.problemId ? " Started by a problem: the run first waits until that problem can be read. Keep the inputs as Command Center created them." : ""}
  </Text>
);

export default RunEngineWidget;
