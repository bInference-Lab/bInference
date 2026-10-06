import { Buffer } from "node:buffer";
import { BinferenceError } from "@binference/core";

const headerBytes = 4;

function tooLarge(bytes: number, maxFrameBytes: number): BinferenceError {
  return new BinferenceError({
    code: "platform.ipc_frame_too_large",
    message: `An IPC frame of ${String(bytes)} bytes is over the limit of ${String(maxFrameBytes)}.`,
    details: { bytes, maxFrameBytes },
  });
}

/** Prefixes a payload with its length as 4 bytes, big-endian. Refuses one over the limit. */
export function encodeFrame(payload: Uint8Array, maxFrameBytes: number): Buffer {
  if (payload.byteLength > maxFrameBytes) {
    throw tooLarge(payload.byteLength, maxFrameBytes);
  }
  const header = Buffer.alloc(headerBytes);
  header.writeUInt32BE(payload.byteLength);
  return Buffer.concat([header, payload]);
}

/** Cuts a byte stream back into the payloads {@link encodeFrame} framed. */
export interface FrameDecoder {
  /** Takes the next chunk and returns every payload it completes, in order. */
  push(chunk: Uint8Array): readonly Buffer[];
}

/**
 * Creates a {@link FrameDecoder}. It throws `platform.ipc_frame_too_large` as soon as a header
 * announces a frame over the limit, so it never holds more than one frame and one chunk.
 */
export function createFrameDecoder(maxFrameBytes: number): FrameDecoder {
  let pending = Buffer.alloc(0);
  // The length of the frame at the front, once its whole header has arrived.
  const frontLength = (): number | undefined => {
    if (pending.byteLength < headerBytes) {
      return undefined;
    }
    const length = pending.readUInt32BE(0);
    if (length > maxFrameBytes) {
      throw tooLarge(length, maxFrameBytes);
    }
    return length;
  };
  return {
    push: (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      const frames: Buffer[] = [];
      for (
        let length = frontLength();
        length !== undefined && pending.byteLength >= headerBytes + length;
        length = frontLength()
      ) {
        frames.push(Buffer.from(pending.subarray(headerBytes, headerBytes + length)));
        pending = pending.subarray(headerBytes + length);
      }
      return frames;
    },
  };
}
