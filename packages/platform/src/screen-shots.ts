import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { err, ok, type Result } from "@binference/core";
import { removePath } from "./move-path.js";
import type { FilePermissions } from "./ports.js";
import { ensurePrivateFolder } from "./private-files.js";
import { readFileBytes } from "./read-file-bytes.js";
import type { ProgramExit, RunWithinOptions } from "./run-command.js";
import type { ScreenRefusal, ScreenShot } from "./screen-shot.js";

/** Runs an OS program with an argument array, never a shell: `runCommandWithin`, or a test's own. */
export type RunScreenProgram = (
  file: string,
  args: readonly string[],
  options: RunWithinOptions,
) => Promise<ProgramExit>;

/** What a screenshot is taken with on this machine, as the composition root gives it. */
export interface ScreenCaptureOptions {
  /** Where each capture works, in a folder of its own that is removed after it. */
  readonly folder: string;
  readonly permissions: FilePermissions;
  /** The most bytes a shot may hold; a larger one is made smaller, else refused. */
  readonly maxBytes: number;
  readonly run: RunScreenProgram;
  /**
   * The program binference runs as, which the OS asks the owner to allow to record the screen:
   * Node's own path for the background service.
   */
  readonly program: string;
  /** The absolute path of a program by its name, or `undefined` when none is installed. */
  readonly findProgram: (name: string) => Promise<string | undefined>;
}

/** A capture's options with whether this machine shows a screen, which the platform knows. */
export interface ScreenCaptureParts extends ScreenCaptureOptions {
  readonly hasScreen: boolean;
}

/** How long each screenshot program may run, so a capture fits the engine's 30 seconds a call. */
export const screenProgramMs = 8_000;

/** One run of a program that writes a shot's file. */
export interface ShotStep {
  readonly file: string;
  readonly args: readonly string[];
  /** Variables the program gets on top of the engine's environment. */
  readonly env?: Readonly<Record<string, string>>;
  /** The file it writes. */
  readonly out: string;
  readonly contentType: ScreenShot["contentType"];
}

/** Runs one step under the screenshot programs' time limit, answering how it ended. */
async function runStep(
  parts: Pick<ScreenCaptureParts, "run">,
  step: ShotStep,
  signal: AbortSignal,
): Promise<ProgramExit> {
  const env = step.env === undefined ? {} : { env: step.env };
  return parts.run(step.file, step.args, { signal, timeoutMs: screenProgramMs, ...env });
}

// The bytes of a file a step wrote: `too_large` past the limit, `failed` when none is there.
async function readShot(
  parts: Pick<ScreenCaptureParts, "maxBytes">,
  out: string,
  signal: AbortSignal,
): Promise<Result<Uint8Array, "too_large" | "failed">> {
  const read = await readFileBytes(out, { maxBytes: parts.maxBytes, signal });
  if (read.ok) {
    return read.value.byteLength === 0 ? err("failed") : read;
  }
  return err(read.error === "too_large" ? "too_large" : "failed");
}

/** A shot a capture made: the file it wrote, its type, and the display it shows. */
export interface MadeShot {
  readonly out: string;
  readonly contentType: ScreenShot["contentType"];
  readonly display?: number;
}

/**
 * The first file of a shot that fits the byte limit: the one already made, then what each of
 * `smaller` writes, in order, such as the same shot as JPEG. A step that fails is `failed`; one
 * still too large after the last is `too_large`.
 */
export async function fittingShot(
  parts: Pick<ScreenCaptureParts, "maxBytes" | "run">,
  shot: { readonly made: MadeShot; readonly smaller: readonly ShotStep[] },
  signal: AbortSignal,
): Promise<Result<ScreenShot, ScreenRefusal>> {
  const { made, smaller } = shot;
  const display = made.display === undefined ? {} : { display: made.display };
  let read = await readShot(parts, made.out, signal);
  let { contentType } = made;
  for (const step of smaller) {
    if (read.ok || read.error === "failed") {
      break;
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- each step only once the last was too large
    const ran = await runStep(parts, step, signal);
    // oxlint-disable-next-line eslint/no-await-in-loop -- read what this step wrote before the next
    read = ran.exitCode === 0 ? await readShot(parts, step.out, signal) : err("failed");
    ({ contentType } = step);
  }
  return read.ok ? ok({ bytes: read.value, contentType, ...display }) : err(read.error);
}

/** One shot of the whole screen, or of one display: the run that takes it, and smaller ones. */
export interface WholeShot {
  readonly first: ShotStep;
  readonly smaller: readonly ShotStep[];
  readonly display: number | undefined;
  /** Why the first run failed, from its exit. */
  readonly failure: (exit: ProgramExit) => ScreenRefusal;
}

/**
 * Takes one shot with `first`, then fits it as {@link fittingShot} does. A first run that exits
 * with any code but 0 is refused as `failure` reads it.
 */
export async function takeWholeShot(
  parts: Pick<ScreenCaptureParts, "maxBytes" | "run">,
  shot: WholeShot,
  signal: AbortSignal,
): Promise<Result<readonly ScreenShot[], ScreenRefusal>> {
  const { first, smaller, display } = shot;
  const ran = await runStep(parts, first, signal);
  if (ran.exitCode !== 0) {
    return err(shot.failure(ran));
  }
  const made = {
    out: first.out,
    contentType: first.contentType,
    ...(display === undefined ? {} : { display }),
  };
  const fitted = await fittingShot(parts, { made, smaller }, signal);
  return fitted.ok ? ok([fitted.value]) : fitted;
}

/**
 * Runs a capture in a fresh folder under `parts.folder` that only the owner reads, and removes it
 * after. A program that cannot start, or a folder that cannot be made, is `failed`; a signal that
 * aborts rejects with its reason.
 */
export async function inWorkFolder<T>(
  parts: Pick<ScreenCaptureParts, "folder" | "permissions">,
  signal: AbortSignal,
  work: (folder: string) => Promise<Result<T, ScreenRefusal>>,
): Promise<Result<T, ScreenRefusal>> {
  signal.throwIfAborted();
  let folder: string | undefined;
  try {
    await ensurePrivateFolder(parts.folder, { permissions: parts.permissions, signal });
    folder = await mkdtemp(join(parts.folder, "shot-"));
    return await work(folder);
  } catch {
    signal.throwIfAborted();
    return err("failed");
  } finally {
    if (folder !== undefined) {
      await removePath(folder, AbortSignal.timeout(10_000)).catch(() => undefined);
    }
  }
}
