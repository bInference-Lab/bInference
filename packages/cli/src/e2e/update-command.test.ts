import { join } from "node:path";
import { resolveStateFolder } from "@binference/platform";
import type { TempFolder } from "@binference/platform/testing";
import { afterEach, describe, expect, it } from "vitest";
import { holdUpdateLock } from "../updates/update-lock.js";
import { readUpdateState } from "../updates/update-state.js";
import { seedSendingTrade } from "./state-fixtures.js";
import { noPermissions, testSystem } from "./test-host.js";
import {
  cli,
  engineSchemaOf,
  isKept,
  lastJson,
  newer,
  running,
  setUpHome,
  startService,
  update,
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

async function homeOf(verdict: Parameters<typeof setUpHome>[1]): Promise<UpdateHome> {
  const home = await setUpHome(folders, verdict);
  homes.push(home);
  return home;
}

// The tarball each npm run installed, by version, and the prefix it installed into.
function installsOf(home: UpdateHome) {
  return home.npm.map((args) => ({
    tarball: args.at(-1)?.replace(/^.*binference-/, ""),
    prefix: args[args.indexOf("--prefix") + 1],
  }));
}

describe("binference update", () => {
  it(
    "puts the old version back into its own npm prefix when the new one fails a check",
    slow,
    async () => {
      const home = await homeOf({ check: "fails" });
      expect((await startService(home)).code).toBe(0);

      const updated = await update(home);
      const status = await cli(home, ["status", "--json"]);

      expect([updated.code, lastJson(updated.stdout)]).toMatchObject([
        1,
        { error: { code: "update.rolled_back", details: { failed: "checks", started: true } } },
      ]);
      expect(installsOf(home)).toStrictEqual([
        { tarball: `${newer}.tgz`, prefix: home.prefix },
        { tarball: `${running}.tgz`, prefix: home.prefix },
      ]);
      expect(home.checkedStates).toMatchObject([{ state: "locked", version: newer }]);
      expect(lastJson(status.stdout)).toMatchObject({ state: "ready", version: running });
      await expect(updateKeys(home)).resolves.toStrictEqual(["notice.updateRolledBack"]);
      await expect(readUpdateState(home.machine.folder, live())).resolves.toBeUndefined();
      expect([
        await isKept(home, "rollback"),
        await isKept(home, `binference-${running}.tgz`),
      ]).toStrictEqual([false, false]);
    },
  );

  it(
    "puts the records back after a release that migrated them past the old version",
    slow,
    async () => {
      const home = await homeOf({ check: "fails", migrates: true });
      expect((await startService(home)).code).toBe(0);
      const schema = await engineSchemaOf(home);

      const updated = await update(home);
      const status = await cli(home, ["status", "--json"]);

      expect([updated.code, lastJson(updated.stdout)]).toMatchObject([
        1,
        { error: { code: "update.rolled_back" } },
      ]);
      await expect(engineSchemaOf(home)).resolves.toBe(schema);
      expect(lastJson(status.stdout)).toMatchObject({ state: "ready", version: running });
    },
  );

  it(
    "installs the new version, which serves unlocked with the start flags kept",
    slow,
    async () => {
      const home = await homeOf({ check: "passes" });
      expect((await startService(home)).code).toBe(0);

      const updated = await update(home);
      const status = await cli(home, ["status", "--json"]);

      expect([updated.code, lastJson(updated.stdout)]).toStrictEqual([
        0,
        { outcome: "updated", from: running, to: newer, started: "yes" },
      ]);
      expect(home.checkedStates).toMatchObject([{ state: "locked" }]);
      expect(lastJson(status.stdout)).toMatchObject({ state: "ready", version: newer });
      expect(home.services.installed()?.args).toContain(`engine.port=${home.port}`);
      await expect(updateKeys(home)).resolves.toStrictEqual(["notice.updated"]);
      expect(await isKept(home, "rollback")).toBe(false);
    },
  );

  it(
    "refuses a release without binference's own provenance, and changes nothing",
    slow,
    async () => {
      const home = await homeOf({ check: "passes" });
      home.registry.release("2026.12.0", { provenance: "other" });

      const updated = await update(home, ["--to", "2026.12.0"]);

      expect([updated.code, lastJson(updated.stdout)]).toMatchObject([
        1,
        { error: { code: "update.download_failed" } },
      ]);
      expect(home.npm).toStrictEqual([]);
    },
  );

  it(
    "says when the running release is the newest, and refuses an install npm did not make",
    slow,
    async () => {
      const home = await homeOf({ check: "passes" });
      home.registry.tag("latest", running);
      const newest = await update(home);
      const checkout = await cli(
        {
          ...home,
          parts: {
            ...home.parts,
            entry: {
              node: "node",
              nodeOptions: [],
              script: join(home.home, "repo", "dist", "main.mjs"),
            },
          },
        },
        ["update", "--json"],
      );

      expect([newest.code, lastJson(newest.stdout)]).toStrictEqual([
        0,
        { outcome: "up_to_date", current: running, channel: "stable" },
      ]);
      expect([checkout.code, lastJson(checkout.stdout)]).toMatchObject([
        1,
        { error: { code: "update.not_npm" } },
      ]);
    },
  );

  it(
    "refuses on Windows with the steps that install by hand, before anything stops",
    slow,
    async () => {
      const home = await homeOf({ check: "passes" });
      expect((await startService(home)).code).toBe(0);
      const windows = { ...testSystem, os: "win32" };
      const updated = await cli({ ...home, parts: { ...home.parts, system: { ...windows } } }, [
        "update",
      ]);
      const status = await cli(home, ["status", "--json"]);

      expect(updated.code).toBe(1);
      expect(updated.stderr).toContain(
        `run binference stop, then npm install --global binference@${newer}, then binference start.`,
      );
      expect([home.npm, home.commands]).toStrictEqual([[], []]);
      expect(lastJson(status.stdout)).toMatchObject({ state: "ready", version: running });
    },
  );

  it("refuses while a live trade is on its way, and while another update runs", slow, async () => {
    const home = await homeOf({ check: "passes" });
    const stateFolder = resolveStateFolder({ binferenceHome: home.machine.folder });
    const lock = await holdUpdateLock({ stateFolder, permissions: noPermissions, signal: live() });
    const racing = await update(home);
    lock?.release();
    await seedSendingTrade(home.machine);
    const busy = await update(home);

    expect([racing.code, lastJson(racing.stdout)]).toMatchObject([
      1,
      { error: { code: "update.running" } },
    ]);
    expect([busy.code, lastJson(busy.stdout)]).toMatchObject([
      1,
      { error: { code: "intent.executing" } },
    ]);
    expect(home.npm).toStrictEqual([]);
  });
});
