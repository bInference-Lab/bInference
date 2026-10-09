import { messages } from "@binference/i18n";
import { afterEach, describe, expect, it } from "vitest";
import { runOn } from "./init-fixtures.js";
import { connectClient } from "./test-host.js";
import {
  createRunningEngines,
  heldKey,
  putAgentKey,
  removeAgentKey,
  sealAgentKey,
  stateOf,
  testPassphrase,
} from "./unlock-fixtures.js";

const slow = { timeout: 60_000 };
const engines = createRunningEngines();
const en = (key: string): string => String(messages.en[`cli.${key}`]);
const call = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });

afterEach(async () => {
  await engines.stopAll();
});

describe("a self-hosted engine and its agent key", () => {
  it("opens the agent key at start in the file mode", slow, async () => {
    const machine = await engines.setUp();
    await expect(engines.start(machine)).resolves.toMatchObject({ state: "ready" });
    await expect(stateOf(machine)).resolves.toBe("ready");
  });

  it("runs locked without the agent key, and unlocks over IPC once it is back", slow, async () => {
    const machine = await engines.setUp();
    const held = await heldKey(machine);
    await removeAgentKey(machine);
    await expect(engines.start(machine)).resolves.toMatchObject({
      state: "locked",
      lockReason: "agent_key_missing",
    });
    const status = await runOn(machine, ["status"]);
    expect(status.stdout).toContain(en("status.locked"));
    await expect(runOn(machine, ["health"])).resolves.toMatchObject({
      code: 0,
      stdout: `${en("health.locked")}\n`,
    });
    const client = await connectClient(machine);
    try {
      await expect(client.call("engine/unlock", {}, call())).rejects.toMatchObject({
        code: "engine.locked",
        details: { reason: "agent_key_missing" },
      });
      await putAgentKey(machine, held);
      await expect(client.call("engine/unlock", {}, call())).resolves.toStrictEqual({});
    } finally {
      client.close();
    }
    await expect(stateOf(machine)).resolves.toBe("ready");
  });

  it("opens the manual mode's sealed key only with the owner's passphrase", slow, async () => {
    const machine = await engines.setUp();
    await sealAgentKey(machine);
    await expect(engines.start(machine)).resolves.toMatchObject({
      state: "locked",
      lockReason: "needs_passphrase",
    });
    const client = await connectClient(machine);
    try {
      await expect(
        client.call("engine/unlock", { passphrase: "not the passphrase" }, call()),
      ).rejects.toMatchObject({ code: "engine.locked", details: { reason: "wrong_passphrase" } });
      await expect(
        client.call("engine/unlock", { passphrase: testPassphrase }, call()),
      ).resolves.toStrictEqual({});
    } finally {
      client.close();
    }
    await expect(stateOf(machine)).resolves.toBe("ready");
  });
});
