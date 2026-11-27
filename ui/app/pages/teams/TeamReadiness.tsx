import React, { useState } from "react";
import { Button } from "@dynatrace/strato-components/buttons";
import { Flex, Surface } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import { CircleIcon, SuccessIcon, WarningIcon } from "@dynatrace/strato-icons";
import Colors from "@dynatrace/strato-design-tokens/colors";

export { teamReadiness, deliveryIssues, type DeliveryIssue, type ReadinessFix, type ReadinessItem } from "./readiness";
import type { DeliveryIssue, ReadinessFix, ReadinessItem } from "./readiness";

/** "Ready to page?" checklist at the top of the team detail page. */
export const TeamReadiness = ({
  items,
  onFix,
  delivery = [],
  onOpen,
}: {
  items: ReadinessItem[];
  onFix: (key: ReadinessFix) => void;
  /** Blocking conditions outside the team (providers, engine). */
  delivery?: DeliveryIssue[];
  onOpen?: (to: string) => void;
}) => {
  const done = items.filter((i) => i.done).length;
  const ready = done === items.length;
  const next = items.findIndex((x) => !x.done);
  const [expanded, setExpanded] = useState(false);
  // Say "some" when other channels still work: the warning must not claim more than is true.
  const cantSend = delivery.some((d) => d.all) ? "messages can't go out yet" : "some messages can't be sent yet";
  const deliveryRows = delivery.map((d) => (
    <Flex key={d.to} alignItems="center" gap={12}>
      <Flex style={{ width: 20, flexShrink: 0 }} justifyContent="center">
        <WarningIcon style={{ color: Colors.Icon.Warning.Default }} aria-label="Needs attention" />
      </Flex>
      <Flex flexGrow={1} style={{ minWidth: 0 }}>
        <Text>{d.text}</Text>
      </Flex>
      <Button size="condensed" onClick={() => onOpen?.(d.to)}>
        {d.action}
      </Button>
    </Flex>
  ));
  return (
    ready && !expanded ? (
      <Surface padding={12}>
        <Flex flexDirection="column" gap={8}>
          <Flex alignItems="center" gap={8} justifyContent="space-between" flexWrap="wrap">
            <Flex alignItems="center" gap={12}>
              <Flex style={{ width: 20, flexShrink: 0 }} justifyContent="center">
                {delivery.length ? <WarningIcon style={{ color: Colors.Icon.Warning.Default }} /> : <SuccessIcon style={{ color: Colors.Icon.Success.Default }} />}
              </Flex>
              <Text>
                {delivery.length
                  ? `All ${items.length} team steps are done, but ${cantSend}.`
                  : `Ready to page: all ${items.length} setup steps are done.`}
              </Text>
            </Flex>
            <Button size="condensed" variant="default" onClick={() => setExpanded(true)}>
              Show steps
            </Button>
          </Flex>
          {deliveryRows}
        </Flex>
      </Surface>
    ) : (
    <Surface padding={16}>
      <Flex flexDirection="column" gap={12}>
        <Flex alignItems="center" gap={8} justifyContent="space-between" flexWrap="wrap">
          <Heading level={4}>Ready to page?</Heading>
          <Text textStyle="small">
            {done} of {items.length} steps done
          </Text>
        </Flex>
        {ready ? (
          <Flex alignItems="center" gap={8}>
            {delivery.length ? <WarningIcon style={{ color: Colors.Icon.Warning.Default }} /> : <SuccessIcon style={{ color: Colors.Icon.Success.Default }} />}
            <Text>{delivery.length ? `The team is set up, but ${cantSend}.` : "This team is ready to receive pages."}</Text>
          </Flex>
        ) : (
          <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued }}>
            Five steps, in order, until an alert reaches a person of this team.
          </Text>
        )}
        <Flex flexDirection="column" gap={8}>
          {items.map((it, i) => (
            <Flex key={it.key} alignItems="center" gap={12}>
              <Flex style={{ width: 20, flexShrink: 0 }} justifyContent="center">
                {it.done ? (
                  <SuccessIcon style={{ color: Colors.Icon.Success.Default }} aria-label="Done" />
                ) : i === next ? (
                  <WarningIcon style={{ color: Colors.Icon.Warning.Default }} aria-label="Next step" />
                ) : (
                  <CircleIcon style={{ color: Colors.Icon.Neutral.Subdued }} aria-label="To do" />
                )}
              </Flex>
              <Flex flexDirection="column" gap={0} flexGrow={1} style={{ minWidth: 0 }}>
                <Text textStyle="base-emphasized">
                  {i + 1}. {it.title}
                </Text>
                <Text textStyle="small" style={{ color: it.done ? Colors.Text.Neutral.Subdued : Colors.Text.Neutral.Default }}>
                  {it.detail}
                </Text>
              </Flex>
              {!it.done &&
                !it.blocked &&
                (i === next ? (
                  <Button size="condensed" color="primary" variant="accent" onClick={() => onFix(it.key)}>
                    {it.fixLabel}
                  </Button>
                ) : (
                  <Button size="condensed" onClick={() => onFix(it.key)}>
                    {it.fixLabel}
                  </Button>
                ))}
            </Flex>
          ))}
          {deliveryRows}
        </Flex>
      </Flex>
    </Surface>
    )
  );
};
