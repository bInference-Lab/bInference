import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import { imageTypeOf } from "@binference/protocol";
import type { ScreenCapture } from "../screen/ports.js";

/**
 * The machines a screen capture is checked on: one whose screen it takes (`seeing`) and one with
 * no screen (`headless`), each in the adapter's own form.
 */
export interface ScreenCaptureMachines {
  readonly seeing: ScreenCapture;
  readonly headless: ScreenCapture;
}

/** Makes fresh {@link ScreenCaptureMachines} for each check. */
export interface ScreenCaptureSetup {
  machines(): Promise<ScreenCaptureMachines>;
}

const noAbort = new AbortController().signal;

type Check = (machines: ScreenCaptureMachines) => Promise<void>;

const checks: Readonly<Record<string, Check>> = {
  "takes the screen as PNG or JPEG images": async ({ seeing }) => {
    const taken = await seeing.capture({}, { signal: noAbort });
    assert.ok(taken.ok && taken.value.length > 0);
    assert.ok(taken.value.every((shot) => imageTypeOf(shot.bytes) === shot.contentType));
  },
  "takes the display asked by its number": async ({ seeing }) => {
    const taken = await seeing.capture({ display: 1 }, { signal: noAbort });
    assert.ok(taken.ok);
    assert.deepEqual(
      taken.value.map(({ display }) => display),
      [1],
    );
  },
  "refuses on a machine with no screen, still naming its program": async ({ headless }) => {
    assert.equal((await headless.capture({}, { signal: noAbort })).ok, false);
    assert.notEqual(headless.program, "");
  },
  "rejects with the signal's reason once it aborts": async ({ seeing }) => {
    const reason = new Error("stopped");
    await assert.rejects(seeing.capture({}, { signal: AbortSignal.abort(reason) }), reason);
  },
};

/** The contract every engine `ScreenCapture` adapter passes. */
export function screenCaptureContract(setup: ScreenCaptureSetup): readonly ContractCheck[] {
  return Object.entries(checks).map(([name, check]: readonly [string, Check]) => ({
    name,
    run: async () => check(await setup.machines()),
  }));
}
