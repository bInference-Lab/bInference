import { describe, expect, it } from "vitest";
import { gatewayVideoBodyOf, type VideoMakingRequest } from "./gateway-video-body.js";
import type { GatewayVideoModel } from "./gateway-video-models.schema.js";

const veo: GatewayVideoModel = {
  durations: [8, 4, 6],
  resolutions: ["4K", "1080p", "720p"],
  aspectRatios: ["9:16", "16:9"],
  frames: ["first_frame", "last_frame"],
  maxReferences: 2,
  sound: true,
  seed: true,
};
const plain: GatewayVideoModel = {
  durations: [5],
  resolutions: ["2K", "4K"],
  aspectRatios: ["21:9", "1:1"],
  frames: [],
  maxReferences: 0,
  sound: false,
  seed: false,
};
const asked: VideoMakingRequest = { prompt: "A boat.", references: [] };
const picture = "https://pictures.example.test/boat.png";

const bodyOf = (facts: GatewayVideoModel, request: Partial<VideoMakingRequest>) =>
  gatewayVideoBodyOf({ name: "google/veo-3.1-fast", facts }, { ...asked, ...request });

describe("the body of a video the gateway makes", () => {
  it("takes the model's shortest length and lowest size, 16:9 where listed, else its first shape", () => {
    expect(bodyOf(veo, {})).toStrictEqual({
      ok: true,
      body: {
        model: "google/veo-3.1-fast",
        prompt: "A boat.",
        duration: 4,
        resolution: "720p",
        aspect_ratio: "16:9",
      },
    });
    expect(bodyOf(plain, {})).toMatchObject({
      ok: true,
      body: { duration: 5, resolution: "2K", aspect_ratio: "21:9" },
    });
  });

  it("sends the values asked for, sound, a seed, frames and references where the model takes them", () => {
    const framed = bodyOf(veo, {
      seconds: 8,
      resolution: "1080p",
      aspectRatio: "9:16",
      sound: true,
      seed: 7,
      firstFrame: picture,
      lastFrame: picture,
    });
    expect(framed).toMatchObject({
      ok: true,
      body: {
        duration: 8,
        resolution: "1080p",
        aspect_ratio: "9:16",
        generate_audio: true,
        seed: 7,
        frame_images: [
          { type: "image_url", image_url: { url: picture }, frame_type: "first_frame" },
          { type: "image_url", image_url: { url: picture }, frame_type: "last_frame" },
        ],
      },
    });
    expect(bodyOf(veo, { references: [picture] })).toMatchObject({
      body: { input_references: [{ type: "image_url", image_url: { url: picture } }] },
    });
  });

  it.each([
    [{ resolution: "480p" }, "the model makes videos at 4K, 1080p, 720p; ask for one of them"],
    [{ aspectRatio: "1:1" }, "the model makes videos shaped 9:16, 16:9; ask for one of them"],
    [
      { firstFrame: picture, references: [picture] },
      "frame pictures and references cannot go together; use one or the other",
    ],
    [{ references: [picture, picture, picture] }, "the model takes at most 2 references"],
  ] as const)("refuses %j in words naming what the model takes", (request, failure) => {
    expect(bodyOf(veo, request)).toStrictEqual({ ok: false, failure });
  });

  it.each([
    [{ firstFrame: picture }, "the model starts on no picture you give; leave out firstFrame"],
    [{ lastFrame: picture }, "the model ends on no picture you give; leave out lastFrame"],
    [{ sound: true }, "the model makes no sound; leave out sound"],
    [{ seed: 1 }, "the model takes no seed; leave out seed"],
  ] as const)("refuses %j to a model that takes none", (request, failure) => {
    expect(bodyOf(plain, request)).toStrictEqual({ ok: false, failure });
  });
});
