import { describe, expect, it } from "vitest";
import { runCommand } from "./run-command.js";

describe("run command", () => {
  it("returns what the program wrote to standard output", async () => {
    await expect(
      runCommand(
        process.execPath,
        ["-e", "process.stdout.write('ready')"],
        new AbortController().signal,
      ),
    ).resolves.toBe("ready");
  });

  it("names the program that failed", async () => {
    await expect(
      runCommand(process.execPath, ["-e", "process.exit(3)"], new AbortController().signal),
    ).rejects.toMatchObject({
      code: "platform.command_failed",
      details: { file: process.execPath },
    });
  });

  it("starts nothing on an aborted signal", async () => {
    await expect(
      runCommand(process.execPath, ["-e", ""], AbortSignal.abort(new Error("stopped"))),
    ).rejects.toMatchObject({ code: "platform.command_failed" });
  });
});
