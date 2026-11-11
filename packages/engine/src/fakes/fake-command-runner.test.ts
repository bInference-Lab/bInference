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
            missing: ["no-such-program-anywhere"],
          }),
          folder: "/home/owner",
          realFolder: "/home/owner",
          printsHello: "say hello",
          program: { name: "git", path: "/usr/bin/git" },
        }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
