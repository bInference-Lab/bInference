import type { TempFolder } from "@binference/platform/testing";
import { afterEach, describe, expect, it } from "vitest";
import { isLiveTradeAnswered, liveTradeStored } from "../state/live-trade.js";
import { newInitMachine, secretEnv } from "./init-fixtures.js";
import { seedSendingTrade } from "./state-fixtures.js";
import { hostOn } from "./test-host.js";
import { createRunningEngines } from "./unlock-fixtures.js";

const slow = { timeout: 60_000 };
const engines = createRunningEngines();
const folders: TempFolder[] = [];
const signal = (): AbortSignal => new AbortController().signal;

afterEach(async () => {
  await engines.stopAll();
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

describe("a live trade on its way", () => {
  it("reads none on a new install, and one once a live swap is executing", slow, async () => {
    const machine = await engines.setUp();
    const host = hostOn(machine, [], secretEnv(machine));
    await expect(liveTradeStored(host, signal())).resolves.toBe("none");

    await seedSendingTrade(machine);

    await expect(liveTradeStored(host, signal())).resolves.toBe("sending");
  });

  it("reads none on a state folder with no engine database", async () => {
    const machine = await newInitMachine(folders);
    await expect(liveTradeStored(hostOn(machine, []), signal())).resolves.toBe("none");
  });

  it("hears from a running engine that no live intent is executing", slow, async () => {
    const machine = await engines.setUp();
    expect(await engines.start(machine)).toMatchObject({ state: "ready" });
    const host = hostOn(machine, [], secretEnv(machine));
    await expect(isLiveTradeAnswered(host, signal())).resolves.toBe(false);
  });
});
