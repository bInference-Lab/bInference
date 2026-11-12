import { Buffer } from "node:buffer";
import { nestsDeeperThan } from "@binference/core";
import { decodeClientFrame } from "@binference/protocol";
import type { RawData } from "ws";
import { type Link, sayBye, sendFrame } from "./connection-link.js";

/** One WebSocket message as `ws` hands it over. */
export interface FrameMessage {
  readonly data: RawData;
  readonly isBinary: boolean;
}

function bytesOf(data: RawData): Buffer {
  if (Array.isArray(data)) {
    return Buffer.concat(data);
  }
  return Buffer.isBuffer(data) ? data : Buffer.from(new Uint8Array(data));
}

// A frame over a bound: a call's fails and the connection goes on, any other frame ends it. Reading
// the call's id walks nothing deep: the frame's schemas leave `args` unread.
function tooLarge(link: Link, text: string, message: string): void {
  const decoded = link.phase.get().name === "ready" ? decodeClientFrame(text) : undefined;
  if (decoded?.ok === true && decoded.value.t === "call") {
    const error = { code: "protocol.too_large", message, retryable: false } as const;
    sendFrame(link, { t: "fail", id: decoded.value.id, error });
    return;
  }
  sayBye(link, "protocol.too_large", message);
}

/**
 * The text of a frame a connection received, or `undefined` once it was answered: a binary frame
 * ends the connection with `protocol.bad_frame`; a frame over the phase's size limit, or one that
 * nests objects and arrays past `maxJsonDepth` (decision 0417), fails its call with
 * `protocol.too_large` after `ready`, or ends the connection with it before. The depth is read
 * before any schema walks the frame.
 */
export function frameTextOf(link: Link, message: FrameMessage): string | undefined {
  if (message.isBinary) {
    sayBye(link, "protocol.bad_frame", "Frames are text.");
    return undefined;
  }
  const bytes = bytesOf(message.data);
  const { limits } = link.context;
  const isReady = link.phase.get().name === "ready";
  const limit = isReady ? limits.maxFrameBytes : limits.maxSignInFrameBytes;
  const text = bytes.toString("utf8");
  if (bytes.byteLength > limit) {
    tooLarge(link, text, "The frame is too large.");
    return undefined;
  }
  if (nestsDeeperThan(text)) {
    tooLarge(link, text, "The frame nests too deep.");
    return undefined;
  }
  return text;
}
