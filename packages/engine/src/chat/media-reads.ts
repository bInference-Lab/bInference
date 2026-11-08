import { err, type Id, ok, type Result } from "@binference/core";
import { mediaPartBytes, type MediaView, type ProtocolErrorCode } from "@binference/protocol";
import type { MachineFiles } from "../files/ports.js";
import type { EngineHandler } from "../operations/engine-call.js";
import type { LocalVoice } from "../speech/ports.js";
import type { ChatRelayOptions } from "./chat-relay-parts.js";
import { keepBounded } from "./keep-bounded.js";

/** What the made media are saved, read and told through. */
export type MediaOptions = Pick<
  ChatRelayOptions,
  "agentInbox" | "turns" | "ids" | "clock" | "publish" | "intentView" | "random"
> & {
  /** The agent's files, where made media are saved; without them every store is refused. */
  readonly madeImageFiles?: Pick<MachineFiles, "read" | "write">;
  /** The machine's own voice (decision 0405); without it `speech/local` is refused. */
  readonly localVoice?: LocalVoice;
};

/** A medium the engine saved, by its id. */
interface SavedMedia {
  readonly agent: Id<"agt">;
  readonly view: MediaView;
}

/** A saved medium's bytes, held while a surface reads it in parts. */
interface HeldBytes {
  readonly bytes: Uint8Array;
  readonly untilMs: number;
}

/** The saved media by their ids, and the handler that reads them. */
export interface MediaState {
  readonly saved: Map<string, SavedMedia>;
}

// How many media are held in memory at once, and for how long.
const mostHeld = 2;
const heldMs = 120_000;

// The saved medium's bytes: held from an earlier part, or read again where it was saved.
async function bytesOf(
  context: {
    readonly options: MediaOptions;
    readonly held: Map<string, HeldBytes>;
  },
  view: MediaView,
  signal: AbortSignal,
): Promise<Result<Uint8Array, ProtocolErrorCode>> {
  const { options, held } = context;
  const nowMs = options.clock.now();
  const kept = held.get(view.media);
  if (kept !== undefined && kept.untilMs > nowMs) {
    return ok(kept.bytes);
  }
  const workspace = { signal, workspaceOnly: true, maxBytes: view.bytes };
  const read = await options.madeImageFiles?.read(view.path, workspace);
  if (read?.ok !== true) {
    return err("media.not_found");
  }
  keepBounded(held, [view.media, { bytes: read.value.bytes, untilMs: nowMs + heldMs }], mostHeld);
  return ok(read.value.bytes);
}

/**
 * The saved media's state and `media/read`, which answers a saved medium's parts by its id, read
 * again where it was saved and held in memory for 2 minutes while its parts are read, at most two
 * media at once.
 */
export function createMediaReads(
  options: MediaOptions,
): MediaState & { readonly readHandler: EngineHandler<"media/read"> } {
  const saved = new Map<string, SavedMedia>();
  const held = new Map<string, HeldBytes>();
  return {
    saved,
    readHandler: async (call) => {
      const { agent, media, offset = 0 } = call.args;
      const kept = saved.get(media);
      if (kept?.agent !== agent) {
        return err("media.not_found");
      }
      const read = await bytesOf({ options, held }, kept.view, call.signal);
      if (!read.ok) {
        return read;
      }
      const bytes = read.value;
      if (offset >= bytes.byteLength) {
        return err("protocol.bad_args");
      }
      const end = Math.min(bytes.byteLength, offset + mediaPartBytes);
      if (end >= bytes.byteLength) {
        held.delete(media);
      }
      const data = Buffer.from(bytes.subarray(offset, end)).toString("base64");
      const next = end < bytes.byteLength ? { next: end } : {};
      return ok({
        contentType: kept.view.contentType,
        bytes: bytes.byteLength,
        offset,
        data,
        ...next,
      });
    },
  };
}
