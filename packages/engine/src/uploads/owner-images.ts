import { err } from "@binference/core";
import type { OwnerImageSource } from "../chat/ports.js";

/** The prefix of an image the owner sent the bot (protocol spec, section 7.7). */
const botPrefix = "tg:";

/**
 * The owner's images by the names messages give them: `tg:<file_id>` from the bot, when there is
 * one, and every other name from the uploads. A bot photo with no bot is `unreadable`.
 */
export function ownerImagesOf(sources: {
  readonly bot?: OwnerImageSource;
  readonly uploads: OwnerImageSource;
}): OwnerImageSource {
  const { bot, uploads } = sources;
  return {
    async read(image, call) {
      if (!image.startsWith(botPrefix)) {
        return uploads.read(image, call);
      }
      call.signal.throwIfAborted();
      return bot === undefined ? err("unreadable") : bot.read(image, call);
    },
  };
}
