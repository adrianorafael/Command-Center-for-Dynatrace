import { stateClient } from "@dynatrace-sdk/client-state";
import { useState, useEffect, useCallback } from "react";

const ACK_STATE_KEY = "problem-ack-states";

export interface PersistedHistoryEvent {
  type: string;
  timestamp: string;
  by: string;
}

type AckMap = Record<string, {
  action: "ACKNOWLEDGED" | "OPEN";
  assignedTo: string;
  history: PersistedHistoryEvent[];
}>;

export interface AckState {
  problemId: string;
  action: "ACKNOWLEDGED" | "OPEN";
  assignedTo: string;
  history: PersistedHistoryEvent[];
}

export interface UseAckEventsResult {
  ackStates: AckState[];
  isLoading: boolean;
  ingestAck: (
    problemId: string,
    action: "ACKNOWLEDGED" | "OPEN",
    assignedTo: string,
    history: PersistedHistoryEvent[]
  ) => Promise<void>;
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as Record<string, unknown>;
  // The App State SDK throws HTTP 404 when the key has never been written (fresh environment).
  // Treat this as "no acks yet" rather than a real error.
  return e["name"] === "NotFound" || (typeof e["message"] === "string" && e["message"].includes("404"));
}

async function loadAckMap(): Promise<AckMap> {
  try {
    const state = await stateClient.getAppState({ key: ACK_STATE_KEY });
    return JSON.parse(state.value || "{}");
  } catch (error) {
    if (isNotFound(error)) {
      // Key doesn't exist yet — this is normal on first run or a fresh environment.
      return {};
    }
    console.error("[useAckEvents] Failed to load ack states:", error);
    return {};
  }
}

export function useAckEvents(): UseAckEventsResult {
  const [ackStates, setAckStates] = useState<AckState[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadAckMap().then((map) => {
      setAckStates(
        Object.entries(map).map(([problemId, v]) => ({
          problemId,
          action: v.action,
          assignedTo: v.assignedTo,
          history: v.history ?? [],
        }))
      );
    }).finally(() => setIsLoading(false));
  }, []);

  const ingestAck = useCallback(async (
    problemId: string,
    action: "ACKNOWLEDGED" | "OPEN",
    assignedTo: string,
    history: PersistedHistoryEvent[]
  ): Promise<void> => {
    try {
      const currentMap = await loadAckMap();
      currentMap[problemId] = { action, assignedTo, history };
      await stateClient.setAppState({
        key: ACK_STATE_KEY,
        body: { value: JSON.stringify(currentMap) },
      });
    } catch (error) {
      // Persistence failure is non-fatal: the local UI state was already updated optimistically.
      // Log the error so it's visible in dev tools without disrupting the user session.
      console.error("[useAckEvents] Failed to persist ack state:", error);
    }
  }, []);

  return { ackStates, isLoading, ingestAck };
}
