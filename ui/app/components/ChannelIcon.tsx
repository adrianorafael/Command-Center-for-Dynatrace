/** Icon per notification channel, shared by every screen that lists channels. */
import React from "react";
import { CallIcon, ChatIcon, HttpIcon, MobileIcon } from "@dynatrace/strato-icons";
import type { Channel } from "../domain/contracts";

export { CHANNEL_LABEL } from "./channelLabels";

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
