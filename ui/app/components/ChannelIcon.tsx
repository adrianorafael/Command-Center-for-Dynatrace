import React from "react";
import { CallIcon, ChatIcon, HttpIcon, MobileIcon } from "@dynatrace/strato-icons";
import type { Channel } from "../domain/contracts";

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

/** SMS → Mobile, Voice → Call, chat apps → Chat, webhooks → Http (DESIGN §14). */
export const ChannelIcon = ({ channel }: { channel: Channel }) => {
  switch (channel) {
    case "sms":
      return <MobileIcon />;
    case "voice":
      return <CallIcon />;
    case "whatsapp":
    case "telegram":
    case "slack":
    case "teams":
      return <ChatIcon />;
    default:
      return <HttpIcon />;
  }
};
