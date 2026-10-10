import { testAgent, testNowMs } from "@binference/engine/testing";
import { createFormatter } from "@binference/i18n";
import { afterEach, describe, expect, it } from "vitest";
import { skeletonCompositions } from "../compose/test-skeleton.js";
import { type ServedSkeleton, serveSkeleton } from "./skeleton-machine.js";
import { createTestMachines, runOn, type TestMachine } from "./test-host.js";

const slow = { timeout: 60_000 };
const machines = createTestMachines();
const served: ServedSkeleton[] = [];
const dayMs = 86_400_000;
const [selfHosted] = skeletonCompositions;
const english = createFormatter({ locale: "en", timeZone: "UTC" });
const en = (key: string, values: Readonly<Record<string, string | number>> = {}): string =>
  english.message(`cli.${key}`, values);
const perTrade = (value: string, when = "") => ({
  name: english.message("limit.name", { field: "perTradeUsdMicros" }),
  key: "limits.perTradeUsd",
  value,
  when,
});

afterEach(async () => {
  await Promise.all(served.splice(0).map(async (skeleton) => skeleton.close()));
  await machines.removeAll();
});

async function servedMachine(): Promise<TestMachine> {
  if (selfHosted === undefined) {
    throw new Error("Expected the self-hosted composition.");
  }
  const machine = await machines.create(testNowMs);
  served.push(await serveSkeleton(machine, selfHosted));
  return machine;
}

describe("binference limit", () => {
  it("shows each limit in effect by the key limit set takes", slow, async () => {
    const machine = await servedMachine();

    const shown = await runOn(machine, ["limit"]);

    expect([shown.code, shown.stderr]).toStrictEqual([0, ""]);
    expect(shown.stdout).toContain(`${en("limit.heading", { agent: testAgent })}\n`);
    expect(shown.stdout).toContain(`  ${en("limit.item", perTrade("$1,000.00"))}\n`);
    const json = await runOn(machine, ["limit", "--json"]);
    expect(JSON.parse(json.stdout)).toMatchObject({
      agent: testAgent,
      perTradeUsdMicros: "1000000000",
    });
  });

  it("applies a stricter limit at once and keeps a looser one waiting a day", slow, async () => {
    const machine = await servedMachine();

    const stricter = await runOn(machine, ["limit", "set", "limits.perTradeUsd=50"]);
    expect([stricter.code, stricter.stdout]).toStrictEqual([
      0,
      `  ${en("limit.now", perTrade("$50.00"))}\n`,
    ]);
    const looser = await runOn(machine, ["limit", "set", "limits.perTradeUsd=5000"]);
    const when = english.dateTime(testNowMs + dayMs);
    expect(looser.stdout).toBe(`  ${en("limit.waits", perTrade("$5,000.00", when))}\n`);
    const shown = await runOn(machine, ["limit"]);
    expect(shown.stdout).toContain(`${en("limit.pendingHeading", { when })}\n`);
  });

  it("drops the looser limits that wait, and says when none waits", slow, async () => {
    const machine = await servedMachine();
    await runOn(machine, ["limit", "set", "limits.perTradeUsd=5000"]);

    const cancelled = await runOn(machine, ["limit", "cancel"]);
    expect([cancelled.code, cancelled.stdout]).toStrictEqual([0, `${en("limit.cancelled")}\n`]);
    const again = await runOn(machine, ["limit", "cancel"]);
    expect(again.stdout).toBe(`${en("limit.nothingWaits")}\n`);
  });

  it("refuses a key no limit has before anything is sent", slow, async () => {
    const machine = await servedMachine();

    const refused = await runOn(machine, ["limit", "set", "owner.locale=zh"]);
    expect([refused.code, refused.stderr]).toStrictEqual([
      1,
      `${en("limit.badSet", { set: "owner.locale=zh" })}\n`,
    ]);
  });
});
