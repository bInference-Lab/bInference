import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { CommandRunner } from "../shell/ports.js";

/** An adapter under test, a folder that exists, and a command that prints `hello` and exits 0. */
export interface CommandRunnerSubject {
  readonly runner: CommandRunner;
  readonly folder: string;
  readonly printsHello: string;
}

/** Makes a fresh {@link CommandRunnerSubject} for each check. */
export interface CommandRunnerHarness {
  create(): Promise<CommandRunnerSubject>;
}

/** The contract every `CommandRunner` adapter passes. */
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
  ];
}
