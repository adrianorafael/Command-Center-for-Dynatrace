import React from "react";
import { CallIcon, ChatIcon, HttpIcon, MobileIcon, type SvgIconProps } from "@dynatrace/strato-icons";
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
export const ChannelIcon = ({ channel, size }: { channel: Channel; size?: SvgIconProps["size"] }) => {
  switch (channel) {
    case "sms":
      return <MobileIcon size={size} />;
    case "voice":
      return <CallIcon size={size} />;
    case "whatsapp":
    case "telegram":
    case "slack":
    case "teams":
      return <ChatIcon size={size} />;
    default:
      return <HttpIcon size={size} />;
  }
};
