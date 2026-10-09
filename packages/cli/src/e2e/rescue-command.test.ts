import { type AccountRef, accountRefSchema } from "@binference/chain";
import { bsc } from "@binference/chains";
import { type FakeCeilingEditor, fakeOwnerKeyCode, testNowMs } from "@binference/engine/testing";
import { createFormatter, messages } from "@binference/i18n";
import { afterEach, describe, expect, it } from "vitest";
import { skeletonCompositions } from "../compose/test-skeleton.js";
import { runCli } from "../program/run-cli.js";
import { createScriptedPrompter, type ScriptedAnswer } from "../term/scripted-prompter.js";
import { type ServedSkeleton, serveSkeleton } from "./skeleton-machine.js";
import { createTestMachines, hostWith, runOn, type TestMachine } from "./test-host.js";

const slow = { timeout: 60_000 };
const machines = createTestMachines();
const served: ServedSkeleton[] = [];
const live = { signal: new AbortController().signal };
const en = (key: string): string => String(messages.en[`cli.${key}`]);
const dayMs = 86_400_000;
const ownerAddress = "0x30435f9D276c6BC54F56161Fb3dFB7bDC2a8DBcB";
const newAddress = "0xeA6F82DbD6C87DE5E542eFbd1f9964879828e4e7";
const accountOf = (address: string): AccountRef => accountRefSchema.parse(`eip155:56:${address}`);
const [selfHosted] = skeletonCompositions;
const wrongKey = (letter: string): string => `bnok1${letter.repeat(25)}`;

afterEach(async () => {
  await Promise.all(served.splice(0).map(async (skeleton) => skeleton.close()));
  await machines.removeAll();
});

interface Served {
  readonly machine: TestMachine;
  readonly ceilings: FakeCeilingEditor;
  readonly ceiling: string;
}

// The skeleton with the owner's rescue address in effect, and its wallet's ceiling listing it.
async function servedMachine(): Promise<Served> {
  if (selfHosted === undefined) {
    throw new Error("Expected the self-hosted composition.");
  }
  const machine = await machines.create(testNowMs);
  const skeleton = await serveSkeleton(machine, selfHosted, { chains: [bsc] });
  served.push(skeleton);
  const { install } = skeleton.parts.stores;
  await install.changeRescue(
    { address: accountOf(ownerAddress), atMs: testNowMs - 2 * dayMs },
    live,
  );
  const [wallet] = (await install.read(live)).wallets;
  const ceilings = skeleton.parts.ceilings as FakeCeilingEditor;
  const ceiling = wallet?.policyId ?? "";
  ceilings.put(ceiling, [accountOf(ownerAddress)]);
  return { machine, ceilings, ceiling };
}

async function rescueSet(
  machine: TestMachine,
  argv: readonly string[],
  answers: readonly ScriptedAnswer[],
) {
  const prompter = createScriptedPrompter({ ownerKey: answers });
  const host = hostWith(machine, ["rescue", "set", ...argv], { env: {}, parts: { prompter } });
  const code = await runCli(host);
  return { code, stdout: host.stdout(), stderr: host.stderr(), prompter };
}

describe("binference rescue set", () => {
  it(
    "asks for the owner key unseen, and saves the address to take effect in a day",
    slow,
    async () => {
      const { machine, ceilings, ceiling } = await servedMachine();
      const set = await rescueSet(machine, [newAddress], [fakeOwnerKeyCode]);

      const when = createFormatter({ locale: "en", timeZone: "UTC" }).dateTime(testNowMs + dayMs);
      expect(set.stderr).toBe("");
      expect(set.code).toBe(0);
      expect(set.stdout).toContain(`The rescue address becomes ${newAddress} at ${when}.`);
      expect(set.prompter.transcript.asked).toStrictEqual(["ownerKey"]);
      expect(ceilings.recipients(ceiling)).toStrictEqual(
        [accountOf(ownerAddress), accountOf(newAddress)].toSorted(),
      );
    },
  );

  it("asks again after a wrong owner key, and stops after the third", slow, async () => {
    const { machine, ceilings, ceiling } = await servedMachine();
    const wrong = await rescueSet(
      machine,
      [newAddress],
      [wrongKey("a"), wrongKey("b"), wrongKey("c")],
    );

    expect(wrong.code).toBe(1);
    expect(
      wrong.prompter.transcript.lines.filter((line) => line === en("rescue.wrongKey")),
    ).toHaveLength(2);
    expect(wrong.stderr).toContain(en("rescue.wrongKeyEnd"));
    expect(ceilings.recipients(ceiling)).toStrictEqual([accountOf(ownerAddress)]);
  });

  it("refuses an address that is not on BNB Chain, and runs without a terminal", slow, async () => {
    const { machine } = await servedMachine();

    const bad = await runOn(machine, ["rescue", "set", "0x12"]);
    expect([bad.code, bad.stderr]).toStrictEqual([
      1,
      `${en("rescue.badAddress").replace("{address}", "0x12")}\n`,
    ]);
    const scripted = await runOn(machine, ["rescue", "set", newAddress, "--yes"]);
    expect([scripted.code, scripted.stderr]).toStrictEqual([1, `${en("rescue.needsTerminal")}\n`]);
  });
});
