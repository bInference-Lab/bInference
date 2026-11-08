import { join } from "node:path";
import { BinferenceError } from "@binference/core";
import { createSeededRandom } from "@binference/core/testing";
import { fakeVoiceBytes, localVoiceContract } from "@binference/engine/testing";
import { listFolderFiles, type ProgramExit, writePrivateFile } from "@binference/platform";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import { afterEach, describe, expect, it } from "vitest";
import { type LocalVoiceParts, localVoiceOf } from "./local-voice.js";

const folders: TempFolder[] = [];
const permissions = {
  restrictFolder: async () => Promise.resolve(),
  restrictFile: async () => Promise.resolve(),
  syncFolder: async () => Promise.resolve(),
};
const live = { signal: new AbortController().signal };

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

/** One program the voice ran: its name and its arguments. */
interface Ran {
  readonly file: string;
  readonly args: readonly string[];
}

// Stand-ins for `say` and `afconvert`: each writes its output file and exits with its code.
function standIns(ran: Ran[], codes: { readonly say?: number; readonly afconvert?: number } = {}) {
  const run: LocalVoiceParts["run"] = async (file, args, options): Promise<ProgramExit> => {
    ran.push({ file, args });
    const exitCode = file === "say" ? (codes.say ?? 0) : (codes.afconvert ?? 0);
    const out = file === "say" ? args[args.indexOf("-o") + 1] : args.at(-1);
    if (exitCode === 0 && out !== undefined) {
      const bytes = file === "say" ? new TextEncoder().encode("FORM") : fakeVoiceBytes("m4a");
      await writePrivateFile(out, bytes, { permissions, signal: options.signal });
    }
    return { exitCode, stdout: "", stderr: "" };
  };
  return run;
}

async function voiceOn(
  os: string,
  run: LocalVoiceParts["run"],
): Promise<{ readonly voice: ReturnType<typeof localVoiceOf>; readonly folder: string }> {
  const temp = await createTempFolder("bnf-say-");
  folders.push(temp);
  const folder = join(temp.path, "work");
  const parts = { os, folder, permissions, run, random: createSeededRandom(3) };
  return { voice: localVoiceOf(parts), folder };
}

describe("the machine's own voice", () => {
  it.each(
    localVoiceContract({
      create: async () => ({
        voice: (await voiceOn("darwin", standIns([]))).voice,
        mute: (await voiceOn("linux", standIns([]))).voice,
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("speaks with say into AIFF, makes an M4A with afconvert, and leaves no file behind", async () => {
    const ran: Ran[] = [];
    const { voice, folder } = await voiceOn("darwin", standIns(ran));
    const spoken = await voice.speak({ text: "-rate 900", voice: "Samantha" }, live);
    expect(spoken.ok).toBe(true);
    expect(ran.map((each) => each.file)).toStrictEqual(["say", "afconvert"]);
    const [say, convert] = ran;
    expect(say?.args.slice(0, 2)).toStrictEqual(["-v", "Samantha"]);
    expect(say?.args.slice(-2)).toStrictEqual(["--", "-rate 900"]);
    expect(convert?.args.slice(0, 4)).toStrictEqual(["-f", "m4af", "-d", "aac"]);
    expect(await listFolderFiles(folder, live.signal)).toStrictEqual([]);
  });

  it("answers failed when say or afconvert fails, or a program cannot start", async () => {
    const saying = await voiceOn("darwin", standIns([], { say: 1 }));
    expect(await saying.voice.speak({ text: "Hi." }, live)).toStrictEqual({
      ok: false,
      error: "failed",
    });
    const converting = await voiceOn("darwin", standIns([], { afconvert: 1 }));
    expect(await converting.voice.speak({ text: "Hi." }, live)).toStrictEqual({
      ok: false,
      error: "failed",
    });
    const missing = await voiceOn("darwin", async () =>
      Promise.reject(new BinferenceError({ code: "platform.command_failed", message: "No say." })),
    );
    expect(await missing.voice.speak({ text: "Hi." }, live)).toStrictEqual({
      ok: false,
      error: "failed",
    });
    const silent = await voiceOn("darwin", async () =>
      Promise.resolve({ exitCode: 0, stdout: "", stderr: "" }),
    );
    expect(await silent.voice.speak({ text: "Hi." }, live)).toStrictEqual({
      ok: false,
      error: "failed",
    });
  });
});
