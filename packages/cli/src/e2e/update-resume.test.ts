import { removePath, resolveStateFolder, writePrivateFile } from "@binference/platform";
import type { TempFolder } from "@binference/platform/testing";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../program/run-cli.js";
import { copyKeptState, keptTarballOf } from "../updates/kept-files.js";
import { readUpdateState, type UpdateState, writeUpdateState } from "../updates/update-state.js";
import { hostWith, noPermissions } from "./test-host.js";
import {
  cli,
  cliAs,
  engineSchemaOf,
  isKept,
  lastJson,
  migrateEnginePastThisBuild,
  newer,
  running,
  setUpHome,
  startService,
  type UpdateHome,
  updateKeys,
} from "./update-fixtures.js";

const slow = { timeout: 120_000 };
const folders: TempFolder[] = [];
const homes: UpdateHome[] = [];
const live = (): AbortSignal => AbortSignal.timeout(20_000);

afterEach(async () => {
  await Promise.all(homes.splice(0).map(async (home) => home.services.logout()));
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

/** Where a killed update left the machine: the program on disk, its records and its record. */
interface KilledAt {
  /** The version npm left on disk, which the next `binference update` runs as. */
  readonly onDisk: string;
  /** Whether the new version's engine had migrated the records past the old version. */
  readonly migrated: boolean;
  readonly record: UpdateState["state"];
  /** Whether the old release's kept tarball is gone. */
  readonly isOldGone?: boolean;
}

// The state a run killed at that step leaves: the copies, both kept tarballs and the record,
// as the update writes them, with the engine stopped.
async function killedAt(
  at: KilledAt,
): Promise<{ readonly home: UpdateHome; readonly schema: number }> {
  const home = await setUpHome(folders, { check: "passes" });
  homes.push(home);
  const files = {
    stateFolder: resolveStateFolder({ binferenceHome: home.machine.folder }),
    permissions: noPermissions,
    signal: live(),
  };
  const root = home.machine.folder;
  await copyKeptState(files);
  await writePrivateFile(keptTarballOf(root, running), "the old release", files);
  await writePrivateFile(keptTarballOf(root, newer), "the new release", files);
  const versions = { from: running, to: newer };
  await writeUpdateState(root, { state: at.record, ...versions, backup: "bkp_before" }, files);
  const schema = await engineSchemaOf(home);
  if (at.migrated) {
    migrateEnginePastThisBuild(home);
  }
  if (at.isOldGone === true) {
    await removePath(keptTarballOf(root, running), files.signal);
  }
  home.installed.version = at.onDisk;
  return { home, schema };
}

// Runs the next `binference update` as the program on disk, then starts the engine as the owner
// is told to, and answers what each shows.
async function updateAgain(home: UpdateHome, onDisk: string) {
  const updated = await cliAs(home, onDisk, [
    "update",
    "--json",
    "--set",
    `engine.port=${home.port}`,
  ]);
  const started = await startService(home);
  const status = await cli(home, ["status", "--json"]);
  return { updated, started, status: lastJson(status.stdout) };
}

const checkingKills: readonly (KilledAt & { readonly step: string; readonly npmRuns: number })[] = [
  {
    step: "after the copies, before npm",
    npmRuns: 0,
    onDisk: running,
    migrated: false,
    record: "checking",
  },
  {
    step: "after npm installed the new version",
    npmRuns: 1,
    onDisk: newer,
    migrated: false,
    record: "checking",
  },
  {
    step: "after the new engine migrated the records",
    npmRuns: 1,
    onDisk: newer,
    migrated: true,
    record: "checking",
  },
  {
    step: "after npm put the old version back",
    npmRuns: 0,
    onDisk: running,
    migrated: true,
    record: "checking",
  },
];

describe("binference update after a run that was killed", () => {
  it.each(checkingKills)(
    "puts the old version and its records back when killed $step",
    slow,
    async (at) => {
      const { home, schema } = await killedAt(at);

      const again = await updateAgain(home, at.onDisk);

      expect([again.updated.code, lastJson(again.updated.stdout)]).toMatchObject([
        1,
        {
          error: { code: "update.rolled_back", details: { failed: "unfinished", started: false } },
        },
      ]);
      expect(home.npm).toHaveLength(at.npmRuns);
      expect(home.installed.version).toBe(running);
      await expect(engineSchemaOf(home)).resolves.toBe(schema);
      expect(again.status).toMatchObject({ state: "ready", version: running });
      await expect(updateKeys(home)).resolves.toStrictEqual(["notice.updateRolledBack"]);
      expect(await isKept(home, "rollback")).toBe(false);
    },
  );

  it.each(["updated", "rolled_back"] as const)(
    "removes the copies a run killed after it recorded %s left, and goes on",
    slow,
    async (record) => {
      const { home } = await killedAt({ onDisk: running, migrated: false, record });
      home.registry.tag("latest", running);

      const updated = await cliAs(home, running, ["update", "--json"]);

      expect([updated.code, lastJson(updated.stdout)]).toMatchObject([
        0,
        { outcome: "up_to_date" },
      ]);
      expect([
        await isKept(home, "rollback"),
        await isKept(home, `binference-${running}.tgz`),
      ]).toStrictEqual([false, false]);
      await expect(readUpdateState(home.machine.folder, live())).resolves.toMatchObject({
        state: record,
      });
    },
  );

  it(
    "leaves everything as it is while the old release's copy is gone, and says what to run",
    slow,
    async () => {
      const killed = {
        onDisk: newer,
        migrated: true,
        record: "checking",
        isOldGone: true,
      } as const;
      const { home } = await killedAt(killed);

      const updated = await cliAs(home, newer, ["update"]);

      expect(updated.code).toBe(1);
      expect(updated.stderr).toContain(
        `run npm install --global binference@${running}, then binference update again`,
      );
      expect(home.npm).toStrictEqual([]);
      await expect(readUpdateState(home.machine.folder, live())).resolves.toMatchObject({
        state: "checking",
      });
      expect(await isKept(home, "rollback")).toBe(true);
    },
  );

  it("never starts or stops an engine in another terminal, which stays locked", slow, async () => {
    const killed = { onDisk: newer, migrated: false, record: "checking" } as const;
    const { home } = await killedAt(killed);
    const argv = ["start", "--foreground", "--json", "--set", `engine.port=${home.port}`];
    const host = {
      ...hostWith(home.machine, argv, { parts: home.parts, env: {} }),
      version: newer,
    };
    const exit = runCli(host);
    const ready = await host.waitForLine((line) => line.includes('"state"'));

    const updated = await cliAs(home, newer, ["update", "--json"]);
    home.machine.signals.emit("SIGINT", "SIGINT");
    await exit;

    expect(JSON.parse(ready)).toMatchObject({ state: "locked", lockReason: "update_checking" });
    expect([updated.code, lastJson(updated.stdout)]).toMatchObject([
      1,
      { error: { code: "update.rollback_failed", details: { reason: "foreground" } } },
    ]);
    expect([home.npm, home.installed.version]).toStrictEqual([[], newer]);
    await expect(readUpdateState(home.machine.folder, live())).resolves.toMatchObject({
      state: "checking",
    });
  });
});
