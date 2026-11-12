import assert from "node:assert/strict";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { BinferenceError } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import type { CommandWall } from "../ports.js";
import { runCommandToExit } from "../run-command.js";

/** An adapter under test, with a file inside the wall and one outside it to read. */
export interface CommandWallSubject {
  readonly wall: CommandWall;
  /** An existing file under a walled path, which a command must not be able to read. */
  readonly deniedFile: string;
  /** What `deniedFile` holds, which a command must never see. */
  readonly deniedContent: string;
  /** An existing file outside the wall, which a command may read. */
  readonly allowedFile: string;
  /** What `allowedFile` holds. */
  readonly allowedContent: string;
  /** The reader to wrap, such as `/bin/cat`, which prints the file it is given. */
  readonly reader: string;
  /** The linker to wrap, such as `/bin/ln`, which makes a hard link with `ln <file> <link>`. */
  readonly linker: string;
  /** An existing folder the wall leaves open inside the walled path, such as the workspace. */
  readonly openFolder: string;
}

/** Makes subjects, and says whether this adapter walls a command on the OS running the test. */
export interface CommandWallHarness {
  create(): Promise<CommandWallSubject>;
  /** False for an adapter that has no mechanism on this OS and answers `none`. */
  readonly walls: boolean;
}

const signal = (): AbortSignal => AbortSignal.timeout(15_000);

// The one check of an adapter with no mechanism on this OS.
function noWallChecks(harness: CommandWallHarness): readonly ContractCheck[] {
  return [
    {
      name: "answers none and refuses to wrap a command where it has no mechanism",
      run: async () => {
        const { wall } = await harness.create();
        assert.equal((await wall.check(signal())).kind, "none");
        assert.equal(wall.state.kind, "none");
        assert.throws(
          () => wall.wrap({ file: "/bin/echo", args: [] }),
          (error: Error) => error instanceof BinferenceError && error.code === "platform.no_wall",
        );
      },
    },
  ];
}

// A subject whose wall a check found holding, so it wraps a command.
async function checked(harness: CommandWallHarness): Promise<CommandWallSubject> {
  const subject = await harness.create();
  assert.equal((await subject.wall.check(signal())).kind, "held");
  return subject;
}

/** The contract every `CommandWall` adapter passes. */
export function commandWallContract(harness: CommandWallHarness): readonly ContractCheck[] {
  if (!harness.walls) {
    return noWallChecks(harness);
  }
  return [
    {
      name: "holds once checked, and answers the same at the next check",
      run: async () => {
        const { wall } = await checked(harness);
        assert.deepEqual(await wall.check(signal()), wall.state);
        assert.equal(wall.state.kind, "held");
      },
    },
    {
      name: "runs a command and lets it read a file outside the wall",
      run: async () => {
        const { wall, reader, allowedFile, allowedContent } = await checked(harness);
        const wrapped = wall.wrap({ file: reader, args: [allowedFile] });
        const exit = await runCommandToExit(wrapped.file, wrapped.args, signal());
        assert.equal(exit.exitCode, 0);
        assert.equal(exit.stdout, allowedContent);
      },
    },
    {
      name: "keeps a command from reading a walled file's contents",
      run: async () => {
        const { wall, reader, deniedFile, deniedContent } = await checked(harness);
        const wrapped = wall.wrap({ file: reader, args: [deniedFile] });
        // A wall may deny the read outright (an error) or leave an empty file in its place; either
        // way the command never sees what the file held.
        const exit = await runCommandToExit(wrapped.file, wrapped.args, signal()).catch(() => ({
          stdout: "",
        }));
        assert.ok(!exit.stdout.includes(deniedContent));
      },
    },
    {
      name: "keeps a command from making a hard link to a walled file in an open folder",
      run: async () => {
        const { wall, linker, deniedFile, openFolder } = await checked(harness);
        const link = join(openFolder, "linked");
        const wrapped = wall.wrap({ file: linker, args: [deniedFile, link] });
        // The file tools read an open folder as the engine, which no wall holds, so a hard link
        // there would reach a walled file by a real path inside the open folder (decision 0386).
        await runCommandToExit(wrapped.file, wrapped.args, signal()).catch(() => undefined);
        const made = await lstat(link).catch(() => undefined);
        assert.ok(made === undefined || made.ino !== (await lstat(deniedFile)).ino);
      },
    },
  ];
}
