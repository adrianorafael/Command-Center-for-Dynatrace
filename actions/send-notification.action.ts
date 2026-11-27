/**
 * Custom workflow action "Send Command Center notification".
 *
 * The single task of a per-integration simple workflow ("Command Center · Slack", …). That workflow is opt-in: by
 * default the engine sends directly (api/lib/senders.ts), and only a provider whose params.workflowId links such a
 * workflow is handed to it. The engine then runs it once per notification (one more billed function call each),
 * with the notification as run params; the task input passes them on:
 *   { "providerId": "slack", "notification": "{{ execution().params.notification }}" }
 * The action reads the provider from the app's settings (App State), its secret from the Credential Vault, sends,
 * and records the result in the notification ledger. A failed delivery fails the task, so it is visible in the
 * Workflows app.
 */
import type { NotificationRequest } from "../ui/app/domain/contracts";
import { AppStateRepository } from "../ui/app/data/appStateRepository";
import { createStore } from "../ui/app/data/store";
import { providerViews } from "../api/lib/engine";
import { runDeliveryReport } from "../api/lib/delivery";
import { deliverDirect, vaultReader } from "../api/lib/senders";

interface SendNotificationInput {
  providerId?: string;
  /** The notification object, or its JSON text (depends on how the expression was rendered). */
  notification?: unknown;
}

function parseNotification(v: unknown): NotificationRequest {
  const n = (typeof v === "string" ? JSON.parse(v) : v) as Partial<NotificationRequest> | null;
  if (!n || typeof n !== "object" || typeof n.key !== "string" || typeof n.channel !== "string" || !n.to || typeof n.to.address !== "string") {
    throw new Error("Input 'notification' must be the Command Center notification (key, channel, to.address…)");
  }
  return n as NotificationRequest;
}

export default async (payload: SendNotificationInput) => {
  if (!payload?.providerId) throw new Error("Input 'providerId' is missing.");
  const n = parseNotification(payload.notification);
  const repo = new AppStateRepository();
  const settings = await createStore(repo).getSettings();
  const provider = providerViews(settings).find((p) => p.id === payload.providerId);
  if (!provider) throw new Error(`Provider ${payload.providerId} is not configured in Command Center.`);
  if (provider.channel !== n.channel) throw new Error(`Provider ${provider.id} serves ${provider.channel}, not ${n.channel}.`);
  const result = await deliverDirect({ ...n, providerId: provider.id }, provider, { fetch, readCredential: vaultReader(fetch) });
  // Test notifications are not in the ledger.
  if (!n.key.startsWith("test.")) await runDeliveryReport({ results: [result] }, { repo });
  if (result.status === "failed") throw new Error(`Not sent: ${result.error ?? "the provider refused the message"}`);
  return { status: result.status, providerRef: result.providerRef ?? null, key: n.key };
};
