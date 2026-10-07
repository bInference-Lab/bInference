import {
  testAgent as agent,
  testAgentDraft,
  testNowMs,
  testWallet as wallet,
} from "@binference/engine/testing";
import { createFormatter, messages } from "@binference/i18n";
import { operations } from "@binference/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { skeletonCompositions } from "../compose/test-skeleton.js";
import { type ServedSkeleton, serveSkeleton } from "./skeleton-machine.js";
import { createTestMachines, runOn } from "./test-host.js";

const slow = { timeout: 60_000 };
const machines = createTestMachines();
const served: ServedSkeleton[] = [];
const second = "agt_0190f1c2-3a4b-7c5d-8e6f-0000000000aa" as typeof agent;
const unknownWallet = "wal_0190f1c2-3a4b-7c5d-8e6f-0000000000ff";

afterEach(async () => {
  await Promise.all(served.splice(0).map(async (skeleton) => skeleton.close()));
  await machines.removeAll();
});

describe.each(skeletonCompositions)("binference wallet on the $name composition", (composition) => {
  async function servedMachine() {
    const machine = await machines.create(testNowMs);
    const skeleton = await serveSkeleton(machine, composition);
    served.push(skeleton);
    return { machine, skeleton };
  }

  it("lists the agent wallets with their labels and addresses", slow, async () => {
    const { machine } = await servedMachine();
    await expect(runOn(machine, ["wallet", "list"])).resolves.toStrictEqual({
      code: 0,
      stdout: `1 agent wallet:\n  Main (${wallet}) of ${agent}: 0x0000000c on fake:1\n`,
      stderr: "",
    });
    const json = await runOn(machine, ["wallet", "list", "--json", "--agent", agent]);
    expect(operations["wallet/list"].result.parse(JSON.parse(json.stdout))).toStrictEqual({
      items: [
        {
          wallet,
          agent,
          address: "fake:1:0x0000000c",
          label: "Main",
          createdAt: testNowMs - 1_000,
        },
      ],
    });
  });

  it("shows the address to fund the default wallet at, on its own line", slow, async () => {
    const { machine } = await servedMachine();
    await expect(runOn(machine, ["wallet", "address"])).resolves.toStrictEqual({
      code: 0,
      stdout: `To fund Main (${wallet}), pay into this address on fake:1:\n0x0000000c\n`,
      stderr: "",
    });
    const named = await runOn(machine, ["wallet", "address", "--wallet", wallet, "--json"]);
    expect(JSON.parse(named.stdout)).toStrictEqual({
      agent,
      wallet,
      label: "Main",
      address: "fake:1:0x0000000c",
    });
  });

  it("says when an agent has no wallet, and refuses a wallet it does not have", slow, async () => {
    const { machine, skeleton } = await servedMachine();
    await skeleton.parts.stores.agents.create(testAgentDraft({ id: second, name: "second" }), {
      signal: AbortSignal.timeout(10_000),
    });
    const none = await runOn(machine, ["wallet", "list", "--agent", second]);
    expect(none.stdout).toBe("No agent wallets yet.\n");
    await expect(runOn(machine, ["wallet", "address", "--agent", second])).resolves.toStrictEqual({
      code: 1,
      stdout: "",
      stderr: `${second} has no wallet yet. Run \`binference init\` to make one.\n`,
    });
    const json = await runOn(machine, ["wallet", "address", "--agent", second, "--json"]);
    expect(json.stdout).toBe('{"error":{"code":"cli.no_wallet"}}\n');
    const unknown = await runOn(machine, [
      "wallet",
      "address",
      "--agent",
      agent,
      "--wallet",
      unknownWallet,
    ]);
    expect(unknown).toStrictEqual({
      code: 1,
      stdout: "",
      stderr: `${String(messages.en["error.wallet.not_found"])}\n`,
    });
  });

  it("lists in Chinese, and refuses an agent the engine does not know", slow, async () => {
    const { machine } = await servedMachine();
    const chinese = await runOn(machine, ["wallet", "list"], { LANG: "zh_CN.UTF-8" });
    const zh = createFormatter({ locale: "zh", timeZone: "UTC" });
    expect(chinese.stdout.split("\n")[0]).toBe(zh.message("cli.wallet.count", { count: 1 }));
    const refused = await runOn(machine, ["wallet", "list", "--json", "--agent", second]);
    expect(refused).toMatchObject({ code: 1, stdout: '{"error":{"code":"agent.not_found"}}\n' });
  });
});
