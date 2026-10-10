import { fakeOwnerKeyCode, testNowMs } from "@binference/engine/testing";
import { createFormatter, messages } from "@binference/i18n";
import { afterEach, describe, expect, it } from "vitest";
import { skeletonCompositions, skeletonWalletKey } from "../compose/test-skeleton.js";
import { runCli } from "../program/run-cli.js";
import { createScriptedPrompter, type ScriptedAnswer } from "../term/scripted-prompter.js";
import { type ServedSkeleton, serveSkeleton } from "./skeleton-machine.js";
import { createTestMachines, hostWith, runOn, type TestMachine } from "./test-host.js";

const slow = { timeout: 60_000 };
const machines = createTestMachines();
const served: ServedSkeleton[] = [];
const english = createFormatter({ locale: "en", timeZone: "UTC" });
const en = (key: string, values: Readonly<Record<string, string>> = {}): string =>
  english.message(`cli.${key}`, values);
const wrongKey = (letter: string): string => `bnok1${letter.repeat(25)}`;

afterEach(async () => {
  await Promise.all(served.splice(0).map(async (skeleton) => skeleton.close()));
  await machines.removeAll();
});

async function servedMachine(name = "self-hosted"): Promise<TestMachine> {
  const composition = skeletonCompositions.find((item) => item.name === name);
  if (composition === undefined) {
    throw new Error(`Expected the ${name} composition.`);
  }
  const machine = await machines.create(testNowMs);
  served.push(await serveSkeleton(machine, composition));
  return machine;
}

// The default wallet's address, as `wallet address --json` prints it.
async function addressOn(machine: TestMachine): Promise<string> {
  const shown = await runOn(machine, ["wallet", "address", "--json"]);
  const { address } = JSON.parse(shown.stdout) as { readonly address: string };
  return address.split(":").at(-1) ?? "";
}

async function exportOn(
  machine: TestMachine,
  answers: {
    readonly addressEnd: readonly ScriptedAnswer[];
    readonly ownerKey: readonly ScriptedAnswer[];
  },
) {
  const prompter = createScriptedPrompter(answers);
  const host = hostWith(machine, ["wallet", "export"], { env: {}, parts: { prompter } });
  const code = await runCli(host);
  return { code, stdout: host.stdout(), stderr: host.stderr(), prompter };
}

function timesIn(text: string, part: string): number {
  return text.split(part).length - 1;
}

describe("binference wallet export", () => {
  it(
    "warns, takes the address's end and the owner key, then shows the key once",
    slow,
    async () => {
      const machine = await servedMachine();
      const address = await addressOn(machine);

      const shown = await exportOn(machine, {
        addressEnd: ["zzzz", address.slice(-4).toUpperCase()],
        ownerKey: [fakeOwnerKeyCode],
      });

      expect([shown.code, shown.stderr]).toStrictEqual([0, ""]);
      expect(timesIn(shown.stdout, skeletonWalletKey)).toBe(1);
      expect(shown.stdout).toContain(`${en("walletExport.shown", { label: "Main", address })}\n`);
      expect(shown.prompter.transcript.asked).toStrictEqual([
        "addressEnd",
        "addressEnd",
        "ownerKey",
      ]);
      expect(shown.prompter.transcript.notes).toStrictEqual([
        {
          title: en("walletExport.warningTitle", { address }),
          text: en("walletExport.warning", { address }),
        },
      ]);
      expect(shown.prompter.transcript.lines).toContain(en("walletExport.wrongEnd", { address }));
    },
  );

  it("shows nothing without a terminal or after three wrong owner keys", slow, async () => {
    const machine = await servedMachine();
    const address = await addressOn(machine);

    const scripted = await runOn(machine, ["wallet", "export", "--json"]);
    const wrong = await exportOn(machine, {
      addressEnd: [address.slice(-4)],
      ownerKey: [wrongKey("a"), wrongKey("b"), wrongKey("c")],
    });

    expect([scripted.code, scripted.stdout]).toStrictEqual([
      1,
      `${JSON.stringify({ error: { code: "wallet.bad_owner_key" } })}\n`,
    ]);
    expect(wrong.code).toBe(1);
    expect(wrong.stderr).toContain(en("ownerKey.wrongEnd"));
    expect(timesIn(wrong.stdout, skeletonWalletKey)).toBe(0);
  });

  it("says custody exports nothing where it gives no export", slow, async () => {
    const machine = await servedMachine("Cloud-shaped");
    const address = await addressOn(machine);

    const refused = await exportOn(machine, {
      addressEnd: [address.slice(-4)],
      ownerKey: [fakeOwnerKeyCode],
    });

    expect([refused.code, refused.stderr]).toStrictEqual([
      1,
      `${String(messages.en["error.wallet.custody_down"])}\n`,
    ]);
  });
});
