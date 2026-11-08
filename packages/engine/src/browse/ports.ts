import type { Result } from "@binference/core";
import type { BrowserRequest } from "@binference/protocol";
import type { BrowserOutcome, BrowserRefusal } from "./browser-records.js";

/**
 * The agent's browser on the engine's machine (decision 0401): binference's own Chrome-family
 * browser with its own profile, every request it makes checked first. The composition root builds
 * it in `@binference/browser`; one runs per install.
 */
export interface BrowserDriver {
  /**
   * Runs one call, starting the browser for every action but `status` and `stop` when it does not
   * run. An action that ran and failed answers its view with `problem`; a refusal acted on nothing.
   */
  run(
    request: BrowserRequest,
    call: { readonly signal: AbortSignal },
  ): Promise<Result<BrowserOutcome, BrowserRefusal>>;
  /** Closes the browser with every tab, when it runs. Safe to call more than once. */
  stop(): Promise<void>;
  /** Whether the browser runs now. */
  isRunning(): boolean;
}
