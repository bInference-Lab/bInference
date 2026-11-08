import { afterEach, describe, expect, it } from "vitest";
import { screenCaptureContract } from "../contracts/screen-capture-contract.js";
import {
  captureOn,
  harnessOf,
  type Ran,
  removeScreenFolders,
  standIns,
} from "../fakes/screen-programs.js";
import { createLinuxScreenCapture } from "./linux-screen-capture.js";

const live = { signal: new AbortController().signal };

afterEach(async () => {
  await removeScreenFolders();
});

describe("the screen on Linux", () => {
  it.each(screenCaptureContract(harnessOf(createLinuxScreenCapture, { picksDisplay: false })))(
    "follows the contract with grim: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );

  it.each(
    screenCaptureContract(
      harnessOf(createLinuxScreenCapture, { installed: ["scrot"], picksDisplay: true }),
    ),
  )("follows the contract with scrot: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("runs the first of grim, gnome-screenshot and scrot installed", async () => {
    const cases = [
      [["grim", "scrot"], "/usr/bin/grim", ["-t", "png"]],
      [["gnome-screenshot", "scrot"], "/usr/bin/gnome-screenshot", ["-f"]],
      [["scrot"], "/usr/bin/scrot", []],
    ] as const;
    for (const [installed, file, head] of cases) {
      const ran: Ran[] = [];
      // oxlint-disable-next-line eslint/no-await-in-loop -- each machine on a fresh capture
      const { capture } = await captureOn(createLinuxScreenCapture, {
        run: standIns(ran),
        installed,
      });
      // oxlint-disable-next-line eslint/no-await-in-loop -- each machine on a fresh capture
      expect((await capture.capture({}, live)).ok).toBe(true);
      expect(ran[0]?.file).toBe(file);
      expect(ran[0]?.args.slice(0, head.length)).toStrictEqual(head);
    }
  });

  it("takes a display by number only with scrot, from 0", async () => {
    const ran: Ran[] = [];
    const scrot = await captureOn(createLinuxScreenCapture, {
      run: standIns(ran),
      installed: ["scrot"],
    });
    expect((await scrot.capture.capture({ display: 2 }, live)).ok).toBe(true);
    expect(ran[0]?.args.slice(0, 2)).toStrictEqual(["-M", "1"]);
    const failing = standIns([], { fails: { scrot: { exitCode: 2 } } });
    const none = await captureOn(createLinuxScreenCapture, { run: failing, installed: ["scrot"] });
    expect(await none.capture.capture({ display: 9 }, live)).toStrictEqual({
      ok: false,
      error: "no_display",
    });
  });

  it("refuses with no desktop, and names the programs to install when none is", async () => {
    const headless = await captureOn(createLinuxScreenCapture, {
      run: standIns([]),
      hasScreen: false,
    });
    expect(await headless.capture.capture({}, live)).toStrictEqual({
      ok: false,
      error: "no_screen",
    });
    const bare = await captureOn(createLinuxScreenCapture, { run: standIns([]), installed: [] });
    expect(await bare.capture.capture({}, live)).toStrictEqual({
      ok: false,
      error: "no_program",
    });
  });

  it("takes a large shot again as JPEG with grim, and refuses it with gnome-screenshot", async () => {
    const ran: Ran[] = [];
    const big = standIns(ran, { pngBytes: 5_000 });
    const grim = await captureOn(createLinuxScreenCapture, { run: big });
    expect((await grim.capture.capture({}, live)).ok).toBe(true);
    expect(ran[1]?.args.slice(0, 4)).toStrictEqual(["-t", "jpeg", "-q", "70"]);
    const gnome = await captureOn(createLinuxScreenCapture, {
      run: standIns([], { pngBytes: 5_000 }),
      installed: ["gnome-screenshot"],
    });
    expect(await gnome.capture.capture({}, live)).toStrictEqual({
      ok: false,
      error: "too_large",
    });
  });
});
