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
  it("ends the draft as failed and passes the fault on when the proposal throws", async () => {
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
    const fault = new Error("The engine stopped.");
    const desk = createLaunchDraftDesk({
      shelf,
      host: { picturePlace: () => "link" },
      chains: testChains(),
      uploads: createUploadShelf({ clock, random: createSeededRandom(1) }),
      propose: async () => Promise.reject(fault),
      clock,
      publish: (push) => pushes.push(push),
    });
    const signal = AbortSignal.timeout(5_000);
    await expect(desk.start(ref, { userId: 7_012_345_678 }, { signal })).rejects.toBe(fault);
    expect(pushes.map(({ kind, data }) => [kind, data])).toStrictEqual([
      [
        "chat/launchDraftClosed",
        { agent: testAgent, draft: "c2hvd24tb25jZS1h", outcome: "failed", error: "internal.error" },
      ],
    ]);
    expect(desk.drop(ref)).toStrictEqual({ status: "unknown" });
  });
});
