import React from "react";
import { Text } from "@dynatrace/strato-components/typography";
import type { ActionWidget } from "@dynatrace-sdk/automation-action-utils";

/**
 * Inputs are prefilled by Command Center when it creates the integration's workflow:
 * providerId (which Command Center provider sends) and notification ({{ execution().params.notification }}).
 */
const SendNotificationWidget: ActionWidget<{ providerId?: string; notification?: string }> = (props) => (
  <Text>
    Sends one Command Center notification through the provider “{props.value?.providerId ?? "?"}”, using the provider settings and Credential Vault
    entry configured in the Command Center app, and records the result. Keep the inputs as Command Center created them.
  </Text>
);

export default SendNotificationWidget;
