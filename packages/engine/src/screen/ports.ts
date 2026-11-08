import type { Result } from "@binference/core";
import type { ScreenRefusal, ScreenShot } from "./screen-records.js";

/**
 * Takes a screenshot of the owner's screen for the agent's `look_at_screen` (decision 0406): every
 * display, or one by its number from 1, each a PNG, or a JPEG once a PNG passed 5 MiB. It only
 * looks; no port of binference moves the mouse, presses a key or touches a window. It rejects with
 * the signal's reason once the signal aborts. The composition root builds it in the CLI over the
 * platform's screen capture.
 */
export interface ScreenCapture {
  /** The program the owner allows to record the screen, which a `no_permission` refusal means. */
  readonly program: string;
  capture(
    request: { readonly display?: number },
    call: { readonly signal: AbortSignal },
  ): Promise<Result<readonly ScreenShot[], ScreenRefusal>>;
}
