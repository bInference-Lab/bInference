import { err, type Result } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import {
  type LaunchTokenRequest,
  noUploadImage,
  type ProtocolErrorCode,
} from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { testPng } from "../chat/test-images.js";
import { testAgent, testNowMs } from "../intents/test-intents.js";
import { testLaunch } from "../money-path/test-launches.js";
import { testChains } from "../operations/test-engine.js";
import type { EnginePush } from "../pushes/engine-push.js";
import { createUploadShelf, type UploadShelf } from "../uploads/upload-shelf.js";
import { createLaunchDraftDesk, type LaunchDraftDeskOptions } from "./launch-draft-desk.js";
import { createLaunchDraftShelf, type LaunchDraft } from "./launch-draft-shelf.js";

const ref = "d3Zr_x9-AbCdEfGh";
const ownerId = 7_012_345_678;

const testDraft: LaunchDraft = {
  id: "c2hvd24tb25jZS1h",
  ref,
  agentId: testAgent,
  agentName: "main",
  request: { ...testLaunch, image: noUploadImage },
  settings: [],
  hasOutsideContent: false,
  expiresAtMs: testNowMs + 600_000,
};

// A desk holding one draft, proposing through `propose`, with the owner paired.
function deskOf(draft: LaunchDraft, propose: LaunchDraftDeskOptions["propose"]) {
  const clock = createManualClock(testNowMs);
  const shelf = createLaunchDraftShelf();
  shelf.put(draft);
  const pushes: EnginePush[] = [];
  const uploads: UploadShelf = createUploadShelf({ clock, random: createSeededRandom(1) });
  const desk = createLaunchDraftDesk({
    shelf,
    host: { picturePlace: () => (draft.picture === undefined ? "link" : "upload") },
    chains: testChains(),
    uploads,
    propose,
    owners: { get: async () => Promise.resolve({ userId: ownerId, pairedAtMs: 1 }) },
    clock,
    publish: (push) => pushes.push(push),
  });
  return { desk, pushes, uploads };
}

describe("the launch draft desk", () => {
  it("ends the draft as failed when the proposal behind a Start throws", async () => {
    const { desk, pushes } = deskOf(testDraft, async () =>
      Promise.reject(new Error("The engine stopped.")),
    );
    const signal = AbortSignal.timeout(5_000);
    expect(await desk.start(ref, ownerId, { signal })).toStrictEqual({ status: "starting" });
    await desk.idle();
    expect(pushes.map(({ kind, data }) => [kind, data])).toStrictEqual([
      [
        "chat/launchDraftClosed",
        { agent: testAgent, draft: "c2hvd24tb25jZS1h", outcome: "failed", error: "internal.error" },
      ],
    ]);
    expect(await desk.drop(ref, ownerId, { signal })).toStrictEqual({ status: "unknown" });
  });

  it("drops the draft's photo from the upload shelf when its Start is refused", async () => {
    const picture = {
      bytes: testPng,
      image: { contentType: "image/png", bytes: testPng.byteLength, sha256: "a".repeat(64) },
    } as const;
    const images: string[] = [];
    const refuse: LaunchDraftDeskOptions["propose"] = async ({ args }) => {
      images.push((args as LaunchTokenRequest).image);
      return Promise.resolve<Result<never, ProtocolErrorCode>>(err("intent.launch_waiting"));
    };
    const { desk, uploads } = deskOf({ ...testDraft, picture } as LaunchDraft, refuse);
    await desk.start(ref, ownerId, { signal: AbortSignal.timeout(5_000) });
    await desk.idle();
    expect([images.length, images.map((image) => uploads.holderOf(image))]).toStrictEqual([
      1,
      [undefined],
    ]);
  });
});
