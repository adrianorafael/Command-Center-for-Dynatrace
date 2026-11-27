/** Accessible icon-only button used in tables and toolbars. */
import React from "react";
import { Button } from "@dynatrace/strato-components/buttons";
import { Tooltip } from "@dynatrace/strato-components/overlays";

/** Icon-only button: always aria-label + Tooltip with the same text (DESIGN §1.5). */
export const IconButton = ({
  label,
  icon,
  onClick,
  disabled,
  disabledReason,
  size = "default",
}: {
  label: string;
  icon: React.ReactElement;
  onClick?: () => void;
  disabled?: boolean;
  disabledReason?: string;
  size?: "default" | "condensed";
}) => (
  <Tooltip text={disabled && disabledReason ? disabledReason : label}>
    <Button aria-label={label} size={size} disabled={disabled} onClick={onClick}>
      <Button.Prefix>{icon}</Button.Prefix>
    </Button>
  </Tooltip>
);
