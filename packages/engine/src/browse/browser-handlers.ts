import { type Clock, err, ok, type Random, type Result } from "@binference/core";
import type { BrowserFileView, ProtocolErrorCode } from "@binference/protocol";
import type { RunningTurns } from "../chat/running-turns.js";
import type { MachineFiles } from "../files/ports.js";
import type { EngineHandler } from "../operations/engine-call.js";
import type { BrowserCapture, BrowserRefusal } from "./browser-records.js";
import type { BrowserDriver } from "./ports.js";

/** The owner's browser settings, read at each call: whether it runs, and whether pages run scripts. */
export interface BrowserSettings {
  readonly enabled: boolean;
  /** Whether an `evaluate` act may run a script in a page. */
  readonly evaluate: boolean;
}

/**
 * The agent's browser as the composition root gives it (decision 0401): the driver on this machine
 * and the owner's settings as they are now. Without it `browser/run` is `browser.off`.
 */
export interface EngineBrowser {
  readonly driver: BrowserDriver;
  readonly settings: () => BrowserSettings;
}

/** The handler of the agent's browser (protocol spec, section 7.12). */
export interface BrowserHandlers {
  readonly "browser/run": EngineHandler<"browser/run">;
}

/** What the browser handler runs on, checks its caller with, and saves captures through. */
export interface BrowserHandlerOptions {
  readonly browser?: EngineBrowser;
  readonly turns: Pick<RunningTurns, "isRuntime">;
  /** The agent's files, where screenshots and PDFs are saved; without them a capture is refused. */
  readonly files?: Pick<MachineFiles, "write">;
  readonly clock: Clock;
  readonly random: Random;
}

const refusalCodes: Readonly<Record<BrowserRefusal, ProtocolErrorCode>> = {
  not_found: "browser.not_found",
  start_failed: "browser.start_failed",
  proxy_held: "browser.proxy_held",
  address_refused: "browser.address_refused",
  tab_not_found: "browser.tab_not_found",
};

const extensions: Readonly<Record<BrowserCapture["contentType"], string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "application/pdf": "pdf",
};

// Saves a capture in the agent's workspace under `media/browser/<date>/`, named by fresh bytes.
async function saveCapture(
  options: BrowserHandlerOptions,
  capture: BrowserCapture,
  signal: AbortSignal,
): Promise<Result<BrowserFileView, ProtocolErrorCode>> {
  const { files, clock, random } = options;
  if (files === undefined) {
    return err("file.unwritable");
  }
  const id = Buffer.from(random.bytes(8)).toString("hex");
  const day = new Date(clock.now()).toISOString().slice(0, 10);
  const relative = `media/browser/${day}/${id}.${extensions[capture.contentType]}`;
  const written = await files.write(relative, capture.bytes, {
    signal,
    workspaceOnly: true,
    createOnly: true,
  });
  if (!written.ok) {
    return err("file.unwritable");
  }
  const { contentType } = capture;
  return ok({ path: written.value, contentType, bytes: capture.bytes.byteLength });
}

// Why a call is refused before the driver hears of it, or nothing when it may run.
function refusalOf(
  options: BrowserHandlerOptions,
  call: Parameters<EngineHandler<"browser/run">>[0],
): ProtocolErrorCode | undefined {
  if (!options.turns.isRuntime(call.caller.credential)) {
    return "auth.scope";
  }
  const settings = options.browser?.settings();
  if (settings?.enabled !== true) {
    return "browser.off";
  }
  const { request } = call.args;
  const evaluates = request.action === "act" && request.act.kind === "evaluate";
  return evaluates && !settings.evaluate ? "browser.evaluate_off" : undefined;
}

/**
 * Creates the handler of `browser/run` (decision 0401). It answers only the runtime the engine runs
 * now; an engine without a browser, or with `browser.enabled` false, answers `browser.off`, and an
 * `evaluate` act while `browser.evaluate` is false `browser.evaluate_off`, before the driver hears
 * of it. A screenshot or a PDF is saved in the workspace and its view names the path.
 */
export function createBrowserHandlers(options: BrowserHandlerOptions): BrowserHandlers {
  return {
    "browser/run": async (call) => {
      const refusal = refusalOf(options, call);
      const driver = options.browser?.driver;
      if (refusal !== undefined || driver === undefined) {
        return err(refusal ?? "browser.off");
      }
      const ran = await driver.run(call.args.request, { signal: call.signal });
      if (!ran.ok) {
        return err(refusalCodes[ran.error]);
      }
      const { view, capture } = ran.value;
      if (capture === undefined) {
        return ok(view);
      }
      const saved = await saveCapture(options, capture, call.signal);
      return saved.ok ? ok({ ...view, file: saved.value }) : saved;
    },
  };
}
