import type { ManualClock } from "@binference/core/testing";
import { createFormatter } from "@binference/i18n";
import { backupViewSchema, operations } from "@binference/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { runOn } from "./init-fixtures.js";
import { createRunningEngines } from "./unlock-fixtures.js";

const slow = { timeout: 60_000 };
const engines = createRunningEngines();
const english = createFormatter({ locale: "en", timeZone: "UTC" });

afterEach(async () => {
  await engines.stopAll();
});

describe("binference backup create and list", () => {
  it("makes a backup by hand through the running engine and lists it first", slow, async () => {
    const machine = await engines.setUp();
    expect(await engines.start(machine)).toMatchObject({ state: "ready" });

    const empty = await runOn(machine, ["backup", "list"]);
    expect(empty.stdout).toBe(`${english.message("cli.backup.count", { count: 0 })}\n`);

    const made = await runOn(machine, ["backup", "create", "--json"]);
    expect([made.code, made.stderr]).toStrictEqual([0, ""]);
    const backup = backupViewSchema.parse(JSON.parse(made.stdout));
    expect(backup).toMatchObject({ kind: "manual" });
    expect(backup.verifiedAt).toBeDefined();

    // The machine's clock stands still, and backups made in the same millisecond are listed by id,
    // which is random: the second backup is made a second later, as it would be by hand.
    await (machine.clock as ManualClock).advance(1_000);
    const people = await runOn(machine, ["backup", "create"]);
    expect(people.code).toBe(0);
    expect(people.stdout).toMatch(/^Backup bkp_\S+ is made and checked \(\d+ KiB\)\./);

    const listed = await runOn(machine, ["backup", "list", "--json"]);
    const page = operations["backup/list"].result.parse(JSON.parse(listed.stdout));
    expect(page.items).toHaveLength(2);
    expect(page.items[1]).toStrictEqual(backup);
    const shown = await runOn(machine, ["backup", "list"]);
    expect(shown.stdout).toContain("2 backups, newest first:");
    expect(shown.stdout).toContain(`  ${backup.backup}: made by hand, `);
  });

  it("says the engine is not running", slow, async () => {
    const machine = await engines.setUp();
    const refused = await runOn(machine, ["backup", "create"]);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("binference is not running on the state folder");
  });
});
