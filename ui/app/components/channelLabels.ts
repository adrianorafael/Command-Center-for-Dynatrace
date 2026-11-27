import type { Channel } from "../domain/contracts";

/** Display names of the notification channels (pure: usable outside React). */
export const CHANNEL_LABEL: Record<Channel, string> = {
  sms: "SMS",
  voice: "Voice",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  slack: "Slack",
  teams: "Microsoft Teams",
  ifttt: "IFTTT",
  webhook: "Webhook",
};
