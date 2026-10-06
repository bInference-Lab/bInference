import { describe, expect, it } from "vitest";
import { createFrameDecoder, encodeFrame } from "./frame-codec.js";

const text = (frames: readonly Uint8Array[]): readonly string[] =>
  frames.map((frame) => Buffer.from(frame).toString("utf8"));

describe("frame codec", () => {
  it("rebuilds frames split across chunks and frames joined in one chunk", () => {
    const decoder = createFrameDecoder(64);
    const stream = Buffer.concat([
      encodeFrame(Buffer.from("first"), 64),
      encodeFrame(Buffer.from(""), 64),
      encodeFrame(Buffer.from("second"), 64),
    ]);

    const frames = [
      ...decoder.push(stream.subarray(0, 3)),
      ...decoder.push(stream.subarray(3, 12)),
      ...decoder.push(stream.subarray(12)),
    ];

    expect(text(frames)).toStrictEqual(["first", "", "second"]);
  });

  it("refuses to encode a payload over the limit", () => {
    expect(() => encodeFrame(new Uint8Array(65), 64)).toThrow(
      expect.objectContaining({ code: "platform.ipc_frame_too_large" }),
    );
  });

  it("refuses a header that announces a frame over the limit before its body arrives", () => {
    const decoder = createFrameDecoder(64);

    expect(() => decoder.push(Buffer.from([0, 0, 0, 65]))).toThrow(
      expect.objectContaining({ code: "platform.ipc_frame_too_large" }),
    );
  });
});
