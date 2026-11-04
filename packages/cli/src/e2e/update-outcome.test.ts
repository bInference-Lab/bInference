import { join } from "node:path";
import { ensurePrivateFolder, writePrivateFile } from "@binference/platform";
import { afterEach, describe, expect, it } from "vitest";
import { readUpdateState, type UpdateState, writeUpdateState } from "../updates/update-state.js";
import type { InitMachine } from "./init-fixtures.js";
import { connectClient, noPermissions } from "./test-host.js";
import { createRunningEngines } from "./unlock-fixtures.js";

const slow = { timeout: 60_000 };
const engines = createRunningEngines();
const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(20_000) });
const running = "2026.10.0-test";

afterEach(async () => {
  await engines.stopAll();
});

async function startWith(machine: InitMachine, state: UpdateState) {
  const options = { permissions: noPermissions, signal: AbortSignal.timeout(5_000) };
  await writeUpdateState(machine.folder, state, options);
  const started = await engines.start(machine);
  const client = await connectClient(machine);
  const notices = await client.call("notice/list", { limit: 200 }, live());
  const keys = notices.items.map((item) => item.key);
  return { started, client, notices: notices.items, keys };
}

// A record a write cut short: a file is there, but it does not read as a record.
async function startWithBrokenRecord(machine: InitMachine) {
  const options = { permissions: noPermissions, signal: AbortSignal.timeout(5_000) };
  await ensurePrivateFolder(join(machine.folder, "updates"), options);
  await writePrivateFile(join(machine.folder, "updates", "state.json"), '{"state":"chec', options);
  return engines.start(machine);
}

describe("an engine after binference update", () => {
  it("stays locked and tells nothing while its update is checked", slow, async () => {
    const machine = await engines.setUp();
    const checking = { state: "checking", from: "2026.9.0", to: running } as const;
    const { started, client, keys } = await startWith(machine, checking);

    expect(started).toMatchObject({ state: "locked", lockReason: "update_checking" });
    expect(keys).not.toContain("notice.locked");
    await expect(client.call("engine/unlock", {}, live())).rejects.toMatchObject({
      code: "engine.locked",
    });
    await expect(readUpdateState(machine.folder, live().signal)).resolves.toStrictEqual(checking);
  });

  it("stays locked while an update of any version is checked, the old one too", slow, async () => {
    const machine = await engines.setUp();
    const checking = { state: "checking", from: running, to: "2026.11.0" } as const;
    const { started } = await startWith(machine, checking);

    expect(started).toMatchObject({ state: "locked", lockReason: "update_checking" });
  });

  it("stays locked while the update record does not read", slow, async () => {
    const machine = await engines.setUp();

    await expect(startWithBrokenRecord(machine)).resolves.toMatchObject({
      state: "locked",
      lockReason: "update_checking",
    });
  });

  it("tells the owner once that it is the new version, with its notes", slow, async () => {
    const machine = await engines.setUp();
    const notes = { en: ["Stop-loss orders fill faster."], zh: ["The Chinese line."] };
    const updated = { state: "updated", from: "2026.9.0", to: running, notes } as const;
    const { started, notices } = await startWith(machine, updated);

    expect(started).toMatchObject({ state: "ready" });
    expect(notices.filter((item) => item.key.startsWith("notice.update"))).toMatchObject([
      { key: "notice.updated", values: { version: running, summary: notes.en[0] } },
    ]);
    await expect(readUpdateState(machine.folder, live().signal)).resolves.toBeUndefined();
  });

  it("tells the owner the update was rolled back to it", slow, async () => {
    const machine = await engines.setUp();
    const back = { state: "rolled_back", from: running, to: "2026.11.0" } as const;
    const { notices } = await startWith(machine, back);

    expect(notices.filter((item) => item.key.startsWith("notice.update"))).toMatchObject([
      { key: "notice.updateRolledBack", values: { version: "2026.11.0", previous: running } },
    ]);
    await expect(readUpdateState(machine.folder, live().signal)).resolves.toBeUndefined();
  });
});
