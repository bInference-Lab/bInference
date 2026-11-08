import { idSchema } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { maxImageBytes } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { createRunningTurns } from "../chat/running-turns.js";
import { createFakeScreenCapture, fakeScreenBytes } from "../fakes/fake-screen-capture.js";
import { createMemoryFiles, memoryFilePlaces } from "../fakes/memory-files.js";
import type { MachineFiles } from "../files/ports.js";
import { expectOk, testAgent } from "../intents/test-intents.js";
import { testCall, testCallers } from "../operations/test-engine.js";
import type { ScreenCapture } from "./ports.js";
import { createScreenHandlers } from "./screen-handlers.js";

const runtime = testCallers.runtime;
const folder = `${memoryFilePlaces.workspace}/media/screen/2026-11-08`;

interface SetUp {
  readonly screen?: ScreenCapture | "none";
  readonly files?: MachineFiles | "none";
}

function setUp(given: SetUp = {}) {
  const turns = createRunningTurns();
  turns.startRuntime(idSchema("tok").parse(runtime.credential));
  const screen = given.screen ?? createFakeScreenCapture();
  const files = given.files ?? createMemoryFiles();
  const handler = createScreenHandlers({
    turns,
    clock: createManualClock(Date.UTC(2026, 10, 8, 12)),
    random: createSeededRandom(7),
    ...(screen === "none" ? {} : { screen }),
    ...(files === "none" ? {} : { files }),
  })["screen/capture"];
  const capture = async (display?: number, caller = runtime) =>
    handler(testCall({ agent: testAgent, ...(display === undefined ? {} : { display }) }, caller));
  return { capture, files };
}

describe("the owner's screen", () => {
  it("saves a PNG of each display in the workspace and answers their paths", async () => {
    const files = createMemoryFiles();
    const { shots } = expectOk(await setUp({ files }).capture());
    expect(shots.map((shot) => [shot.display, shot.contentType, shot.bytes])).toStrictEqual([
      [1, "image/png", 9],
      [2, "image/png", 9],
    ]);
    expect(shots.every((shot) => shot.path.startsWith(`${folder}/`))).toBe(true);
    expect(shots.every((shot) => shot.path.endsWith(".png"))).toBe(true);
    const [, second] = shots.map((shot) => shot.path);
    const read = await files.read(String(second), {
      signal: AbortSignal.timeout(1_000),
      workspaceOnly: true,
      maxBytes: maxImageBytes,
    });
    expect(read).toStrictEqual({ ok: true, value: { path: second, bytes: fakeScreenBytes(2) } });
  });

  it("takes the display asked, and saves a JPEG as jpg", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
    const screen = createFakeScreenCapture({ shot: { bytes: jpeg, contentType: "image/jpeg" } });
    const { shots } = expectOk(await setUp({ screen }).capture(2));
    expect(screen.requests).toStrictEqual([{ display: 2 }]);
    expect(shots.map((shot) => [shot.display, shot.contentType])).toStrictEqual([
      [2, "image/jpeg"],
    ]);
    expect(shots[0]?.path.endsWith(".jpg")).toBe(true);
  });

  it("answers no shot and names the program to allow when the OS has not allowed it", async () => {
    const screen = createFakeScreenCapture({ refuse: "no_permission" });
    expect(expectOk(await setUp({ screen }).capture())).toStrictEqual({
      shots: [],
      blocked: { program: "/usr/local/bin/node" },
    });
  });

  it("maps each refusal to its code", async () => {
    const refusals = [
      ["no_screen", "screen.no_screen"],
      ["no_program", "screen.no_program"],
      ["no_display", "screen.no_display"],
      ["too_large", "screen.too_large"],
      ["failed", "screen.failed"],
    ] as const;
    const answers = await Promise.all(
      refusals.map(async ([refuse]) =>
        setUp({ screen: createFakeScreenCapture({ refuse }) }).capture(),
      ),
    );
    expect(answers).toStrictEqual(refusals.map(([, error]) => ({ ok: false, error })));
    expect(await setUp().capture(3)).toStrictEqual({ ok: false, error: "screen.no_display" });
  });

  it("refuses a shot over 5 MiB, and one it cannot save", async () => {
    const huge = new Uint8Array(maxImageBytes + 1);
    huge.set([0x89, 0x50, 0x4e, 0x47]);
    const screen = createFakeScreenCapture({ shot: { bytes: huge, contentType: "image/png" } });
    expect(await setUp({ screen }).capture()).toStrictEqual({
      ok: false,
      error: "screen.too_large",
    });
    expect(await setUp({ files: "none" }).capture()).toStrictEqual({
      ok: false,
      error: "file.unwritable",
    });
  });

  it("answers only the runtime the engine runs now, and no screen in an engine without one", async () => {
    const screen = createFakeScreenCapture();
    expect(await setUp({ screen }).capture(undefined, testCallers.cli)).toStrictEqual({
      ok: false,
      error: "auth.scope",
    });
    expect(screen.requests).toStrictEqual([]);
    expect(await setUp({ screen: "none" }).capture()).toStrictEqual({
      ok: false,
      error: "screen.no_screen",
    });
  });
});
