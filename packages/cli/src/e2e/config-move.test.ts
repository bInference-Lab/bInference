import { join } from "node:path";
import { listFolderFiles, readTextFile, writePrivateFile } from "@binference/platform";
import type { TempFolder } from "@binference/platform/testing";
import { afterEach, describe, expect, it } from "vitest";
import { currentConfigVersion } from "../config/migrations/config-migrations.js";
import { initFlags, newInitMachine, runOn } from "./init-fixtures.js";
import { noPermissions } from "./test-host.js";

const slow = { timeout: 60_000 };
const folders: TempFolder[] = [];
const signal = (): AbortSignal => new AbortController().signal;

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

async function textOf(file: string): Promise<string> {
  const read = await readTextFile(file, signal());
  return read.ok ? read.value : "";
}

describe("binference check --fix on an older config file", () => {
  it("takes a sealed backup before it moves the file of an install", slow, async () => {
    const machine = await newInitMachine(folders);
    expect((await runOn(machine, ["init", "--yes", ...initFlags(machine)])).code).toBe(0);
    const file = join(machine.folder, "config.json5");
    const text = await textOf(file);
    const current = `version: ${String(currentConfigVersion)},`;
    const older = `version: ${String(currentConfigVersion - 1)},`;
    const files = { permissions: noPermissions, signal: signal() };
    await writePrivateFile(file, text.replace(current, older), files);

    const fixed = await runOn(machine, ["check", "--fix"]);
    const backups = await listFolderFiles(join(machine.folder, "backups"), signal());

    expect(text).toContain(current);
    expect(fixed.stdout).toMatch(/config\.json5 moved from version \d+ to version \d+; backup /);
    expect(backups.filter((name) => name.includes("before_migration"))).toHaveLength(1);
    await expect(textOf(file)).resolves.toBe(text);
  });
});
