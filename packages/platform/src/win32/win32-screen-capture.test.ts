import { BinferenceError } from "@binference/core";
import { afterEach, describe, expect, it } from "vitest";
import { screenCaptureContract } from "../contracts/screen-capture-contract.js";
import {
  captureOn,
  harnessOf,
  type Ran,
  removeScreenFolders,
  standIns,
} from "../fakes/screen-programs.js";
import { listFolderFiles } from "../list-folder-files.js";
import { createWin32ScreenCapture } from "./win32-screen-capture.js";

const live = { signal: new AbortController().signal };

afterEach(async () => {
  await removeScreenFolders();
});

describe("the screen on Windows", () => {
  it.each(screenCaptureContract(harnessOf(createWin32ScreenCapture, { picksDisplay: true })))(
    "follows the contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );

  it("runs one fixed script, its inputs as variables of its own process", async () => {
    const ran: Ran[] = [];
    const big = standIns(ran, { pngBytes: 5_000 });
    const { capture } = await captureOn(createWin32ScreenCapture, { run: big });
    expect((await capture.capture({ display: 2 }, live)).ok).toBe(true);
    expect(new Set(ran.map((each) => each.args.join(" "))).size).toBe(1);
    expect(ran[0]?.args.slice(0, 3)).toStrictEqual([
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
    ]);
    expect(ran.map((each) => each.env?.["SCREEN_DISPLAY"])).toStrictEqual(["2", "2"]);
    expect(ran.map((each) => each.env?.["SCREEN_FORMAT"])).toStrictEqual([undefined, "jpeg"]);
  });

  it("refuses a display it does not have, and a script that fails or cannot start", async () => {
    const two = await captureOn(createWin32ScreenCapture, { run: standIns([]) });
    expect(await two.capture.capture({ display: 3 }, live)).toStrictEqual({
      ok: false,
      error: "no_display",
    });
    const failing = standIns([], { fails: { "powershell.exe": { exitCode: 1 } } });
    const broken = await captureOn(createWin32ScreenCapture, { run: failing });
    expect(await broken.capture.capture({}, live)).toStrictEqual({
      ok: false,
      error: "failed",
    });
    const missing = await captureOn(createWin32ScreenCapture, {
      run: async () =>
        Promise.reject(new BinferenceError({ code: "platform.command_failed", message: "None." })),
    });
    expect(await missing.capture.capture({}, live)).toStrictEqual({
      ok: false,
      error: "failed",
    });
    expect(await listFolderFiles(missing.folder, live.signal)).toStrictEqual([]);
  });
});
