import { accountRefSchema, assetRefSchema } from "@binference/chain";
import { bsc } from "@binference/chains";
import type { JsonValue } from "@binference/core";
import { encodeAbiParameters, type Hex, keccak256, pad, toHex } from "viem";
import { describe, expect, inject, it, onTestFailed } from "vitest";
import { z } from "zod";
import { rescueAddress } from "../e2e/init-fixtures.js";
import type { CrashContext } from "./crash-context.js";
import { useCrashHarness } from "./crash-harness.js";
import {
  crashIntentOnce,
  type IntentRun,
  oneStepKillCases,
  sentOnceOf,
  sentSummaryOf,
} from "./crash-intent-runs.js";
import { crashRouter, crashUsdt } from "./crash-market.js";
import { crashUsdtAsset } from "./crash-orders.js";
import type { CrashInstall } from "./crash-runs.js";

// Each run sends from a fresh install as the owner does from the CLI, a send of BNB to the rescue
// address or a revoke of a router's USDT allowance, and kills the engine outright at the run's
// point between the signature and the send or between the send and the receipt; a second engine
// on the same folder recovers. What reached the chain is counted by the test's relays and anvil,
// the signatures by the test's Privy, never taken from the engine.
const crash: CrashContext = inject("crash");
const harness = useCrashHarness(crash, { seed: 41 });
const runs = Array.from({ length: crash.runs }, (_, index) => index + 1);

/** A transfer a run makes, by the name its kill points carry. */
interface TransferRun extends IntentRun {
  readonly name: string;
}

const send: TransferRun = {
  name: "a send of BNB",
  executions: 0,
  requestOf: (agent) => ({
    kind: "send",
    agent,
    reason: "Send BNB to the rescue address",
    amount: { asset: assetRefSchema.parse(`${bsc.id}/slip44:714`), base: 10n ** 16n },
    to: { address: accountRefSchema.parse(`${bsc.id}:${rescueAddress}`) },
  }),
  // The rescue address gets the 0.01 BNB once.
  effect: {
    read: async (world) =>
      wordOf(await world.chain.call("eth_getBalance", [rescueAddress, "latest"])),
    moves: 10n ** 16n,
  },
};

const hexSchema = z.string().regex(/^0x[0-9a-f]*$/u);

function wordOf(answer: JsonValue): bigint {
  return BigInt(hexSchema.parse(answer));
}

// The slot of what the wallet lets KyberSwap's router move: the crash token keeps an allowance in
// the slot of the hash of its owner and spender.
function allowanceSlot(install: CrashInstall): Hex {
  const owners = [{ type: "address" }, { type: "address" }] as const;
  return keccak256(encodeAbiParameters(owners, [install.from, crashRouter]));
}

const revoke: TransferRun = {
  name: "an approval revoke",
  executions: 0,
  requestOf: (agent) => ({
    kind: "revokeApproval",
    agent,
    reason: "Clear the router's USDT allowance",
    token: crashUsdtAsset,
    spender: accountRefSchema.parse(`${bsc.id}:${crashRouter}`),
  }),
  // The wallet lets KyberSwap's router move 5 USDT, as a sale left it.
  prepare: async (world, install) => {
    const units = pad(toHex(5n * 10n ** 18n), { size: 32 });
    await world.chain.call("anvil_setStorageAt", [crashUsdt, allowanceSlot(install), units]);
    return install.from;
  },
  // The allowance falls to zero once.
  effect: {
    read: async (world, install) =>
      wordOf(
        await world.chain.call("eth_getStorageAt", [crashUsdt, allowanceSlot(install), "latest"]),
      ),
    moves: -5n * 10n ** 18n,
  },
};

const { signed, stored, sent, included } = oneStepKillCases;
const cases = [send, revoke].flatMap((run) =>
  [signed, stored, sent, included].map((killCase) =>
    Object.assign({ run, name: run.name }, killCase),
  ),
);

describe.each(cases)("an engine killed at $point during $name", (killCase) => {
  it.each(runs)("sends one transaction at most, run %i", async () => {
    const outcome = await crashIntentOnce(harness, killCase.run, killCase);
    onTestFailed(() => {
      process.stderr.write(`${outcome.story}\n`);
    });
    expect(sentSummaryOf(outcome)).toStrictEqual(sentOnceOf(killCase, killCase.run));
  });
});
