import React from "react";
import { FormFieldMessages } from "@dynatrace/strato-components/forms";

/** Hint text under a form control (Hint is deprecated in favor of FormFieldMessages). */
export const FieldHint = ({ children }: { children: React.ReactNode }) => (
  <FormFieldMessages>
    <FormFieldMessages.Item variant="hint">{children}</FormFieldMessages.Item>
  </FormFieldMessages>
);

export const FieldError = ({ children }: { children: React.ReactNode }) => (
  <FormFieldMessages>
    <FormFieldMessages.Item variant="error">{children}</FormFieldMessages.Item>
  </FormFieldMessages>
);
