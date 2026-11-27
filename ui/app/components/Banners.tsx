import React from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@dynatrace/strato-components/buttons";
import { MessageContainer } from "@dynatrace/strato-components/content";
import { Flex } from "@dynatrace/strato-components/layouts";
import { useAppData } from "../hooks/AppDataContext";
import { formatRelative } from "./format";

/** Not dismissible while demo mode is on: the user must always know the data is fake (DESIGN §3.4). */
export const DemoModeBanner = () => {
  const { demo } = useAppData();
  const navigate = useNavigate();
  if (!demo) return null;
  return (
    <Flex paddingX={16} paddingTop={8}>
      <MessageContainer variant="primary" style={{ width: "100%" }}>
        <MessageContainer.Description>
          Demo mode: everything on screen is sample data and actions don't send notifications. Real paging keeps running in the background.
        </MessageContainer.Description>
        <MessageContainer.Actions>
          <Button onClick={() => navigate("/settings#general")}>Turn off demo mode</Button>
        </MessageContainer.Actions>
      </MessageContainer>
    </Flex>
  );
};

const STALE_MS = 3 * 60_000;

/** Spec §8: warn when the paging engine heartbeat is older than 3 minutes. */
export const EngineHealthBanner = () => {
  const { data, demo, now } = useAppData();
  const navigate = useNavigate();
  if (!data || demo || !data.settings.engine.enabled) return null;
  const hb = data.heartbeat;
  if (hb && now - hb.lastTickAt < STALE_MS && !hb.lastError) return null;
  return (
    <MessageContainer variant={hb?.lastError ? "critical" : "warning"}>
      <MessageContainer.Title>
        {hb ? (hb.lastError ? "The paging engine reported an error" : "The paging engine is stale") : "The paging engine hasn't run yet"}
      </MessageContainer.Title>
      <MessageContainer.Description>
        {hb
          ? `Last run ${formatRelative(hb.lastTickAt, now)}.${hb.lastError ? ` ${hb.lastError}` : ""} Escalations and notifications may be delayed. Check the engine workflow.`
          : "No heartbeat was found. Install the notification workflow so that escalations are sent."}
      </MessageContainer.Description>
      <MessageContainer.Actions>
        <Button onClick={() => navigate("/integrations?tab=workflows")}>Open workflows</Button>
      </MessageContainer.Actions>
    </MessageContainer>
  );
};
