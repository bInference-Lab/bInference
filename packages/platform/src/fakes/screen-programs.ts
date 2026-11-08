import { writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Result } from "@binference/core";
import type { ScreenCaptureHarness } from "../contracts/screen-capture-contract.js";
import type { ScreenCapture } from "../ports.js";
import { linuxScreenPrograms } from "../posix/linux-screen-capture.js";
import type { ProgramExit, RunWithinOptions } from "../run-command.js";
import type { ScreenRefusal, ScreenShot } from "../screen-shot.js";
import type { RunScreenProgram, ScreenCaptureParts } from "../screen-shots.js";
import { createTempFolder, type TempFolder } from "./temp-folder.js";

const folders: TempFolder[] = [];
const permissions = {
  restrictFolder: async () => Promise.resolve(),
  restrictFile: async () => Promise.resolve(),
  syncFolder: async () => Promise.resolve(),
};
const maxBytes = 1_000;

/** The program the stand-in captures name as the one the owner allows to record the screen. */
export const standInNode = "/usr/local/bin/node";

/** Removes the folders the captures of a test worked in. */
export async function removeScreenFolders(): Promise<void> {
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
}

/** One program a capture ran: its name, its arguments and the variables it added. */
export interface Ran {
  readonly file: string;
  readonly args: readonly string[];
  readonly env?: RunWithinOptions["env"];
}

/** How the stand-ins answer: the size of each PNG, the displays, and what fails. */
export interface Machine {
  readonly pngBytes?: number;
  readonly jpegBytes?: number;
  readonly displays?: number;
  readonly allowed?: string;
  readonly fails?: Readonly<Record<string, Partial<ProgramExit>>>;
}

// A PNG's first bytes, then zeros up to its size.
function png(bytes: number): Uint8Array {
  const image = new Uint8Array(4 + bytes);
  image.set([0x89, 0x50, 0x4e, 0x47]);
  return image;
}

// A JPEG's first bytes, then zeros up to its size.
function jpeg(bytes: number): Uint8Array {
  const image = new Uint8Array(4 + bytes);
  image.set([0xff, 0xd8, 0xff, 0xe0]);
  return image;
}

// The file a stand-in writes for its run, and whether it is JPEG.
function outsOf(run: Ran): readonly (readonly [string, boolean])[] {
  const name = basename(run.file);
  if (name === "screencapture") {
    return run.args.filter((arg) => arg.endsWith(".png")).map((out) => [out, false]);
  }
  if (name === "sips") {
    const out = run.args[run.args.indexOf("--out") + 1] ?? "";
    return [[out, true]];
  }
  if (name === "powershell.exe") {
    return [[run.env?.["SCREEN_FILE"] ?? "", run.env?.["SCREEN_FORMAT"] === "jpeg"]];
  }
  const out = run.args.at(-1) ?? "";
  return name === "osascript" ? [] : [[out, out.endsWith(".jpg")]];
}

// How a stand-in ends without writing: a failure the machine names, or a display it lacks.
function refusalOf(run: Ran, machine: Machine): ProgramExit | undefined {
  const failed = machine.fails?.[basename(run.file)];
  if (failed !== undefined) {
    return { exitCode: 1, stdout: "", stderr: "", ...failed };
  }
  const display = Number(run.env?.["SCREEN_DISPLAY"] ?? "0");
  return display > (machine.displays ?? 2) ? { exitCode: 3, stdout: "", stderr: "" } : undefined;
}

/** Stand-ins for every OS's screenshot programs: each writes its files and exits with its code. */
export function standIns(ran: Ran[], machine: Machine = {}): RunScreenProgram {
  return async (file, args, options): Promise<ProgramExit> => {
    const run = { file, args, ...(options.env === undefined ? {} : { env: options.env }) };
    ran.push(run);
    const refused = refusalOf(run, machine);
    if (refused !== undefined) {
      return refused;
    }
    for (const [out, isJpeg] of outsOf(run)) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one file after the other, as the OS writes
      await writeFile(out, isJpeg ? jpeg(machine.jpegBytes ?? 2) : png(machine.pngBytes ?? 100));
    }
    const stdout = `${machine.allowed ?? "true"} ${String(machine.displays ?? 2)}`;
    return { exitCode: 0, stdout: basename(file) === "osascript" ? stdout : "", stderr: "" };
  };
}

/** The shots a capture took, or none when it refused. */
export function shotsOf(
  result: Result<readonly ScreenShot[], ScreenRefusal>,
): readonly ScreenShot[] {
  return result.ok ? result.value : [];
}

/** An adapter of the screen, by its maker. */
export type Adapter = (parts: ScreenCaptureParts) => ScreenCapture;

/** What a test builds a capture with: the stand-ins, the programs found, and the screen. */
export interface Setup {
  readonly run: RunScreenProgram;
  readonly installed?: readonly string[];
  readonly hasScreen?: boolean;
}

/** A capture of `adapter` over stand-ins, in a fresh folder, and that folder. */
export async function captureOn(
  adapter: Adapter,
  setup: Setup,
): Promise<{ readonly capture: ScreenCapture; readonly folder: string }> {
  const temp = await createTempFolder("bnf-shot-");
  folders.push(temp);
  const folder = join(temp.path, "work");
  const installed = setup.installed ?? linuxScreenPrograms;
  const parts = {
    folder,
    permissions,
    maxBytes,
    run: setup.run,
    program: standInNode,
    findProgram: async (name: string) =>
      Promise.resolve(installed.includes(name) ? `/usr/bin/${name}` : undefined),
    hasScreen: setup.hasScreen ?? true,
  };
  return { capture: adapter(parts), folder };
}

/**
 * The contract harness of `adapter` over stand-ins, with the Linux programs `setup` names
 * installed, and whether it takes one display by its number.
 */
export function harnessOf(
  adapter: Adapter,
  setup: { readonly installed?: readonly string[]; readonly picksDisplay: boolean },
): ScreenCaptureHarness {
  return {
    create: async () => {
      const { capture, folder } = await captureOn(adapter, { ...setup, run: standIns([]) });
      const large = await captureOn(adapter, { ...setup, run: standIns([], { pngBytes: 5_000 }) });
      return { capture, large: large.capture, maxBytes, folder, picksDisplay: setup.picksDisplay };
    },
  };
}
