import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import { listFolderFiles } from "../list-folder-files.js";
import type { ScreenCapture } from "../ports.js";
import type { ScreenShot } from "../screen-shot.js";

/**
 * A screen capture under test, over stand-ins for the OS's programs: one whose programs answer,
 * one whose first PNG is over the limit, the limit, the folder captures work in, and whether it
 * takes one display by its number.
 */
export interface ScreenCaptureSubject {
  readonly capture: ScreenCapture;
  readonly large: ScreenCapture;
  readonly maxBytes: number;
  readonly folder: string;
  readonly picksDisplay: boolean;
}

/** Makes a fresh {@link ScreenCaptureSubject} for each check. */
export interface ScreenCaptureHarness {
  create(): Promise<ScreenCaptureSubject>;
}

type Check = (subject: ScreenCaptureSubject) => Promise<void>;

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });

const heads: Readonly<Record<ScreenShot["contentType"], readonly number[]>> = {
  "image/png": [0x89, 0x50, 0x4e, 0x47],
  "image/jpeg": [0xff, 0xd8, 0xff],
};

function assertImage(shot: ScreenShot, maxBytes: number): void {
  const head = heads[shot.contentType];
  assert.deepEqual([...shot.bytes.subarray(0, head.length)], head);
  assert.ok(shot.bytes.byteLength <= maxBytes);
}

const takesTheScreen: Check = async (subject) => {
  const shot = await subject.capture.capture({}, live());
  assert.ok(shot.ok);
  assert.ok(shot.value.length >= 1);
  for (const each of shot.value) {
    assertImage(each, subject.maxBytes);
  }
};

const takesOneDisplay: Check = async (subject) => {
  const shot = await subject.capture.capture({ display: 1 }, live());
  if (!subject.picksDisplay) {
    assert.deepEqual(shot, { ok: false, error: "no_display" });
    return;
  }
  assert.ok(shot.ok);
  assert.equal(shot.value.length, 1);
  assert.equal(shot.value[0]?.display, 1);
};

const makesALargeShotSmaller: Check = async (subject) => {
  const shot = await subject.large.capture({}, live());
  assert.ok(shot.ok);
  for (const each of shot.value) {
    assert.equal(each.contentType, "image/jpeg");
    assertImage(each, subject.maxBytes);
  }
};

const leavesNoFile: Check = async (subject) => {
  await subject.capture.capture({}, live());
  assert.deepEqual(await listFolderFiles(subject.folder, live().signal), []);
};

const stopsOnAbort: Check = async (subject) => {
  const stopped = new Error("stopped");
  const stop = new AbortController();
  stop.abort(stopped);
  await assert.rejects(subject.capture.capture({}, stop), stopped);
};

const checks: readonly (readonly [string, Check])[] = [
  ["takes the screen as images within the limit", takesTheScreen],
  ["takes one display by its number, or refuses where it cannot pick one", takesOneDisplay],
  ["makes a shot over the limit a smaller JPEG", makesALargeShotSmaller],
  ["leaves no file behind", leavesNoFile],
  ["rejects with the signal's reason once it aborts", stopsOnAbort],
];

/** The contract every `ScreenCapture` adapter passes. */
export function screenCaptureContract(harness: ScreenCaptureHarness): readonly ContractCheck[] {
  return checks.map(([name, check]) => ({
    name,
    run: async () => check(await harness.create()),
  }));
}
