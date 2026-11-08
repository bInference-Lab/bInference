import { type Clock, err, ok, type Random, type Result } from "@binference/core";
import {
  maxImageBytes,
  maxScreenShots,
  type ProtocolErrorCode,
  type ScreenShotView,
} from "@binference/protocol";
import type { RunningTurns } from "../chat/running-turns.js";
import type { MachineFiles } from "../files/ports.js";
import type { EngineHandler } from "../operations/engine-call.js";
import type { ScreenCapture } from "./ports.js";
import type { ScreenRefusal, ScreenShot } from "./screen-records.js";

/** The handler of the screenshots the agent looks at (decision 0406). */
export interface ScreenHandlers {
  readonly "screen/capture": EngineHandler<"screen/capture">;
}

/** What the screen handler takes screenshots with, checks its caller with, and saves them in. */
export interface ScreenHandlerOptions {
  /** The owner's screen on this machine; without it every capture is `screen.no_screen`. */
  readonly screen?: ScreenCapture;
  readonly turns: Pick<RunningTurns, "isRuntime">;
  /** The agent's files, where screenshots are saved; without them a capture is refused. */
  readonly files?: Pick<MachineFiles, "write">;
  readonly clock: Clock;
  readonly random: Random;
}

const refusalCodes: Readonly<Record<Exclude<ScreenRefusal, "no_permission">, ProtocolErrorCode>> = {
  no_screen: "screen.no_screen",
  no_program: "screen.no_program",
  no_display: "screen.no_display",
  too_large: "screen.too_large",
  failed: "screen.failed",
};

const extensions: Readonly<Record<ScreenShot["contentType"], string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
};

// Saves one screenshot in the agent's workspace under `media/screen/<date>/`, named by fresh bytes.
async function saveShot(
  options: ScreenHandlerOptions & { readonly files: Pick<MachineFiles, "write"> },
  shot: ScreenShot,
  signal: AbortSignal,
): Promise<Result<ScreenShotView, ProtocolErrorCode>> {
  const { files, clock, random } = options;
  if (shot.bytes.byteLength > maxImageBytes) {
    return err("screen.too_large");
  }
  const id = Buffer.from(random.bytes(8)).toString("hex");
  const day = new Date(clock.now()).toISOString().slice(0, 10);
  const relative = `media/screen/${day}/${id}.${extensions[shot.contentType]}`;
  const written = await files.write(relative, shot.bytes, {
    signal,
    workspaceOnly: true,
    createOnly: true,
  });
  if (!written.ok) {
    return err("file.unwritable");
  }
  const display = shot.display === undefined ? {} : { display: shot.display };
  const { contentType } = shot;
  return ok({ path: written.value, contentType, bytes: shot.bytes.byteLength, ...display });
}

async function saveShots(
  options: ScreenHandlerOptions & { readonly files: Pick<MachineFiles, "write"> },
  shots: readonly ScreenShot[],
  signal: AbortSignal,
): Promise<Result<readonly ScreenShotView[], ProtocolErrorCode>> {
  const views: ScreenShotView[] = [];
  for (const shot of shots.slice(0, maxScreenShots)) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one write at a time, in display order
    const saved = await saveShot(options, shot, signal);
    if (!saved.ok) {
      return saved;
    }
    views.push(saved.value);
  }
  return ok(views);
}

/**
 * Creates the handler of `screen/capture` (decision 0406). It answers only the runtime the engine
 * runs now. It takes the screen, every display or the one asked, and saves each shot in the
 * workspace under `media/screen/<date>/`, answering their paths. When the OS has not allowed
 * binference to record the screen, it answers no shot and names the program the owner allows.
 */
export function createScreenHandlers(options: ScreenHandlerOptions): ScreenHandlers {
  return {
    "screen/capture": async (call) => {
      if (!options.turns.isRuntime(call.caller.credential)) {
        return err("auth.scope");
      }
      const { screen, files } = options;
      if (screen === undefined || files === undefined) {
        return err(screen === undefined ? "screen.no_screen" : "file.unwritable");
      }
      const { display } = call.args;
      const request = display === undefined ? {} : { display };
      const taken = await screen.capture(request, { signal: call.signal });
      if (!taken.ok) {
        return taken.error === "no_permission"
          ? ok({ shots: [], blocked: { program: screen.program } })
          : err(refusalCodes[taken.error]);
      }
      const saved = await saveShots({ ...options, files }, taken.value, call.signal);
      return saved.ok ? ok({ shots: saved.value }) : saved;
    },
  };
}
