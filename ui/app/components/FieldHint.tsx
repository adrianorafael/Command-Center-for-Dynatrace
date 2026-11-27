import React from "react";
import { FormFieldMessages } from "@dynatrace/strato-components/forms";
import { Text } from "@dynatrace/strato-components/typography";
import Colors from "@dynatrace/strato-design-tokens/colors";

/** Hint text under a form control (Hint is deprecated in favor of FormFieldMessages). */
export const FieldHint = ({ children }: { children: React.ReactNode }) => (
  <FormFieldMessages>
    <FormFieldMessages.Item variant="hint">{children}</FormFieldMessages.Item>
  </FormFieldMessages>
);

/**
 * Always-visible error under a control. FormFieldMessages' "error" items only show after the field was
 * touched/blurred (Strato's reveal gate), so errors of untouched fields stayed invisible on submit.
 */
export const FieldError = ({ children }: { children: React.ReactNode }) => (
  <Text role="alert" textStyle="small" style={{ color: Colors.Text.Critical.Default }}>
    {children}
  </Text>
);
