import { afterEach, describe, expect, it } from "vitest";
import { screenCaptureContract } from "../contracts/screen-capture-contract.js";
import {
  captureOn,
  harnessOf,
  type Ran,
  removeScreenFolders,
  shotsOf,
  standInNode,
  standIns,
} from "../fakes/screen-programs.js";
import { createMacosScreenCapture } from "./macos-screen-capture.js";

const live = { signal: new AbortController().signal };

afterEach(async () => {
  await removeScreenFolders();
});

describe("the screen on macOS", () => {
  it.each(screenCaptureContract(harnessOf(createMacosScreenCapture, { picksDisplay: true })))(
    "follows the contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );

  it("takes one PNG per display without a sound, after asking whether it may", async () => {
    const ran: Ran[] = [];
    const { capture } = await captureOn(createMacosScreenCapture, { run: standIns(ran) });
    const shot = await capture.capture({}, live);
    expect(shotsOf(shot).map((each) => each.display)).toStrictEqual([1, 2]);
    expect(ran.map((each) => each.file)).toStrictEqual(["osascript", "screencapture"]);
    expect(ran[0]?.args.slice(0, 3)).toStrictEqual(["-l", "JavaScript", "-e"]);
    expect(ran[1]?.args.slice(0, 4)).toStrictEqual(["-x", "-C", "-t", "png"]);
    expect(ran[1]?.args.filter((arg) => arg.endsWith(".png"))).toHaveLength(2);
  });

  it("takes the display asked with -D, and refuses one past the displays", async () => {
    const ran: Ran[] = [];
    const { capture } = await captureOn(createMacosScreenCapture, { run: standIns(ran) });
    const shot = await capture.capture({ display: 2 }, live);
    expect(shotsOf(shot).map((each) => each.display)).toStrictEqual([2]);
    expect(ran[1]?.args.slice(0, 4)).toStrictEqual(["-x", "-C", "-D", "2"]);
    expect(await capture.capture({ display: 3 }, live)).toStrictEqual({
      ok: false,
      error: "no_display",
    });
  });

  it("names the program to allow when macOS has not allowed recording, and takes nothing", async () => {
    const ran: Ran[] = [];
    const run = standIns(ran, { allowed: "false" });
    const { capture } = await captureOn(createMacosScreenCapture, { run });
    expect(await capture.capture({}, live)).toStrictEqual({
      ok: false,
      error: "no_permission",
    });
    expect(ran.map((each) => each.file)).toStrictEqual(["osascript"]);
    expect(capture.program).toBe(standInNode);
  });

  it("reads what screencapture says when the preflight could not answer", async () => {
    const answers = [
      ["could not create image from display", "no_permission"],
      ["Invalid display specified. Must be a number from 1-2", "no_display"],
      ["", "failed"],
    ] as const;
    for (const [stderr, error] of answers) {
      const fails = { osascript: { exitCode: 1 }, screencapture: { stderr } };
      // oxlint-disable-next-line eslint/no-await-in-loop -- each answer on a fresh capture
      const { capture } = await captureOn(createMacosScreenCapture, {
        run: standIns([], { fails }),
      });
      // oxlint-disable-next-line eslint/no-await-in-loop -- each answer on a fresh capture
      expect(await capture.capture({}, live)).toStrictEqual({ ok: false, error });
    }
  });

  it("makes a shot over the limit JPEG with sips, then smaller, else refuses it", async () => {
    const ran: Ran[] = [];
    const big = standIns(ran, { pngBytes: 5_000, displays: 1 });
    const { capture } = await captureOn(createMacosScreenCapture, { run: big });
    const shot = await capture.capture({}, live);
    expect(shotsOf(shot)[0]?.contentType).toBe("image/jpeg");
    expect(ran.at(-1)?.args.slice(0, 5)).toStrictEqual([
      "-s",
      "format",
      "jpeg",
      "-s",
      "formatOptions",
    ]);
    const still = standIns([], { pngBytes: 5_000, jpegBytes: 5_000 });
    const stays = await captureOn(createMacosScreenCapture, { run: still });
    expect(await stays.capture.capture({}, live)).toStrictEqual({
      ok: false,
      error: "too_large",
    });
  });
});
