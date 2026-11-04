import { join } from "node:path";
import {
  createPlatform,
  readTextFile,
  resolveStateFolder,
  writePrivateFile,
} from "@binference/platform";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import { afterEach, describe, expect, it } from "vitest";
import { noPermissions } from "../e2e/test-host.js";
import { copyKeptState, keepTarball, removeKeptFiles, restoreKeptState } from "./kept-files.js";

const folders: TempFolder[] = [];
const live = (): AbortSignal => new AbortController().signal;

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

async function runOn(permissions = noPermissions) {
  const folder = await createTempFolder("kept-files-");
  folders.push(folder);
  const stateFolder = resolveStateFolder({ binferenceHome: folder.path });
  return { stateFolder, permissions, signal: live() };
}

async function textOf(file: string): Promise<string | undefined> {
  const read = await readTextFile(file, live());
  return read.ok ? read.value : undefined;
}

describe("the files an update keeps", () => {
  it("puts each database back with exactly the log it was copied with, and the config", async () => {
    const run = await runOn();
    const { engineDatabase, agentDatabase, configFile } = run.stateFolder;
    await writePrivateFile(engineDatabase, "engine before", run);
    await writePrivateFile(`${engineDatabase}-wal`, "log before", run);
    await writePrivateFile(agentDatabase, "agent before", run);
    await writePrivateFile(configFile, "{ version: 12 }", run);
    await copyKeptState(run);
    await writePrivateFile(engineDatabase, "engine after", run);
    await writePrivateFile(`${engineDatabase}-shm`, "index after", run);
    await writePrivateFile(agentDatabase, "agent after", run);
    await writePrivateFile(`${agentDatabase}-wal`, "log after", run);
    await writePrivateFile(configFile, "{ version: 13 }", run);

    await expect(restoreKeptState(run)).resolves.toBe("restored");
    expect(
      await Promise.all(
        [
          engineDatabase,
          `${engineDatabase}-wal`,
          `${engineDatabase}-shm`,
          agentDatabase,
          `${agentDatabase}-wal`,
          configFile,
        ].map(textOf),
      ),
    ).toStrictEqual([
      "engine before",
      "log before",
      undefined,
      "agent before",
      undefined,
      "{ version: 12 }",
    ]);
  });

  it("removes a database the update found missing, so the old version makes its own", async () => {
    const run = await runOn();
    await writePrivateFile(run.stateFolder.engineDatabase, "engine before", run);
    await copyKeptState(run);
    await writePrivateFile(run.stateFolder.agentDatabase, "made by the new version", run);

    await expect(restoreKeptState(run)).resolves.toBe("restored");
    await expect(textOf(run.stateFolder.agentDatabase)).resolves.toBeUndefined();
  });

  it("changes nothing when a copy is not the file it made, or the copies are gone", async () => {
    const run = await runOn();
    const copy = join(run.stateFolder.root, "updates", "rollback", "engine.sqlite");
    await writePrivateFile(run.stateFolder.engineDatabase, "engine before", run);
    await copyKeptState(run);
    await writePrivateFile(run.stateFolder.engineDatabase, "engine after", run);
    await writePrivateFile(copy, "changed on disk", run);
    const changed = await restoreKeptState(run);
    await removeKeptFiles(run);
    const missing = await restoreKeptState(run);

    expect([changed, missing]).toStrictEqual(["changed", "missing"]);
    await expect(textOf(run.stateFolder.engineDatabase)).resolves.toBe("engine after");
  });

  it("removes every kept tarball and copy, and only those", async () => {
    const run = await runOn();
    const bytes = new TextEncoder().encode("tarball");
    const kept = [
      await keepTarball(run, { version: "2026.11.0", bytes }),
      await keepTarball(run, { version: "2026.12.0", bytes }),
    ];
    await writePrivateFile(run.stateFolder.engineDatabase, "engine", run);
    await copyKeptState(run);
    await removeKeptFiles(run);

    expect([
      ...(await Promise.all(kept.map(textOf))),
      await textOf(join(run.stateFolder.root, "updates", "rollback", "engine.sqlite")),
      await textOf(run.stateFolder.engineDatabase),
    ]).toStrictEqual([undefined, undefined, undefined, "engine"]);
  });

  it("keeps the copies and tarballs owner-only", async () => {
    const platform = createPlatform();
    const run = await runOn(platform.permissions);
    const bytes = new TextEncoder().encode("tarball");
    const tarball = await keepTarball(run, { version: "2026.11.0", bytes });
    await writePrivateFile(run.stateFolder.engineDatabase, "engine", run);
    await copyKeptState(run);
    const updates = join(run.stateFolder.root, "updates");
    const paths = [updates, join(updates, "rollback"), join(updates, "rollback", "engine.sqlite")];

    const states = await Promise.all(
      [tarball, ...paths].map(async (path) => platform.access.read(path, live())),
    );

    // Windows reads no access list here and answers `unknown`; nothing may be open or missing.
    expect(states).not.toContain("open");
    expect(states).not.toContain("missing");
  });
});
