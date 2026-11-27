/** Shared confirmation dialog for deletes and other irreversible actions. */
import React, { useState } from "react";
import { Button } from "@dynatrace/strato-components/buttons";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Paragraph } from "@dynatrace/strato-components/typography";
import { Modal } from "@dynatrace/strato-components/overlays";

/** Confirmation modal. Destructive actions use the critical accent button (DESIGN §5.4). */
export const ConfirmModal = ({
  show,
  title,
  children,
  confirmLabel = "Delete",
  destructive = true,
  onConfirm,
  onDismiss,
}: {
  show: boolean;
  title: string;
  children: React.ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => Promise<void> | void;
  onDismiss: () => void;
}) => {
  const [busy, setBusy] = useState(false);
  const confirm = () => {
    setBusy(true);
    Promise.resolve(onConfirm())
      .catch(() => undefined)
      .finally(() => {
        setBusy(false);
        onDismiss();
      });
  };
  return (
    <Modal
      title={title}
      show={show}
      onDismiss={onDismiss}
      size="small"
      footer={
        <Flex justifyContent="flex-end" gap={8}>
          <Button onClick={onDismiss}>Cancel</Button>
          <Button
            color={destructive ? "critical" : "primary"}
            variant="accent"
            loading={busy}
            onClick={confirm}
          >
            {confirmLabel}
          </Button>
        </Flex>
      }
    >
      {typeof children === "string" ? <Paragraph>{children}</Paragraph> : children}
    </Modal>
  );
};
