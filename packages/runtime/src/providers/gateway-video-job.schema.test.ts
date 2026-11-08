import { describe, expect, it } from "vitest";
import { gatewayVideoJobOf, jsonOfText } from "./gateway-video-job.schema.js";
import { gatewayVideoModelOf } from "./gateway-video-models.schema.js";

describe("the gateway's video answers", () => {
  it.each([
    [0.6, 600_000n],
    [0.3328128, 332_813n],
    [12, 12_000_000n],
    [0, 0n],
    [1e-7, 1n],
  ])("books a charge of %d dollars as %d micro-dollars, rounded up", (cost, micros) => {
    expect(gatewayVideoJobOf({ status: "completed", usage: { cost } }).costMicros).toBe(micros);
  });

  it("reads an error object or text, an unknown status, and an answer that is no job", () => {
    expect(gatewayVideoJobOf({ status: "failed", error: "  upstream\n busy " })).toStrictEqual({
      status: "failed",
      urls: [],
      error: "upstream busy",
    });
    expect(gatewayVideoJobOf({ id: "vid_1", status: "queued", error: {} })).toStrictEqual({
      id: "vid_1",
      status: "unknown",
      urls: [],
    });
    expect(gatewayVideoJobOf("<html>")).toStrictEqual({ status: "unknown", urls: [] });
  });

  it("reads JSON text, and text that is none as null", () => {
    expect(jsonOfText('{"a":1}')).toStrictEqual({ a: 1 });
    expect(jsonOfText("Bad gateway")).toBeNull();
  });

  it("reads a model's values, leaving out what does not read", () => {
    const list = {
      data: [
        { id: "other" },
        {
          id: "kling",
          supported_durations: [5, 2.5, 0],
          supported_frame_images: ["first_frame", "middle"],
          max_input_references: "many",
          generate_audio: "yes",
        },
      ],
    };
    expect(gatewayVideoModelOf(list, "kling")).toStrictEqual({
      durations: [5],
      resolutions: [],
      aspectRatios: [],
      frames: ["first_frame"],
      maxReferences: 0,
      sound: false,
      seed: false,
    });
    expect(gatewayVideoModelOf({ data: "none" }, "kling")).toBeUndefined();
  });
});
