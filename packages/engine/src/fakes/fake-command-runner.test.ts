import { describe, expect, it } from "vitest";
import { commandRunnerContract } from "../contracts/command-runner-contract.js";
import { createFakeCommandRunner } from "./fake-command-runner.js";

describe("the fake command runner", () => {
  it.each(
    commandRunnerContract({
      create: async () =>
        Promise.resolve({
          runner: createFakeCommandRunner({
            script: { "say hello": { kind: "ends", output: "hello\n", exitCode: 0 } },
          }),
          folder: "/home/owner",
          printsHello: "say hello",
        }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
