import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

/**
 * Whether a stand-in program runs on this OS. On Windows its launcher is a `.cmd` file, which
 * Node starts only through a shell, so tests that need one skip Windows.
 */
export const standInProgramsRun: boolean = process.platform !== "win32";

/**
 * Writes a program named `name` into `folder` that runs `script`, an ES module, with this Node: a
 * test puts the folder on PATH so a command such as `claude` runs the script in place of the real
 * program. The launcher is a shell script on macOS and Linux and a `.cmd` file on Windows.
 */
export async function writeStandInProgram(
  folder: string,
  name: string,
  script: string,
): Promise<void> {
  const file = join(folder, `${name}.mjs`);
  await writeFile(file, script);
  const node = JSON.stringify(process.execPath);
  if (standInProgramsRun) {
    await writeFile(join(folder, name), `#!/bin/sh\nexec ${node} "${file}" "$@"\n`, {
      mode: 0o755,
    });
    return;
  }
  await writeFile(join(folder, `${name}.cmd`), `@${node} "${file}" %*\r\n`);
}
