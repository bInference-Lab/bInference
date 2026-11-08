import { join } from "node:path";
import { err } from "@binference/core";
import type { ScreenCapture } from "../ports.js";
import type { ScreenRefusal } from "../screen-shot.js";
import {
  inWorkFolder,
  type ScreenCaptureParts,
  type ShotStep,
  takeWholeShot,
  type WholeShot,
} from "../screen-shots.js";

/** The screenshot programs binference runs on Linux, in the order it looks for them. */
export const linuxScreenPrograms: readonly string[] = ["grim", "gnome-screenshot", "scrot"];

/** How one program takes the whole screen as PNG, and, where it can, again as JPEG. */
interface LinuxProgram {
  readonly png: (out: string, display: number | undefined) => readonly string[];
  readonly jpeg?: (out: string, display: number | undefined) => readonly string[];
  /** Whether it can take one display by its number. */
  readonly picksDisplay: boolean;
}

// grim (Wayland) and scrot (an X session) write JPEG at a quality; gnome-screenshot writes PNG alone. Only
// scrot picks a monitor by number, from 0.
const programs: Readonly<Record<string, LinuxProgram>> = {
  grim: {
    png: (out) => ["-t", "png", out],
    jpeg: (out) => ["-t", "jpeg", "-q", "70", out],
    picksDisplay: false,
  },
  "gnome-screenshot": { png: (out) => ["-f", out], picksDisplay: false },
  scrot: {
    png: (out, display) => [...monitorOf(display), out],
    jpeg: (out, display) => [...monitorOf(display), "-q", "70", out],
    picksDisplay: true,
  },
};

function monitorOf(display: number | undefined): readonly string[] {
  return display === undefined ? [] : ["-M", String(display - 1)];
}

// The first screenshot program installed, by its path, with how it runs.
async function foundProgram(
  parts: ScreenCaptureParts,
): Promise<{ readonly path: string; readonly program: LinuxProgram } | undefined> {
  for (const name of linuxScreenPrograms) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- the first found wins, in order
    const path = await parts.findProgram(name);
    const program = programs[name];
    if (path !== undefined && program !== undefined) {
      return { path, program };
    }
  }
  return undefined;
}

// The program's runs for one shot: PNG first, then JPEG where it writes one. A failed run that
// named a display is read as a display scrot does not have.
function wholeShotOf(found: {
  readonly path: string;
  readonly program: LinuxProgram;
  readonly folder: string;
  readonly display: number | undefined;
}): WholeShot {
  const { path, program, folder, display } = found;
  const out = join(folder, "screen.png");
  const jpeg = join(folder, "screen.jpg");
  const first: ShotStep = {
    file: path,
    args: program.png(out, display),
    out,
    contentType: "image/png",
  };
  const smaller: readonly ShotStep[] =
    program.jpeg === undefined
      ? []
      : [{ file: path, args: program.jpeg(jpeg, display), out: jpeg, contentType: "image/jpeg" }];
  const failure = (): ScreenRefusal => (display === undefined ? "failed" : "no_display");
  return { first, smaller, display, failure };
}

/**
 * The screen on Linux (decision 0406): with a desktop session, the first of `grim`,
 * `gnome-screenshot` and `scrot` installed takes one PNG of every display; only `scrot` takes one
 * display by its number. A shot over the limit is taken again as JPEG where the program can. No
 * desktop is `no_screen`, and none of the three installed `no_program`.
 */
export function createLinuxScreenCapture(parts: ScreenCaptureParts): ScreenCapture {
  return {
    program: parts.program,
    capture: async (request, { signal }) => {
      signal.throwIfAborted();
      if (!parts.hasScreen) {
        return err("no_screen");
      }
      const found = await foundProgram(parts);
      if (found === undefined) {
        return err("no_program");
      }
      if (request.display !== undefined && !found.program.picksDisplay) {
        return err("no_display");
      }
      return inWorkFolder(parts, signal, async (folder) =>
        takeWholeShot(parts, wholeShotOf({ ...found, folder, display: request.display }), signal),
      );
    },
  };
}
