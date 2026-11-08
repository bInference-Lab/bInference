import { join } from "node:path";
import { err, ok, type Random } from "@binference/core";
import type { LocalVoice, LocalVoiceRefusal } from "@binference/engine/shell";
import {
  ensurePrivateFolder,
  type FilePermissions,
  type ProgramExit,
  readFileBytes,
  removePath,
  type RunWithinOptions,
} from "@binference/platform";
import { maxVoiceBytes } from "@binference/protocol";

/** What the machine's own voice runs on. */
export interface LocalVoiceParts {
  /** Node's name for the OS: only `darwin` has a voice binference drives. */
  readonly os: string;
  /** The folder each request works in, in a folder of its own that is removed after it. */
  readonly folder: string;
  readonly permissions: FilePermissions;
  /** Runs an OS program with an argument array, never a shell. */
  readonly run: (
    file: string,
    args: readonly string[],
    options: RunWithinOptions,
  ) => Promise<ProgramExit>;
  readonly random: Random;
}

// How long each program may run: speaking 4,000 characters to a file takes well under a minute.
const programMs = 120_000;

// Speaks the words into an AIFF file with `say`, then makes it an M4A of AAC with `afconvert`.
async function spoken(
  parts: LocalVoiceParts,
  request: { readonly text: string; readonly voice?: string },
  call: { readonly work: string; readonly signal: AbortSignal },
): Promise<LocalVoiceRefusal | Uint8Array> {
  const { work, signal } = call;
  const aiff = join(work, "speech.aiff");
  const m4a = join(work, "speech.m4a");
  const voice = request.voice === undefined ? [] : ["-v", request.voice];
  // `--` ends the options, so words that start with a dash are spoken, never read as one.
  const said = await parts.run("say", [...voice, "-o", aiff, "--", request.text], {
    signal,
    timeoutMs: programMs,
  });
  if (said.exitCode !== 0) {
    return "failed";
  }
  const made = await parts.run("afconvert", ["-f", "m4af", "-d", "aac", aiff, m4a], {
    signal,
    timeoutMs: programMs,
  });
  if (made.exitCode !== 0) {
    return "failed";
  }
  const read = await readFileBytes(m4a, { maxBytes: maxVoiceBytes, signal });
  return read.ok ? read.value : "failed";
}

/**
 * The machine's own voice (decision 0405): on macOS, `say` speaks the words into an AIFF file and
 * `afconvert` makes it an M4A of AAC, each run with an argument array and a time limit in a
 * folder of its own under `folder`, removed after it; any other OS answers `unavailable`. A
 * program that fails, cannot start or runs past its limit is `failed`.
 */
export function localVoiceOf(parts: LocalVoiceParts): LocalVoice {
  return {
    speak: async (request, { signal }) => {
      signal.throwIfAborted();
      if (parts.os !== "darwin") {
        return err("unavailable");
      }
      const work = join(parts.folder, Buffer.from(parts.random.bytes(8)).toString("hex"));
      try {
        await ensurePrivateFolder(work, { permissions: parts.permissions, signal });
        const answer = await spoken(parts, request, { work, signal });
        return typeof answer === "string" ? err(answer) : ok(answer);
      } catch {
        signal.throwIfAborted();
        return err("failed");
      } finally {
        await removePath(work, AbortSignal.timeout(10_000)).catch(() => undefined);
      }
    },
  };
}
