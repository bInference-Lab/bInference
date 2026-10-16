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
import { runCli } from "../program/run-cli.js";
import { createScriptedPrompter, type ScriptedAnswer } from "../term/scripted-prompter.js";
import { type ServedSkeleton, serveSkeleton } from "./skeleton-machine.js";
import { createTestMachines, hostWith, runOn, type TestMachine } from "./test-host.js";

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

// A command line run by a person at the terminal, who types the disclaimer's phrase back.
async function typed(
  machine: TestMachine,
  argv: readonly string[],
  answers: readonly ScriptedAnswer[] = ["I understand"],
) {
  const prompter = createScriptedPrompter({ disclaimer: answers });
  const host = hostWith(machine, argv, { env: {}, parts: { prompter } });
  const code = await runCli(host);
  return { code, stdout: host.stdout(), stderr: host.stderr(), prompter };
}

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
        await expect(typed(machine, ["live"])).resolves.toMatchObject({
          code: 0,
          stdout:
            `main (${agent}) is live now. Its trades use real money from its wallet, and its first ` +
            "live card says so.\n",
          stderr: "",
        });
        const proposed = await skeleton.client.call("intent/propose", swapRequest, live());
        expect([proposed.paper, proposed.card?.paper]).toStrictEqual([false, false]);
        const confirmed = await runOn(machine, ["confirm", proposed.intent, "--yes"]);
        expect(confirmed.code).toBe(0);
        expect(confirmed.stdout).toContain(
          `\nConfirmed ${proposed.intent}. binference is sending it on chain.\n`,
        );
        expect(skeleton.executor.taken()).toStrictEqual([proposed.intent]);
      },
    );

    it("says when the agent is in the mode already, and brakes back to paper", slow, async () => {
      const { machine } = await servedMachine();
      await typed(machine, ["live"]);
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
        await expect(typed(machine, ["live", "--agent", second])).resolves.toMatchObject({
          code: 2,
          stdout: "",
          stderr:
            `${String(messages.en["error.wallet.unfunded"])}\n` +
            "Run `binference wallet address` to see the address to fund.\n",
        });
        const stored = await skeleton.parts.stores.agents.get(second, live());
        expect(stored?.agent.mode).toBe("paper");
      },
    );
  },
);

async function servedSelfHosted(): Promise<TestMachine> {
  const [selfHosted] = skeletonCompositions;
  if (selfHosted === undefined) {
    throw new Error("Expected the self-hosted composition.");
  }
  const machine = await machines.create(testNowMs);
  served.push(await serveSkeleton(machine, selfHosted));
  return machine;
}

describe("going live", () => {
  it("shows the disclaimer and goes live only once the phrase is typed back", slow, async () => {
    const machine = await servedSelfHosted();
    const en = createFormatter({ locale: "en", timeZone: "UTC" });
    const phrase = { phrase: "I understand" };

    const went = await typed(machine, ["live"], ["yes", " i UNDERSTAND "]);

    expect(went.code).toBe(0);
    expect(went.prompter.transcript.notes).toStrictEqual([
      { title: en.message("disclaimer.title"), text: en.message("disclaimer.text") },
      { title: en.message("disclaimer.privacyTitle"), text: en.message("disclaimer.privacy") },
    ]);
    expect(went.prompter.transcript.lines).toStrictEqual([
      en.message("cli.live.wrongPhrase", phrase),
    ]);
    const again = await typed(machine, ["live"], []);
    expect([again.code, again.prompter.transcript.asked]).toStrictEqual([0, []]);
  });

  it("never goes live with nobody at the terminal to read and type", slow, async () => {
    const machine = await servedSelfHosted();

    const refused = await runOn(machine, ["live", "--json"]);

    expect([refused.code, refused.stdout]).toStrictEqual([
      1,
      `${JSON.stringify({ error: { code: "agent.disclaimer" } })}\n`,
    ]);
    const status = await runOn(machine, ["status", "--json"]);
    expect(status.stdout).toContain('"mode":"paper"');
  });
});
