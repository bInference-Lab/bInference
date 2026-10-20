import type { TxSimulator } from "@binference/chain";
import { type IntentView, type LaunchTokenRequest, noUploadImage } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { testCall, testCallers, type TestEngine } from "../operations/test-engine.js";
import {
  proposeIntent,
  testCardText,
  testLaunch,
  testLaunchEngine,
  testPad,
} from "./test-launches.js";

// A launchpad with no API for pictures takes the picture as a link the owner hosts (decision
// 0276): nothing reads the picture upload or the link, and no pin is waited for.
const link = "ipfs://bafkreig7wwicvvvzrbrcgs62ybg7yc7f7ay6s6yhsgpxcxvan5owbcfefm";

/** The test launch with a picture link, naming no upload. */
const linked: LaunchTokenRequest = {
  ...testLaunch,
  image: noUploadImage,
  venueOptions: { taxBps: 300, pictureLink: link },
};

async function stateOf(test: TestEngine, view: IntentView): Promise<string> {
  const read = await test.engine.handlers["intent/get"](
    testCall({ intent: view.intent }, testCallers.cli),
  );
  return read.ok ? read.value.state : read.error;
}

const notices = (test: TestEngine) =>
  test.pushes.filter((push) => push.kind === "notice/new").map((push) => push.data);

// A simulator whose runs revert, as a launchpad that refuses the create call would.
const reverting = (real: Pick<TxSimulator, "simulate">): Pick<TxSimulator, "simulate"> => ({
  simulate: async (drafts, options) => {
    const steps = await real.simulate(drafts, options);
    return steps.map((step) => Object.assign({}, step, { status: "reverted" }));
  },
});

describe("a token launch on a launchpad that takes its picture as a link", () => {
  it("opens its card without reading a picture or waiting for a pin", async () => {
    const { test, launcher } = await testLaunchEngine({ takesPictureLink: true });
    const view = await proposeIntent(test, linked);
    expect(view.state).toBe("awaiting_confirmation");
    expect(launcher.uploads()).toStrictEqual([]);
    expect(launcher.statusReads()).toBe(0);
  });

  it("shows the link whole, and no picture or public line", async () => {
    const { test } = await testLaunchEngine({ takesPictureLink: true });
    const long = `https://pictures.example/${"a".repeat(480)}.png`;
    const request = { ...linked, venueOptions: { taxBps: 300, pictureLink: long } };
    const lines = await testCardText(test, await proposeIntent(test, request), "en");
    expect(lines).toContain(`Picture at ${long} (binference never opens it)`);
    expect(lines.some((line) => line.startsWith("Picture sent"))).toBe(false);
    expect(lines.some((line) => line.includes("already public"))).toBe(false);
  });

  it("refuses a link the setting does not take before anything is stored", async () => {
    const { test } = await testLaunchEngine({ takesPictureLink: true });
    const request = { ...linked, venueOptions: { taxBps: 300, pictureLink: "http://cat.example" } };
    const proposed = await test.engine.handlers["intent/propose"](
      testCall(request, testCallers.cli),
    );
    expect(proposed).toStrictEqual({ ok: false, error: "protocol.bad_args" });
  });

  it("refuses a real upload, so no picture is dropped unseen", async () => {
    const { test } = await testLaunchEngine({ takesPictureLink: true });
    const proposed = await test.engine.handlers["intent/propose"](
      testCall({ ...linked, image: "upl_moon" }, testCallers.cli),
    );
    expect(proposed).toStrictEqual({ ok: false, error: "protocol.bad_args" });
  });

  it("refuses a launch with no link", async () => {
    const { test } = await testLaunchEngine({ takesPictureLink: true });
    const request = { ...linked, venueOptions: { taxBps: 300 } };
    const proposed = await test.engine.handlers["intent/propose"](
      testCall(request, testCallers.cli),
    );
    expect(proposed).toStrictEqual({ ok: false, error: "protocol.bad_args" });
  });

  it("tells the owner that nothing was made public when it stops before its card", async () => {
    const { test } = await testLaunchEngine({ takesPictureLink: true, simulator: reverting });
    const view = await proposeIntent(test, linked);
    await expect(stateOf(test, view)).resolves.toBe("failed_check");
    expect(notices(test)).toContainEqual(
      expect.objectContaining({
        key: "notice.launchStopped",
        values: { symbol: "MCAT", venue: testPad, reason: "simulation_reverted", private: "yes" },
      }),
    );
  });
});
