import { chainRefSchema, type TxHash } from "@binference/chain";
import { createFakeIdentityRegistry } from "@binference/chain/testing";
import { err, ok } from "@binference/core";
import type { EngineHandlerTable } from "@binference/engine/surfaces";
import {
  fakeOwnerKeyCode,
  testAgent,
  testCoin,
  testNowMs,
  testToken,
  testWallet,
} from "@binference/engine/testing";
import { createFormatter, messages } from "@binference/i18n";
import type { IntentView } from "@binference/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { skeletonCompositions } from "../compose/test-skeleton.js";
import { runCli } from "../program/run-cli.js";
import { createScriptedPrompter, type ScriptedAnswer } from "../term/scripted-prompter.js";
import { type ServedSkeleton, serveSkeleton } from "./skeleton-machine.js";
import { createTestMachines, hostWith, runOn, type TestMachine } from "./test-host.js";

const slow = { timeout: 60_000 };
const machines = createTestMachines();
const served: ServedSkeleton[] = [];
const [selfHosted] = skeletonCompositions;
const registry = createFakeIdentityRegistry({
  chain: chainRefSchema.parse("fake:1"),
  address: "0x000000e5",
});
const identity = { registries: [registry], version: "2026.11.3" };
const registration = {
  registry: registry.registry,
  onchainId: "42",
  txHash: `0x${"ab".repeat(32)}` as TxHash,
  registeredAt: testNowMs,
  file: "data:application/json;base64,e30=",
} as const;

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

// The skeleton running the fake identity registry, with the handlers the test answers itself.
async function servedSkeleton(handlers: EngineHandlerTable = {}) {
  if (selfHosted === undefined) {
    throw new Error("Expected the self-hosted composition.");
  }
  const machine = await machines.create(testNowMs);
  const skeleton = await serveSkeleton(machine, selfHosted, { identity, handlers });
  served.push(skeleton);
  return { machine, skeleton };
}

async function servedMachine(handlers: EngineHandlerTable = {}) {
  return (await servedSkeleton(handlers)).machine;
}

// A command line run by a person at the terminal, who answers the questions given.
async function typed(
  machine: TestMachine,
  argv: readonly string[],
  answers: Readonly<Record<string, readonly ScriptedAnswer[]>>,
) {
  const prompter = createScriptedPrompter(answers);
  const host = hostWith(machine, argv, { env: {}, parts: { prompter } });
  const code = await runCli(host);
  return { code, stdout: host.stdout(), stderr: host.stderr(), prompter };
}

// The card the stub answers a registration with, once the test proposed it.
function viewOf(card: { readonly view?: IntentView }) {
  return card.view === undefined ? err("agent.not_found" as const) : ok(card.view);
}

const swap = {
  kind: "swap",
  agent: testAgent,
  wallet: testWallet,
  reason: "Rotate into the token",
  from: testCoin,
  to: testToken,
  amount: { base: 1_000_000n },
} as const;

describe("binference agent identity", () => {
  it("says why a paper agent registers nothing, and exits 1", slow, async () => {
    const machine = await servedMachine();
    const run = await runOn(machine, ["agent", "identity", "--description", "Buys dips"]);
    const json = await runOn(machine, ["agent", "identity", "--json"]);

    expect(run.code).toBe(1);
    expect(run.stdout).toBe("");
    expect(run.stderr).toMatch(/^binference registered nothing \(int_[^)]+\)\. /u);
    expect(run.stderr).toContain(String(messages.en["reason.paper_only"]));
    expect(json.code).toBe(1);
    expect(JSON.parse(json.stdout)).toMatchObject({
      state: "rejected_policy",
      reason: "paper_only",
    });
  });

  it("shows the identity binference holds, without opening a card", slow, async () => {
    const machine = await servedMachine({
      "identity/get": async () => Promise.resolve(ok({ registration })),
      "identity/register": async () => {
        throw new Error("Expected no registration.");
      },
    });
    const run = await runOn(machine, ["agent", "identity"]);
    const json = await runOn(machine, ["agent", "identity", "--json"]);
    const when = createFormatter({ locale: "en", timeZone: "UTC" }).dateTime(testNowMs);

    expect(run).toMatchObject({
      code: 0,
      stderr: "",
      stdout: `${en("identity.registered", {
        id: "42",
        registry: registry.registry,
        tx: registration.txHash,
        when,
      })}\n`,
    });
    const { file: _file, ...shown } = registration;
    expect(JSON.parse(json.stdout)).toStrictEqual({ registration: shown });
  });

  it(
    "opts a live agent in with the owner key typed unseen, then opens its card",
    slow,
    async () => {
      const keys: string[] = [];
      const card: { view?: IntentView } = {};
      const { machine, skeleton } = await servedSkeleton({
        "identity/allow": async ({ args }) => {
          keys.push(args.ownerKey);
          return Promise.resolve(ok({ wallet: testWallet, changed: true }));
        },
        "identity/register": async () => Promise.resolve(viewOf(card)),
      });
      expect((await typed(machine, ["live"], { disclaimer: ["I understand"] })).code).toBe(0);
      card.view = await skeleton.client.call("intent/propose", swap, {
        signal: AbortSignal.timeout(10_000),
      });

      const run = await typed(machine, ["agent", "identity"], { ownerKey: [fakeOwnerKeyCode] });

      expect(run.prompter.transcript.asked).toStrictEqual(["ownerKey"]);
      expect(keys).toStrictEqual([fakeOwnerKeyCode]);
      expect(run.stdout).toContain(`${en("identity.allowed", { wallet: testWallet })}\n`);
      expect(run.stdout).toContain(`${en("identity.opened", { intent: card.view.intent })}\n`);
      expect([run.code, run.stderr]).toStrictEqual([0, ""]);
    },
  );

  it("asks a paper agent for no owner key, as nothing it registers could sign", slow, async () => {
    const machine = await servedMachine();

    const run = await typed(machine, ["agent", "identity"], { ownerKey: [fakeOwnerKeyCode] });

    expect(run.prompter.transcript.asked).toStrictEqual([]);
    expect(run.code).toBe(1);
  });

  it("refuses a description over 280 characters before calling the engine", slow, async () => {
    const machine = await servedMachine();
    const run = await runOn(machine, ["agent", "identity", "--description", "x".repeat(281)]);

    expect(run.code).toBe(1);
    expect(run.stderr).toBe(`${en("usage.invalid")}\n`);
  });
});
