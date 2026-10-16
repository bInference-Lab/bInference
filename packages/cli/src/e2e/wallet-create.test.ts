import { accountRefSchema } from "@binference/chain";
import {
  createFakeChainDefinition,
  createFakeLaunchpad,
  createFakeVenue,
} from "@binference/chain/testing";
import { fakeOwnerKeyCode, testAgent, testNowMs } from "@binference/engine/testing";
import { createFormatter, messages } from "@binference/i18n";
import { afterEach, describe, expect, it } from "vitest";
import { type SkeletonOptions, skeletonCompositions } from "../compose/test-skeleton.js";
import { runCli } from "../program/run-cli.js";
import { createScriptedPrompter, type ScriptedAnswer } from "../term/scripted-prompter.js";
import { type ServedSkeleton, serveSkeleton } from "./skeleton-machine.js";
import { createTestMachines, hostWith, runOn, type TestMachine } from "./test-host.js";

const slow = { timeout: 60_000 };
const machines = createTestMachines();
const served: ServedSkeleton[] = [];
const live = { signal: new AbortController().signal };
const dayMs = 86_400_000;
const english = createFormatter({ locale: "en", timeZone: "UTC" });
const en = (key: string, values: Readonly<Record<string, string>> = {}): string =>
  english.message(`cli.${key}`, values);
const wrongKey = `bnok1${"a".repeat(25)}`;

afterEach(async () => {
  await Promise.all(served.splice(0).map(async (skeleton) => skeleton.close()));
  await machines.removeAll();
});

// The fake chain with a router of the fake launchpad's, so the skeleton can run it.
function withLaunchpadRouter() {
  const fake = createFakeChainDefinition();
  const routers = fake.contracts.map((router) => ({ ...router, venue: "fake-curve" }));
  return { ...fake, contracts: [...fake.contracts, ...routers] };
}

// The fake launchpad, whose launches each have a curve with a call its launch wallet may make.
const launchpads: SkeletonOptions = {
  venues: [
    createFakeVenue(),
    createFakeLaunchpad({ onCurve: [], launchCurve: accountRefSchema.parse("fake:1:0x000000b1") }),
  ],
  fakeChain: withLaunchpadRouter(),
};

// The skeleton on both compositions, with the owner's rescue address in effect unless left out.
async function servedMachine(
  name: string,
  hasRescue = true,
  options: SkeletonOptions = {},
): Promise<TestMachine> {
  const composition = skeletonCompositions.find((item) => item.name === name);
  if (composition === undefined) {
    throw new Error(`Expected the ${name} composition.`);
  }
  const machine = await machines.create(testNowMs);
  const skeleton = await serveSkeleton(machine, composition, options);
  served.push(skeleton);
  if (hasRescue) {
    const address = accountRefSchema.parse("fake:1:0x000000a1");
    await skeleton.parts.stores.install.changeRescue(
      { address, atMs: testNowMs - dayMs * 2 },
      live,
    );
  }
  return machine;
}

function walletIn(text: string): string {
  return /wal_[0-9a-f-]+/.exec(text)?.[0] ?? "";
}

function secondLine(text: string): string {
  return text.split("\n")[1] ?? "";
}

async function create(
  machine: TestMachine,
  argv: readonly string[],
  answers: readonly ScriptedAnswer[],
) {
  const prompter = createScriptedPrompter({ ownerKey: answers });
  const host = hostWith(machine, ["wallet", "create", ...argv], { env: {}, parts: { prompter } });
  const code = await runCli(host);
  return { code, stdout: host.stdout(), stderr: host.stderr(), prompter };
}

describe.each(skeletonCompositions)("binference wallet create ($name)", ({ name }) => {
  it("makes a wallet with the owner key typed unseen, then lists it", slow, async () => {
    const machine = await servedMachine(name);

    const made = await create(machine, ["--label", "spare"], [fakeOwnerKeyCode]);

    const wallet = walletIn(made.stdout);
    // The CLI names a chain this binference does not serve by its id.
    const values = { label: "spare", wallet, agent: testAgent, chain: "fake:1" };
    expect([made.code, made.stderr]).toStrictEqual([0, ""]);
    expect(made.stdout).toBe(`${en("wallet.created", values)}\n${secondLine(made.stdout)}\n`);
    expect(secondLine(made.stdout)).toMatch(/^0x[0-9a-f]{8}$/);
    expect(made.prompter.transcript.asked).toStrictEqual(["ownerKey"]);
    const listed = await runOn(machine, ["wallet", "list", "--json"]);
    const page: unknown = JSON.parse(listed.stdout);
    expect(page).toMatchObject({ items: [{ label: "Main" }, { label: "spare", wallet }] });
  });
});

describe("binference wallet create --launch", () => {
  it(
    "makes the agent's launch wallet, lists it and shows it in the status, once",
    slow,
    async () => {
      const machine = await servedMachine("self-hosted", true, launchpads);

      const made = await create(machine, ["--label", "curves", "--launch"], [fakeOwnerKeyCode]);
      const again = await create(machine, ["--label", "more", "--launch"], [fakeOwnerKeyCode]);

      const wallet = walletIn(made.stdout);
      const values = { label: "curves", wallet, agent: testAgent, chain: "fake:1" };
      expect([made.code, made.stderr]).toStrictEqual([0, ""]);
      expect(made.stdout).toBe(
        `${en("wallet.createdLaunch", values)}\n${secondLine(made.stdout)}\n`,
      );
      expect([again.code, again.stderr]).toStrictEqual([
        2,
        `${String(messages.en["error.wallet.launch_exists"])}\n`,
      ]);
      const listed = await runOn(machine, ["wallet", "list"]);
      const address = secondLine(made.stdout);
      const shown = { ...values, address, role: "launch", extra: "no", archived: "no" };
      const item = en("wallet.item", shown);
      expect(listed.stdout).toContain(item);
      expect(item).toContain(", launch wallet");
      const status = await runOn(machine, ["status"]);
      expect(status.stdout).toContain(en("status.launchWallet", { id: testAgent, wallet }));
    },
  );
});

describe("binference wallet create", () => {
  it("makes nothing with no rescue address or a wrong owner key", slow, async () => {
    const machine = await servedMachine("self-hosted");
    const unset = await servedMachine("self-hosted", false);

    const bare = await create(unset, ["--label", "spare"], [fakeOwnerKeyCode]);
    expect([bare.code, bare.stderr]).toStrictEqual([
      1,
      `${String(messages.en["error.rescue.no_address"])}\n`,
    ]);
    const wrong = await create(machine, ["--label", "spare"], [wrongKey, wrongKey, wrongKey]);
    expect([wrong.code, wrong.stderr]).toStrictEqual([1, `${en("ownerKey.wrongEnd")}\n`]);
    const listed = await runOn(machine, ["wallet", "list", "--json"]);
    expect(listed.stdout).not.toContain("spare");
  });

  it("never takes the owner key without a person at the terminal", slow, async () => {
    const machine = await servedMachine("self-hosted");

    const scripted = await runOn(machine, ["wallet", "create", "--label", "x", "--json"]);
    expect([scripted.code, scripted.stdout]).toStrictEqual([
      1,
      `${JSON.stringify({ error: { code: "wallet.bad_owner_key" } })}\n`,
    ]);
    const flagged = await runOn(machine, ["wallet", "create", "--label", "x", "--owner-key", "y"]);
    expect([flagged.code, flagged.stderr]).toStrictEqual([1, `${en("usage.invalid")}\n`]);
  });
});

describe("binference wallet create --launch without a launchpad", () => {
  it("makes nothing when no launchpad the install runs declares a launch call", slow, async () => {
    const machine = await servedMachine("self-hosted");

    const refused = await create(machine, ["--label", "curves", "--launch"], [fakeOwnerKeyCode]);

    expect([refused.code, refused.stderr]).toStrictEqual([
      2,
      `${String(messages.en["error.wallet.no_launch_calls"])}\n`,
    ]);
  });
});
