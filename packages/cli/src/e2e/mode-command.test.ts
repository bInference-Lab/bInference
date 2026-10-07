import {
  testAgent as agent,
  testAgentDraft,
  testCoin as coin,
  testNowMs,
  testToken as token,
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
const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(10_000) });
const swapRequest = {
  kind: "swap",
  agent,
  wallet,
  reason: "Rotate into the token",
  from: coin,
  to: token,
  amount: { base: 1_000_000n },
} as const;

afterEach(async () => {
  await Promise.all(served.splice(0).map(async (skeleton) => skeleton.close()));
  await machines.removeAll();
});

describe.each(skeletonCompositions)(
  "binference live and paper on the $name composition",
  (composition) => {
    async function servedMachine() {
      const machine = await machines.create(testNowMs);
      const skeleton = await serveSkeleton(machine, composition);
      served.push(skeleton);
      return { machine, skeleton };
    }

    it(
      "goes live from the terminal, and the next confirmed trade is sent, not filled on paper",
      slow,
      async () => {
        const { machine, skeleton } = await servedMachine();
        await expect(runOn(machine, ["live"])).resolves.toStrictEqual({
          code: 0,
          stdout:
            `main (${agent}) is live now. Its trades use real money from its wallet, and its first ` +
            "live card says so.\n",
          stderr: "",
        });
        const proposed = await skeleton.client.call("intent/propose", swapRequest, live());
        expect([proposed.paper, proposed.card?.paper]).toStrictEqual([false, false]);
        await expect(runOn(machine, ["confirm", proposed.intent])).resolves.toMatchObject({
          code: 0,
          stdout: `Confirmed ${proposed.intent}. binference is sending it on chain.\n`,
        });
        expect(skeleton.executor.taken()).toStrictEqual([proposed.intent]);
      },
    );

    it("says when the agent is in the mode already, and brakes back to paper", slow, async () => {
      const { machine } = await servedMachine();
      const json = await runOn(machine, ["live", "--json"]);
      expect(operations["agent/goLive"].result.parse(JSON.parse(json.stdout))).toMatchObject({
        agent,
        name: "main",
        mode: "live",
      });
      expect((await runOn(machine, ["live"])).stdout).toBe(`main (${agent}) is live already.\n`);
      expect((await runOn(machine, ["paper", "--agent", agent])).stdout).toBe(
        `main (${agent}) is in paper mode now: its trades fill on paper and nothing is sent on ` +
          "chain. Cards already open keep the mode they were proposed in.\n",
      );
      const chinese = await runOn(machine, ["paper"], { LANG: "zh_CN.UTF-8" });
      const zh = createFormatter({ locale: "zh", timeZone: "UTC" });
      expect(chinese.stdout).toBe(
        `${zh.message("cli.mode.alreadyPaper", { name: "main", agent })}\n`,
      );
    });

    it(
      "refuses to go live before the agent's wallet holds funds, and names where to fund it",
      slow,
      async () => {
        const { machine, skeleton } = await servedMachine();
        await skeleton.parts.stores.agents.create(
          testAgentDraft({ id: second, name: "second" }),
          live(),
        );
        await expect(runOn(machine, ["live", "--agent", second])).resolves.toStrictEqual({
          code: 2,
          stdout: "",
          stderr:
            `${String(messages.en["error.wallet.unfunded"])}\n` +
            "Run `binference wallet address` to see the address to fund.\n",
        });
        const json = await runOn(machine, ["live", "--agent", second, "--json"]);
        expect(json).toStrictEqual({
          code: 2,
          stdout: '{"error":{"code":"wallet.unfunded"}}\n',
          stderr: "",
        });
        const stored = await skeleton.parts.stores.agents.get(second, live());
        expect(stored?.agent.mode).toBe("paper");
      },
    );
  },
);
