/** Hook with the incident commands every Console control shares, so they behave the same everywhere. */
import { useCallback } from "react";
import { showToast } from "@dynatrace/strato-components/notifications";
import { useAppData } from "../../hooks/AppDataContext";
import { runEngineNow } from "../../hooks/domain";
import { errorMessage } from "../../components/format";

/** Incident commands shared by row actions, bulk actions, the details panel and shortcuts. */
export function useIncidentCommands() {
  const { act, demo, data } = useAppData();

  const ack = useCallback((ids: string[]) => act(ids, { type: "ack" }).then(() => undefined, () => undefined), [act]);
  const resolve = useCallback((ids: string[]) => act(ids, { type: "resolve" }).then(() => undefined, () => undefined), [act]);
  const reopen = useCallback((ids: string[]) => act(ids, { type: "reopen" }).then(() => undefined, () => undefined), [act]);
  const snoozeFor = useCallback(
    (ids: string[], ms: number) => act(ids, { type: "snooze", until: Date.now() + ms }).then(() => undefined, () => undefined),
    [act],
  );
  /** Escalate now = append the action, then run one engine cycle (engine-run) so the next step goes out at once. */
  const escalate = useCallback(
    async (ids: string[]) => {
      try {
        await act(ids, { type: "escalate" });
      } catch {
        return;
      }
      if (demo) {
        showToast({ type: "info", title: "Demo mode: the engine doesn't run", message: "In a real environment the next escalation step is sent right away.", lifespan: 6000 });
        return;
      }
      try {
        if (data) await runEngineNow(data.settings, "manual");
      } catch (e) {
        showToast({
          type: "warning",
          title: "Escalation recorded, but the engine didn't start",
          message: `${errorMessage(e)} The next scheduled engine run sends it.`,
          lifespan: 8000,
        });
      }
    },
    [act, demo, data],
  );
  return { ack, resolve, reopen, snoozeFor, escalate };
}

export const SNOOZE_PRESETS: { label: string; ms: number }[] = [
  { label: "15 min", ms: 15 * 60_000 },
  { label: "30 min", ms: 30 * 60_000 },
  { label: "1 h", ms: 60 * 60_000 },
  { label: "4 h", ms: 4 * 60 * 60_000 },
];
