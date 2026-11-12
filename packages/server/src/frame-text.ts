import { Buffer } from "node:buffer";
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

function tooLarge(link: Link, text: string): void {
  const decoded = link.phase.get().name === "ready" ? decodeClientFrame(text) : undefined;
  if (decoded?.ok === true && decoded.value.t === "call") {
    const error = { code: "protocol.too_large", message: "The frame is too large." } as const;
    sendFrame(link, { t: "fail", id: decoded.value.id, error: { ...error, retryable: false } });
    return;
  }
  sayBye(link, "protocol.too_large", "The frame is too large.");
}

/**
 * The text of a frame a connection received, or `undefined` once it was answered: a binary frame
 * ends the connection with `protocol.bad_frame`; a frame over the phase's size limit fails its
 * call with `protocol.too_large` after `ready`, or ends the connection with it before.
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
  if (bytes.byteLength > limit) {
    tooLarge(link, bytes.toString("utf8"));
    return undefined;
  }
  return bytes.toString("utf8");
}
