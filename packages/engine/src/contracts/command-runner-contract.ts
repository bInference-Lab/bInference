import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { CommandRunner } from "../shell/ports.js";

/**
 * An adapter under test, a folder that exists with its real path, a command that prints `hello`
 * and exits 0, and a program on the runner's `PATH` with its real path.
 */
export interface CommandRunnerSubject {
  readonly runner: CommandRunner;
  readonly folder: string;
  readonly realFolder: string;
  readonly printsHello: string;
  readonly program: { readonly name: string; readonly path: string };
}

const live = { signal: new AbortController().signal };

function locateChecks(harness: CommandRunnerHarness): readonly ContractCheck[] {
  return [
    {
      name: "locates a folder and each program by its real path, and none it cannot find",
      run: async () => {
        const { runner, folder, realFolder, program } = await harness.create();
        const programs = [program.name, "no-such-program-anywhere", ""];
        assert.deepEqual(await runner.locate({ folder, programs }, live), {
          ok: true,
          value: { folder: realFolder, programs: [program.path, undefined, undefined] },
        });
      },
    },
    {
      name: "locates nothing in a folder that does not exist",
      run: async () => {
        const { runner, folder, program } = await harness.create();
        const where = { folder: `${folder}/no-such-folder-here`, programs: [program.name] };
        assert.deepEqual(await runner.locate(where, live), { ok: false, error: "folder_missing" });
      },
    },
  ];
}

/** Makes a fresh {@link CommandRunnerSubject} for each check. */
export interface CommandRunnerHarness {
  create(): Promise<CommandRunnerSubject>;
}

/**
 * The contract every `CommandRunner` adapter passes: it runs a command in its folder, refuses a
 * folder that does not exist, masks a private key block, and locates programs by real path.
 */
export function commandRunnerContract(harness: CommandRunnerHarness): readonly ContractCheck[] {
  return [
    {
      name: "runs a command in the folder it names and hands on its output",
      run: async () => {
        const { runner, folder, printsHello } = await harness.create();
        let output = "";
        const started = runner.start({ command: printsHello, folder, timeoutMs: 0 }, (text) => {
          output += text;
        });
        assert.ok(started.ok);
        assert.equal(started.value.folder, folder);
        const end = await started.value.ended;
        assert.equal(end.exitCode, 0);
        assert.ok(output.includes("hello"));
      },
    },
    {
      name: "starts nothing in a folder that does not exist",
      run: async () => {
        const { runner, folder, printsHello } = await harness.create();
        const missing = `${folder}/no-such-folder-here`;
        const started = runner.start(
          { command: printsHello, folder: missing, timeoutMs: 0 },
          () => undefined,
        );
        assert.deepEqual(started, { ok: false, error: "folder_missing" });
      },
    },
    {
      name: "hides a private key block from output",
      run: async () => {
        const { runner } = await harness.create();
        const block = "-----BEGIN PRIVATE KEY-----\nMIIEvQ\n-----END PRIVATE KEY-----";
        assert.ok(!runner.mask(`before\n${block}\nafter`).includes("MIIEvQ"));
      },
    },
    ...locateChecks(harness),
  ];
}
