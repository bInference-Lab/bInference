import { type AccountRef, accountRefSchema } from "@binference/chain";
import { bsc } from "@binference/chains";
import type { ManualClock } from "@binference/core/testing";
import {
  type FakeCeilingEditor,
  fakeOwnerKeyCode,
  testAgent,
  testNowMs,
} from "@binference/engine/testing";
import { createFormatter } from "@binference/i18n";
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
const dayMs = 86_400_000;
const [selfHosted] = skeletonCompositions;
const ownerAddress = "0x30435f9D276c6BC54F56161Fb3dFB7bDC2a8DBcB";
const coldAddress = "0xeA6F82DbD6C87DE5E542eFbd1f9964879828e4e7";
const accountOf = (address: string): AccountRef => accountRefSchema.parse(`eip155:56:${address}`);
const english = createFormatter({ locale: "en", timeZone: "UTC" });
const when = (atMs: number): string => english.dateTime(atMs);

afterEach(async () => {
  await Promise.all(served.splice(0).map(async (skeleton) => skeleton.close()));
  await machines.removeAll();
});

function en(key: string, values: Readonly<Record<string, string | number>> = {}): string {
  return english.message(`cli.${key}`, values);
}

interface Served {
  readonly machine: TestMachine;
  readonly ceilings: FakeCeilingEditor;
  readonly ceiling: string;
}

// The skeleton on BNB Chain with the owner's rescue address in effect, and its wallet's ceiling
// listing it.
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

async function addAddress(
  machine: TestMachine,
  argv: readonly string[],
  answers: readonly ScriptedAnswer[],
) {
  const prompter = createScriptedPrompter({ ownerKey: answers });
  const host = hostWith(machine, ["address", "add", ...argv], { env: {}, parts: { prompter } });
  const code = await runCli(host);
  return { code, stdout: host.stdout(), stderr: host.stderr(), prompter };
}

function entryIn(text: string): string {
  return /adr_[0-9a-f-]+/.exec(text)?.[0] ?? "";
}

describe("binference address", () => {
  it("saves an address with the owner key typed unseen, in the ceiling first", slow, async () => {
    const { machine, ceilings, ceiling } = await servedMachine();

    const added = await addAddress(machine, [coldAddress, "--label", "cold"], [fakeOwnerKeyCode]);

    const entry = entryIn(added.stdout);
    expect([added.code, added.stderr]).toStrictEqual([0, ""]);
    expect(added.stdout).toBe(
      `${en("address.added", {
        address: coldAddress,
        chain: bsc.name,
        label: "cold",
        agent: testAgent,
        entry,
        usableAt: when(testNowMs + dayMs),
      })}\n`,
    );
    expect(added.prompter.transcript.asked).toStrictEqual(["ownerKey"]);
    expect(ceilings.recipients(ceiling)).toStrictEqual(
      [accountOf(ownerAddress), accountOf(coldAddress)].toSorted(),
    );
    // A minute later the terminal's clock is past the time the entry was saved.
    await (machine.clock as ManualClock).advance(60_000);
    const again = await addAddress(machine, [coldAddress, "--label", "x"], [fakeOwnerKeyCode]);
    const values = {
      address: coldAddress,
      chain: bsc.name,
      agent: testAgent,
      label: "cold",
      entry,
    };
    expect(again.stdout).toBe(
      `${en("address.already", { ...values, createdAt: when(testNowMs) })}\n`,
    );
  });

  it("lists the saved addresses, and removes one", slow, async () => {
    const { machine } = await servedMachine();
    const added = await addAddress(machine, [coldAddress, "--label", "cold"], [fakeOwnerKeyCode]);
    const entry = entryIn(added.stdout);

    const listed = await runOn(machine, ["address", "list"]);
    const item = { label: "cold", entry, address: coldAddress, chain: bsc.name, saved: "yes" };
    expect(listed.stdout).toBe(
      `${en("address.count", { agent: testAgent, count: 1 })}\n` +
        `  ${en("address.item", { ...item, usableAt: when(testNowMs + dayMs) })}\n`,
    );
    const removed = await runOn(machine, ["address", "remove", entry, "--json"]);
    expect([removed.code, removed.stdout]).toStrictEqual([0, `${JSON.stringify({ entry })}\n`]);
    const none = await runOn(machine, ["address", "list", "--json"]);
    expect(JSON.parse(none.stdout)).toStrictEqual({ items: [] });
  });

  it("refuses a wrong owner key three times, and changes nothing", slow, async () => {
    const { machine, ceilings, ceiling } = await servedMachine();
    const wrong = `bnok1${"a".repeat(25)}`;

    const refused = await addAddress(machine, [coldAddress, "--label", "x"], [wrong, wrong, wrong]);

    expect([refused.code, refused.stderr]).toStrictEqual([1, `${en("ownerKey.wrongEnd")}\n`]);
    expect(ceilings.recipients(ceiling)).toStrictEqual([accountOf(ownerAddress)]);
  });

  it("refuses an address off BNB Chain, and runs no owner key from a flag", slow, async () => {
    const { machine } = await servedMachine();

    const bad = await runOn(machine, ["address", "add", "0x12", "--label", "x"]);
    expect([bad.code, bad.stderr]).toStrictEqual([
      1,
      `${en("address.badAddress", { address: "0x12" })}\n`,
    ]);
    const scripted = await runOn(machine, ["address", "add", coldAddress, "--label", "x", "--yes"]);
    expect([scripted.code, scripted.stderr]).toStrictEqual([
      1,
      `${en("ownerKey.needsTerminal", { command: "address add" })}\n`,
    ]);
    const flagged = await runOn(machine, ["address", "add", coldAddress, "--owner-key", "x"]);
    expect(flagged.code).toBe(1);
    expect(flagged.stderr).toBe(`${en("usage.invalid")}\n`);
  });
});
