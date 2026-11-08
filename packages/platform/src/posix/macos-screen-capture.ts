import { join } from "node:path";
import { err, ok, type Result } from "@binference/core";
import type { ScreenCapture } from "../ports.js";
import type { ScreenRefusal, ScreenShot } from "../screen-shot.js";
import {
  fittingShot,
  inWorkFolder,
  type ScreenCaptureParts,
  screenProgramMs,
  type ShotStep,
} from "../screen-shots.js";

// The most displays one capture shows, one image each, as a look reads at most 4 images at once.
const mostDisplays = 4;

// Asks macOS whether the program binference runs as may record the screen, and asks the owner once
// when it may not, which lists the program under Screen Recording; then counts the displays. It
// prints `<allowed> <displays>`. The script is fixed: nothing of a request reaches it.
const preflight = [
  'ObjC.import("AppKit");',
  'ObjC.bindFunction("CGPreflightScreenCaptureAccess", ["bool", []]);',
  'ObjC.bindFunction("CGRequestScreenCaptureAccess", ["bool", []]);',
  "const allowed = $.CGPreflightScreenCaptureAccess() || $.CGRequestScreenCaptureAccess();",
  "`${allowed} ${$.NSScreen.screens.count}`",
].join("\n");

/** What the preflight read: whether recording is allowed, and how many displays there are. */
interface Preflight {
  readonly allowed: boolean | undefined;
  readonly displays: number | undefined;
}

// What the preflight answered; an answer it cannot read leaves both unknown, and the capture says.
async function preflightOf(parts: ScreenCaptureParts, signal: AbortSignal): Promise<Preflight> {
  const args = ["-l", "JavaScript", "-e", preflight];
  const ran = await parts
    .run("osascript", args, { signal, timeoutMs: screenProgramMs })
    .catch(() => undefined);
  const answer = /^(true|false) (\d+)$/u.exec(ran?.exitCode === 0 ? ran.stdout.trim() : "");
  if (answer === null) {
    return { allowed: undefined, displays: undefined };
  }
  return { allowed: answer[1] === "true", displays: Number(answer[2]) };
}

// The displays to capture: the one asked, or each up to four, the main display first.
function displaysOf(request: { readonly display?: number }, found: number | undefined) {
  if (request.display !== undefined) {
    return [request.display];
  }
  return Array.from({ length: Math.min(found ?? 1, mostDisplays) }, (_, at) => at + 1);
}

const asJpeg = { contentType: "image/jpeg" } as const;

// The same shot as JPEG, then as JPEG at most 2,560 pixels on its longer side, each made by sips.
function smallerOf(png: string): readonly ShotStep[] {
  const jpeg = ["-s", "format", "jpeg", "-s", "formatOptions", "70"];
  const fit = `${png}.fit.jpg`;
  return [
    { file: "sips", args: [...jpeg, png, "--out", `${png}.jpg`], out: `${png}.jpg`, ...asJpeg },
    { file: "sips", args: ["-Z", "2560", ...jpeg, png, "--out", fit], out: fit, ...asJpeg },
  ];
}

// Why screencapture failed, from what it wrote: a display it does not have, or no permission.
function failureOf(stderr: string): ScreenRefusal {
  if (/invalid display/iu.test(stderr)) {
    return "no_display";
  }
  return /could not create image/iu.test(stderr) ? "no_permission" : "failed";
}

async function shoot(
  parts: ScreenCaptureParts,
  call: { readonly folder: string; readonly displays: readonly number[]; readonly one: boolean },
  signal: AbortSignal,
): Promise<Result<readonly ScreenShot[], ScreenRefusal>> {
  const { folder, displays, one } = call;
  const files = displays.map((display) => join(folder, `display-${String(display)}.png`));
  // -x: no sound; -C: the pointer too; -D: one display; one file per display otherwise.
  const pick = one ? ["-D", String(displays[0])] : [];
  const capture = ["-x", "-C", ...pick, "-t", "png", ...files];
  const ran = await parts.run("screencapture", capture, { signal, timeoutMs: screenProgramMs });
  if (ran.exitCode !== 0) {
    return err(failureOf(ran.stderr));
  }
  const shots: ScreenShot[] = [];
  for (const [at, out] of files.entries()) {
    const made = { out, contentType: "image/png" as const, display: displays[at] ?? at + 1 };
    // oxlint-disable-next-line eslint/no-await-in-loop -- one shot in memory to fit at a time
    const shot = await fittingShot(parts, { made, smaller: smallerOf(out) }, signal);
    if (!shot.ok) {
      return shot;
    }
    shots.push(shot.value);
  }
  return ok(shots);
}

/**
 * The screen on macOS (decision 0406): a preflight asks whether the program binference runs as may
 * record the screen, and asks the owner once when it may not; then `screencapture -x` takes one PNG
 * per display, up to four, or the one display asked, with the pointer and no sound. A shot over the
 * limit is made JPEG by `sips`, then smaller. A refused permission means the owner allows
 * `parts.program` under System Settings, Privacy and Security, Screen Recording.
 */
export function createMacosScreenCapture(parts: ScreenCaptureParts): ScreenCapture {
  return {
    program: parts.program,
    capture: async (request, { signal }) =>
      inWorkFolder(parts, signal, async (folder) => {
        const { allowed, displays: found } = await preflightOf(parts, signal);
        if (allowed === false) {
          return err("no_permission");
        }
        if (request.display !== undefined && found !== undefined && request.display > found) {
          return err("no_display");
        }
        const displays = displaysOf(request, found);
        return shoot(parts, { folder, displays, one: request.display !== undefined }, signal);
      }),
  };
}
