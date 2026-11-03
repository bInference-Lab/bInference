import { err, ok } from "@binference/core";
import { imagePartOf } from "../chat/image-part.js";
import type { EngineHandler } from "../operations/engine-call.js";
import type { LaunchDraftDesk } from "./launch-draft-desk.js";

/** The reads of the agent's open launch draft (decision 0345). */
export interface OpenDraftHandlers {
  readonly "launch/openDraft": EngineHandler<"launch/openDraft">;
  readonly "launch/draftPicture": EngineHandler<"launch/draftPicture">;
}

/**
 * Creates the reads of the agent's open launch draft for a surface without Start (decision 0345):
 * `launch/openDraft` answers the draft's lines as Telegram's message shows them, and the size of
 * its photo, or no draft once it ended or its time is up; `launch/draftPicture` answers its photo
 * part by part as `inbox/readImage` does. A draft no longer open, another id, or a draft with no
 * photo is `image.not_found`, and an offset past the photo `protocol.bad_args`.
 */
export function createOpenDraftHandlers(desk: Pick<LaunchDraftDesk, "open">): OpenDraftHandlers {
  return {
    async "launch/openDraft"(call) {
      call.signal.throwIfAborted();
      const open = desk.open(call.args.agent);
      if (open === undefined) {
        return await Promise.resolve(ok({}));
      }
      const { lines, assets, expiresAtMs } = open.showing;
      const picture =
        open.picture === undefined ? {} : { picture: { bytes: open.picture.bytes.byteLength } };
      return ok({ draft: { draft: open.id, expiresAt: expiresAtMs, lines, assets, ...picture } });
    },
    async "launch/draftPicture"(call) {
      call.signal.throwIfAborted();
      const { agent, draft, offset = 0 } = call.args;
      const open = desk.open(agent);
      const picture = open?.id === draft ? open.picture : undefined;
      if (picture === undefined) {
        return await Promise.resolve(err("image.not_found"));
      }
      if (offset >= picture.bytes.byteLength) {
        return err("protocol.bad_args");
      }
      return ok(imagePartOf(picture, offset));
    },
  };
}
