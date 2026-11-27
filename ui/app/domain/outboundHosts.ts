/**
 * Outbound hosts of the built-in providers.
 *
 * App functions and workflow actions may only call hosts on the environment's allowlist (Settings → General →
 * Environment management → External requests; developer.dynatrace.com → "Allow external requests"). A custom app
 * cannot read or change that list without extra scopes, so Command Center tells the person which host each provider
 * needs, and turns the runtime's refusal into an explicit message (api/lib/senders.ts → safeError).
 */
import type { ProviderKind } from "./contracts";

/** Prefix of a ledger error caused by a host that is not on the allowlist. */
export const HOST_NOT_ALLOWED = "Host not allowed";

/** Where the allowlist lives, in the words of the Dynatrace UI. */
export const EXTERNAL_REQUESTS_PATH = "Settings → General → Environment management → External requests";

/**
 * The host each provider kind calls. `undefined`: the host is part of the secret URL in the Credential Vault
 * (Teams, generic webhook), or the provider calls no host itself (custom workflow).
 */
export const PROVIDER_HOST: Record<ProviderKind, string | undefined> = {
  twilio: "api.twilio.com",
  ifttt: "maker.ifttt.com",
  "slack-webhook": "hooks.slack.com",
  "telegram-bot": "api.telegram.org",
  "teams-webhook": undefined,
  webhook: undefined,
  workflow: undefined,
};

/** One sentence for the provider's configuration: which host to allow. */
export function hostToAllow(kind: ProviderKind): string | undefined {
  if (kind === "workflow") return undefined;
  const host = PROVIDER_HOST[kind];
  return host
    ? `Allow ${host} in ${EXTERNAL_REQUESTS_PATH}. Dynatrace refuses calls to hosts that are not on that list.`
    : `Allow the host of the URL stored in the vault entry (for example prod-00.westeurope.logic.azure.com) in ${EXTERNAL_REQUESTS_PATH}. Dynatrace refuses calls to hosts that are not on that list.`;
}

/** True for a ledger error written by safeError for a host that is not on the allowlist. */
export function isHostNotAllowed(error: string | undefined): boolean {
  return !!error && error.startsWith(HOST_NOT_ALLOWED);
}
