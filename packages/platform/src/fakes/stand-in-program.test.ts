import { afterEach, describe, expect, it, vi } from "vitest";
import { runCommandToExit } from "../run-command.js";
import { standInProgramsRun, writeStandInProgram } from "./stand-in-program.js";
import { createTempFolder, type TempFolder } from "./temp-folder.js";

const folders: TempFolder[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

describe.runIf(standInProgramsRun)("writeStandInProgram", () => {
  it("runs the script in place of a program found on PATH, with its arguments", async () => {
    const folder = await createTempFolder("bnf-");
    folders.push(folder);
    await writeStandInProgram(
      folder.path,
      "fake-tool",
      "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n",
    );
    vi.stubEnv("PATH", folder.path);
    const exit = await runCommandToExit("fake-tool", ["mcp", "a b"], AbortSignal.timeout(10_000));
    expect(exit).toMatchObject({ exitCode: 0, stdout: '["mcp","a b"]' });
  });
});
