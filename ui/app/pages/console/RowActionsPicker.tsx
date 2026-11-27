/** Gear above the incident table: lets the viewer pick which row actions show as buttons (the rest stay in "⋯"). */
import React, { useState } from "react";
import { Button } from "@dynatrace/strato-components/buttons";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Modal } from "@dynatrace/strato-components/overlays";
import { Checkbox } from "@dynatrace/strato-components/forms";
import { Paragraph, Text } from "@dynatrace/strato-components/typography";
import { ArrowDownIcon, ArrowUpIcon, SettingIcon } from "@dynatrace/strato-icons";
import Colors from "@dynatrace/strato-design-tokens/colors";
import { IconButton } from "../../components/IconButton";
import {
  DEFAULT_INLINE_ACTIONS,
  MAX_INLINE_ACTIONS,
  menuActions,
  moveInlineAction,
  ROW_ACTION_LABEL,
  sameInlineActions,
  toggleInlineAction,
  type RowActionId,
} from "./rowActions";

/**
 * Edits a draft and saves on "Save", so trying an order doesn't reflow every row while the dialog is open.
 * `onOpenChange` lets the page pause its single-key shortcuts while the dialog is up.
 */
export const RowActionsPicker = ({
  value,
  onChange,
  onOpenChange,
}: {
  value: readonly RowActionId[];
  onChange: (next: RowActionId[]) => void;
  onOpenChange?: (open: boolean) => void;
}) => {
  const [draft, setDraft] = useState<RowActionId[] | null>(null);
  const open = (v: RowActionId[] | null) => {
    setDraft(v);
    onOpenChange?.(v !== null);
  };
  const full = (draft?.length ?? 0) >= MAX_INLINE_ACTIONS;
  return (
    <>
      <IconButton label="Row actions" icon={<SettingIcon />} onClick={() => open([...value])} />
      {draft && (
        <Modal
          title="Row actions"
          show
          size="small"
          onDismiss={() => open(null)}
          footer={
            <Flex justifyContent="space-between" gap={8}>
              <Button disabled={sameInlineActions(draft, DEFAULT_INLINE_ACTIONS)} onClick={() => setDraft([...DEFAULT_INLINE_ACTIONS])}>
                Reset to default
              </Button>
              <Flex gap={8}>
                <Button onClick={() => open(null)}>Cancel</Button>
                <Button
                  color="primary"
                  variant="accent"
                  disabled={sameInlineActions(draft, value)}
                  onClick={() => {
                    onChange(draft);
                    open(null);
                  }}
                >
                  Save
                </Button>
              </Flex>
            </Flex>
          }
        >
          <Flex flexDirection="column" gap={12}>
            <Paragraph>
              Pick up to {MAX_INLINE_ACTIONS} actions to show as buttons on every row, in this order. The others stay in the ⋯ menu.
              Saved for you in this browser.
            </Paragraph>
            <Text textStyle="small-emphasized">
              On each row ({draft.length} of {MAX_INLINE_ACTIONS})
            </Text>
            {draft.length === 0 && (
              <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued }}>
                None: every action is in the ⋯ menu.
              </Text>
            )}
            {draft.map((id, i) => (
              <Flex key={id} alignItems="center" gap={8}>
                <Checkbox value onChange={() => setDraft(toggleInlineAction(draft, id))}>
                  {ROW_ACTION_LABEL[id]}
                </Checkbox>
                <Flex gap={4} style={{ marginLeft: "auto" }}>
                  <IconButton
                    label={`Move ${ROW_ACTION_LABEL[id]} up`}
                    icon={<ArrowUpIcon />}
                    size="condensed"
                    disabled={i === 0}
                    onClick={() => setDraft(moveInlineAction(draft, id, -1))}
                  />
                  <IconButton
                    label={`Move ${ROW_ACTION_LABEL[id]} down`}
                    icon={<ArrowDownIcon />}
                    size="condensed"
                    disabled={i === draft.length - 1}
                    onClick={() => setDraft(moveInlineAction(draft, id, 1))}
                  />
                </Flex>
              </Flex>
            ))}
            <Text textStyle="small-emphasized">In the ⋯ menu</Text>
            {full && (
              <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued }}>
                {MAX_INLINE_ACTIONS} is the maximum: clear one above to pick another.
              </Text>
            )}
            {menuActions(draft).map((id) => (
              <Checkbox key={id} value={false} disabled={full} onChange={() => setDraft(toggleInlineAction(draft, id))}>
                {ROW_ACTION_LABEL[id]}
              </Checkbox>
            ))}
            {draft.includes("davis") && (
              <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued }}>
                Open Davis problem is disabled on rows that didn&apos;t come from a Davis problem.
              </Text>
            )}
          </Flex>
        </Modal>
      )}
    </>
  );
};
