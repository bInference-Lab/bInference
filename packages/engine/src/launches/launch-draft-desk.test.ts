import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { noUploadImage } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { testAgent, testNowMs } from "../intents/test-intents.js";
import { testLaunch } from "../money-path/test-launches.js";
import { testChains } from "../operations/test-engine.js";
import type { EnginePush } from "../pushes/engine-push.js";
import { createUploadShelf } from "../uploads/upload-shelf.js";
import { createLaunchDraftDesk } from "./launch-draft-desk.js";
import { createLaunchDraftShelf } from "./launch-draft-shelf.js";

const ref = "d3Zr_x9-AbCdEfGh";

describe("the launch draft desk", () => {
  it("ends the draft as failed when the proposal behind a Start throws", async () => {
    const clock = createManualClock(testNowMs);
    const shelf = createLaunchDraftShelf();
    shelf.put({
      id: "c2hvd24tb25jZS1h",
      ref,
      agentId: testAgent,
      agentName: "main",
      request: { ...testLaunch, image: noUploadImage },
      settings: [],
      hasOutsideContent: false,
      expiresAtMs: testNowMs + 600_000,
    });
    const pushes: EnginePush[] = [];
    const desk = createLaunchDraftDesk({
      shelf,
      host: { picturePlace: () => "link" },
      chains: testChains(),
      uploads: createUploadShelf({ clock, random: createSeededRandom(1) }),
      propose: async () => Promise.reject(new Error("The engine stopped.")),
      owners: { get: async () => Promise.resolve({ userId: 7_012_345_678, pairedAtMs: 1 }) },
      clock,
      publish: (push) => pushes.push(push),
    });
    const signal = AbortSignal.timeout(5_000);
    expect(await desk.start(ref, 7_012_345_678, { signal })).toStrictEqual({ status: "starting" });
    await desk.idle();
    expect(pushes.map(({ kind, data }) => [kind, data])).toStrictEqual([
      [
        "chat/launchDraftClosed",
        { agent: testAgent, draft: "c2hvd24tb25jZS1h", outcome: "failed", error: "internal.error" },
      ],
    ]);
    expect(await desk.drop(ref, 7_012_345_678, { signal })).toStrictEqual({ status: "unknown" });
  });
});
