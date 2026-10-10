import { type AccountRef, accountRefSchema, type SimulatedStep } from "@binference/chain";
import { createFakeFamily, createFakeTxSimulator } from "@binference/chain/testing";
import { testAgent, testCoin, testNowMs } from "@binference/engine/testing";
import { createFormatter, messages } from "@binference/i18n";
import { afterEach, describe, expect, it } from "vitest";
import { skeletonCompositions } from "../compose/test-skeleton.js";
import { type ServedSkeleton, serveSkeleton } from "./skeleton-machine.js";
import { createTestMachines, runOn, type TestMachine } from "./test-host.js";

const slow = { timeout: 60_000 };
const machines = createTestMachines();
const served: ServedSkeleton[] = [];
const live = { signal: new AbortController().signal };
const dayMs = 86_400_000;
const [selfHosted] = skeletonCompositions;
const when = (atMs: number): string =>
  createFormatter({ locale: "en", timeZone: "UTC" }).dateTime(atMs);
// The test wallet's account in the skeleton, and the owner's rescue address on the same chain.
const walletAccount: AccountRef = accountRefSchema.parse("fake:1:0x0000000c");
const rescueAccount: AccountRef = accountRefSchema.parse("fake:1:0x000000a1");
// The test agent keeps 10^15 of the coin for gas, so a rescue moves the rest of one coin.
const moved = { asset: testCoin, base: 10n ** 18n - 10n ** 15n };

afterEach(async () => {
  await Promise.all(served.splice(0).map(async (skeleton) => skeleton.close()));
  await machines.removeAll();
});

function en(key: string, values: Readonly<Record<string, string>> = {}): string {
  return Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, value),
    String(messages.en[`cli.${key}`]),
  );
}

// The rescue's one send, the coin above the reserve, runs as planned.
function rescueSimulator() {
  const draft = createFakeFamily().transferDraft({
    from: walletAccount,
    to: rescueAccount,
    amount: moved,
  });
  if (!draft.ok) {
    throw new Error("Expected a fake send.");
  }
  const step: SimulatedStep = {
    status: "success",
    gasUsed: 21_000n,
    transfers: [{ from: walletAccount, to: rescueAccount, amount: moved }],
    approvals: [],
  };
  return createFakeTxSimulator(new Map([[draft.value.payload, step]]));
}

// The skeleton with one coin in its wallet, which a rescue may move.
async function servedMachine(): Promise<{ machine: TestMachine; skeleton: ServedSkeleton }> {
  if (selfHosted === undefined) {
    throw new Error("Expected the self-hosted composition.");
  }
  const machine = await machines.create(testNowMs);
  const skeleton = await serveSkeleton(machine, selfHosted, {
    held: new Map([[walletAccount, [{ asset: testCoin, base: 10n ** 18n }]]]),
    chainSimulator: rescueSimulator(),
  });
  served.push(skeleton);
  return { machine, skeleton };
}

async function setRescueAddress(skeleton: ServedSkeleton): Promise<void> {
  const change = { address: rescueAccount, atMs: testNowMs - 2 * dayMs };
  await skeleton.parts.stores.install.changeRescue(change, live);
}

function intentIn(text: string): string {
  return /int_[0-9a-f-]+/.exec(text)?.[0] ?? "";
}

describe("binference freeze and unfreeze", () => {
  it("freeze every agent, then unfreeze through the card confirm takes", slow, async () => {
    const { machine } = await servedMachine();

    const frozen = await runOn(machine, ["freeze"]);
    expect([frozen.code, frozen.stderr]).toStrictEqual([0, ""]);
    expect(frozen.stdout).toContain(en("freeze.all", { when: when(testNowMs) }));
    const status = await runOn(machine, ["safety", "status"]);
    expect(status.stdout).toContain(en("safety.installFrozen", { when: when(testNowMs) }));
    expect(status.stdout).toContain(`${testAgent}: `);

    const opened = await runOn(machine, ["unfreeze"]);
    const intent = intentIn(opened.stdout);
    expect([opened.code, opened.stdout]).toStrictEqual([
      0,
      `${en("unfreeze.opened", { intent })}\n`,
    ]);
    const confirmed = await runOn(machine, ["confirm", intent, "--yes"]);
    expect([confirmed.code, confirmed.stderr]).toStrictEqual([0, ""]);
    expect(confirmed.stdout).toContain(`\nConfirmed ${intent}. Every agent is unfrozen.\n`);
    const calm = await runOn(machine, ["safety", "status", "--json"]);
    expect(JSON.parse(calm.stdout)).toStrictEqual({ frozen: false, agents: [] });
  });

  it("freeze one agent with --agent, and say when nothing is frozen", slow, async () => {
    const { machine } = await servedMachine();

    const none = await runOn(machine, ["unfreeze"]);
    expect([none.code, none.stdout]).toStrictEqual([0, `${en("unfreeze.nothing")}\n`]);
    const frozen = await runOn(machine, ["freeze", "--agent", testAgent, "--json"]);
    expect(JSON.parse(frozen.stdout)).toStrictEqual({ agent: testAgent, frozenAt: testNowMs });
    const status = await runOn(machine, ["safety", "status", "--json"]);
    expect(JSON.parse(status.stdout)).toStrictEqual({
      frozen: true,
      agents: [{ agent: testAgent, frozenAt: testNowMs }],
    });
    const opened = await runOn(machine, ["unfreeze", "--agent", testAgent, "--json"]);
    expect(opened.stdout).toBe(`${JSON.stringify({ intent: intentIn(opened.stdout) })}\n`);
    expect(intentIn(opened.stdout)).not.toBe("");
  });

  it("speak Chinese with a Chinese locale", slow, async () => {
    const { machine } = await servedMachine();

    const frozen = await runOn(machine, ["freeze"], { LANG: "zh_CN.UTF-8" });
    const zh = createFormatter({ locale: "zh", timeZone: "UTC" });
    const at = zh.dateTime(testNowMs);
    const lines = [zh.message("cli.freeze.all", { when: at }), zh.message("cli.freeze.undo")];
    expect(frozen.stdout).toBe(`${lines.join("\n")}\n`);
  });
});

describe("binference rescue", () => {
  it("open the rescue card, which confirm sends", slow, async () => {
    const { machine, skeleton } = await servedMachine();
    await setRescueAddress(skeleton);

    const opened = await runOn(machine, ["rescue"]);
    const intent = intentIn(opened.stdout);
    expect([opened.code, opened.stderr]).toStrictEqual([0, ""]);
    expect(opened.stdout).toBe(`${en("rescue.opened", { intent, address: "0x000000a1" })}\n`);
    const again = await runOn(machine, ["rescue", "--json"]);
    expect(JSON.parse(again.stdout)).toStrictEqual({ intent, address: rescueAccount });
    const confirmed = await runOn(machine, ["confirm", intent, "--yes"]);
    expect(confirmed.stdout).toContain(
      `\nConfirmed ${intent}. binference is sending it on chain.\n`,
    );
    expect(skeleton.executor.taken()).toStrictEqual([intent]);
  });

  it("refuse a rescue with no rescue address, and show the address set", slow, async () => {
    const { machine, skeleton } = await servedMachine();

    const refused = await runOn(machine, ["rescue"]);
    expect([refused.code, refused.stderr]).toStrictEqual([
      1,
      `${String(messages.en["error.rescue.no_address"])}\n`,
    ]);
    const unset = await runOn(machine, ["safety", "status"]);
    expect(unset.stdout).toContain(en("safety.noRescueAddress"));
    await setRescueAddress(skeleton);
    const status = await runOn(machine, ["safety", "status"]);
    expect(status.stdout).toBe(
      `${en("safety.calm")}\n${en("safety.rescueAddress", { address: "0x000000a1" })}\n`,
    );
  });
});
