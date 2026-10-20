import type { LaunchTokenRequest } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { testCall, testCallers } from "../operations/test-engine.js";
import { proposeIntent, testCardText, testLaunch, testLaunchEngine } from "./test-launches.js";

// A launchpad that writes the owner's picture into its create call (decision 0279): the engine
// reads the upload once, holds it to the bytes the call takes, and the build check holds the call
// to its digest; nothing is uploaded and no pin is waited for.
const written: LaunchTokenRequest = { ...testLaunch, image: "upl_sized" };

describe("a token launch on a launchpad that writes its picture into its create call", () => {
  it("opens its card without an upload or a pin wait, and shows the picture's size", async () => {
    const { test, launcher } = await testLaunchEngine({ writesPicture: { mostBytes: 1_000 } });
    const view = await proposeIntent(test, written);
    expect(view.state).toBe("awaiting_confirmation");
    expect(launcher.uploads()).toStrictEqual([]);
    const lines = await testCardText(test, view, "en");
    expect(lines).toContainEqual(
      expect.stringMatching(
        /^Picture written on chain with the token: PNG, 29 bytes, 64 x 48 pixels, SHA-256 [0-9a-f]{16}$/,
      ),
    );
    expect(lines.some((line) => line.includes("already public"))).toBe(false);
  });

  it("ends picture_too_large for a picture over what the create call takes", async () => {
    const { test } = await testLaunchEngine({ writesPicture: { mostBytes: 28 } });
    const view = await proposeIntent(test, written);
    expect(view).toMatchObject({ state: "failed_check", outcome: { reason: "picture_too_large" } });
  });

  it("ends image_unreadable for a picture whose header tells no size", async () => {
    const { test } = await testLaunchEngine({ writesPicture: { mostBytes: 1_000 } });
    const view = await proposeIntent(test, { ...written, image: "upl_moon" });
    expect(view).toMatchObject({ state: "failed_check", outcome: { reason: "image_unreadable" } });
  });

  it("refuses a create call that writes another picture than the card's", async () => {
    const lying = { mostBytes: 1_000, sha256: "0".repeat(64) };
    const { test } = await testLaunchEngine({ writesPicture: lying });
    const view = await proposeIntent(test, written);
    expect(view).toMatchObject({ state: "failed_check", outcome: { reason: "decode_mismatch" } });
  });

  it("refuses a launch that names no upload, before anything is stored", async () => {
    const { test } = await testLaunchEngine({ writesPicture: { mostBytes: 1_000 } });
    const proposed = await test.engine.handlers["intent/propose"](
      testCall({ ...written, image: "none" }, testCallers.cli),
    );
    expect(proposed).toStrictEqual({ ok: false, error: "protocol.bad_args" });
  });
});
