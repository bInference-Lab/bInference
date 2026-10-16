import { err, ok } from "@binference/core";
import { imagePartBytes, type ImagePart, type ProtocolErrorCode } from "@binference/protocol";
import type { EngineHandler } from "../operations/engine-call.js";
import type { AgentInboxMessage } from "./agent-inbox-record.js";
import type { HeldImage, HoldRefusal, ImageHold } from "./image-hold.js";
import { ownerMessagePayloadSchema } from "./inbox-payload.schema.js";
import type { AgentInboxStore } from "./ports.js";
import type { RunningTurns } from "./running-turns.js";

/** The operation the agent runtime reads the owner's images with (protocol spec, section 7.7). */
export interface ImageHandlers {
  readonly "inbox/readImage": EngineHandler<"inbox/readImage">;
}

/** What the image handler reads through. */
export interface ImageHandlerOptions {
  readonly agentInbox: Pick<AgentInboxStore, "get">;
  /** The token of the runtime's current start, the one caller the handler answers. */
  readonly turns: Pick<RunningTurns, "isRuntime">;
  /** The owner's images, held while the runtime reads them; none without a source. */
  readonly hold?: ImageHold;
}

const refusalCodes: Readonly<Record<HoldRefusal, ProtocolErrorCode>> = {
  too_large: "image.too_large",
  unreadable: "image.unreadable",
  format: "image.format",
};

// The image belongs to the agent's own message: the stored `inbox/message` names it.
function names(
  stored: AgentInboxMessage | undefined,
  agent: string,
  image: string,
): stored is AgentInboxMessage {
  if (stored?.kind !== "inbox/message" || stored.agentId !== agent) {
    return false;
  }
  const payload = ownerMessagePayloadSchema.safeParse(stored.payload);
  return payload.success && payload.data.images?.includes(image) === true;
}

// The part of the image from `offset`: at most 512 KiB, in base64, with where the next one starts.
function partOf(image: HeldImage, offset: number): ImagePart {
  const end = Math.min(image.bytes.byteLength, offset + imagePartBytes);
  const data = Buffer.from(image.bytes.subarray(offset, end)).toString("base64");
  const { contentType } = image;
  const bytes = image.bytes.byteLength;
  return { contentType, bytes, offset, data, ...(end < bytes ? { next: end } : {}) };
}

/**
 * Creates the handler of `inbox/readImage` (decision 0227): only the runtime the engine runs now
 * reads, only an image its agent's own stored message names (else `image.not_found`), part by
 * part from the hold. The hold reads the image once; the last part lets it go. An offset past the
 * image is `protocol.bad_args`.
 */
export function createImageHandlers(options: ImageHandlerOptions): ImageHandlers {
  const { agentInbox, turns, hold } = options;
  return {
    async "inbox/readImage"(call) {
      if (!turns.isRuntime(call.caller.credential)) {
        return err("auth.scope");
      }
      const { agent, message, image, offset = 0 } = call.args;
      const stored = await agentInbox.get(message, call);
      if (!names(stored, agent, image)) {
        return err("image.not_found");
      }
      if (hold === undefined) {
        return err("image.unreadable");
      }
      const key = `${message} ${image}`;
      const read = await hold.read(key, image, call);
      if (!read.ok) {
        return err(refusalCodes[read.error]);
      }
      if (offset >= read.value.bytes.byteLength) {
        return err("protocol.bad_args");
      }
      const part = partOf(read.value, offset);
      if (part.next === undefined) {
        hold.drop(key);
      }
      return ok(part);
    },
  };
}
