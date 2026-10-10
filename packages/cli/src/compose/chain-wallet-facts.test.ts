import { accountRefSchema, assetRefSchema, chainRefSchema } from "@binference/chain";
import { bsc } from "@binference/chains";
import { type Http, idSchema, type JsonValue } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import {
  createMemoryEngineStores,
  createMemoryInstallStore,
  testWalletRecord,
  walletFactsSourceContract,
} from "@binference/engine/testing";
import {
  decodeFunctionData,
  encodeFunctionResult,
  type Hex,
  multicall3Abi,
  numberToHex,
} from "viem";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { composeChainReads } from "./chain-reads.js";
import { createChainWalletFacts } from "./chain-wallet-facts.js";
import { selfHostedChains } from "./open-engine-parts.js";

const nowMs = 1_800_000_000_000;
const bscRef = chainRefSchema.parse(bsc.id);
const agent = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const stranger = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000009");
const first = idSchema("wal").parse("wal_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const second = idSchema("wal").parse("wal_0190f1c2-3a4b-7c5d-8e6f-000000000002");
const archived = idSchema("wal").parse("wal_0190f1c2-3a4b-7c5d-8e6f-000000000003");
const address = "0x8894E0a0c962CB723c1976a4421c95949bE2D4E3";
const account = accountRefSchema.parse(`${bsc.id}:${address}`);
const coin = assetRefSchema.parse(`${bsc.id}/slip44:714`);
const usdt = assetRefSchema.parse(`${bsc.id}/erc20:0x55d398326f99059fF775485246999027B3197955`);
const coinHeld = 3n * 10n ** 18n;
const usdtHeld = 18_446_744_073_709_551_617n;
const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });

const word = (value: bigint): Hex => numberToHex(value, { size: 32 });
const rpcSchema = z.object({ id: z.int(), method: z.string(), params: z.array(z.unknown()) });
const callSchema = z.tuple([z.object({ data: z.string() }), z.string()]);

// The answer of a BSC node to each read the wallet facts make.
function answerOf(method: string, params: readonly unknown[]): JsonValue {
  if (method === "eth_getBalance") {
    return numberToHex(coinHeld);
  }
  if (method === "eth_maxPriorityFeePerGas") {
    return numberToHex(50_000_000n);
  }
  if (method === "eth_getBlockByNumber") {
    return { number: "0x1", baseFeePerGas: numberToHex(1_000_000_000n) };
  }
  const [call] = callSchema.parse(params);
  const decoded = decodeFunctionData({
    abi: multicall3Abi,
    data: z.custom<Hex>().parse(call.data),
  });
  const asked = z.array(z.object({ target: z.string() })).parse(decoded.args[0]);
  const result = asked.map(({ target }) => ({
    success: true,
    returnData: word(target.startsWith("0xcA11") ? coinHeld : usdtHeld),
  }));
  return encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result });
}

const node: Http = {
  async request(request) {
    request.signal.throwIfAborted();
    const { id, method, params } = rpcSchema.parse(JSON.parse(request.body ?? "null"));
    const body = JSON.stringify({ jsonrpc: "2.0", id, result: answerOf(method, params) });
    return Promise.resolve({ status: 200, headers: {}, body });
  },
};

function source() {
  const install = createMemoryInstallStore();
  for (const [id, createdAtMs, archivedAtMs] of [
    [first, 1, undefined],
    [second, 2, undefined],
    [archived, 3, 4],
  ] as const) {
    const record = testWalletRecord({ id, agentId: agent, label: "main", createdAtMs });
    install.addWallet({
      ...record,
      family: "evm",
      address,
      ...(archivedAtMs === undefined ? {} : { archivedAtMs }),
    });
  }
  const clock = createManualClock(nowMs);
  const config = { enabled: [bscRef], rpc: {}, relays: {}, maxFeePerGasGwei: { [bscRef]: "1" } };
  const reads = composeChainReads({ chains: selfHostedChains(), config, http: node, clock });
  const { intents } = createMemoryEngineStores();
  return { facts: createChainWalletFacts({ install, intents, reads, clock }), intents };
}

const intentId = (n: number) =>
  idSchema("int").parse(`int_0190f1c2-3a4b-7c5d-8e6f-00000000000${n}`);

// An intent of the agent confirmed a second ago at a judged value, as the policy stored it.
const confirmedDraft = (n: number, valueUsdMicros: bigint) =>
  ({
    id: intentId(n),
    agentId: agent,
    walletId: second,
    kind: "swap",
    state: "confirmed",
    request: {},
    hasOutsideContent: false,
    isPaper: false,
    proposer: "engine",
    atMs: nowMs - 1_000,
    cause: {},
    valueUsdMicros,
  }) as const;

describe("the self-hosted wallet facts", () => {
  it.each(
    walletFactsSourceContract({
      create: () => ({
        source: source().facts,
        agent,
        wallet: first,
        account,
        stranger,
        assets: [coin, usdt],
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("lists the agent's live wallets oldest first and reads its balances in one call", async () => {
    const { facts } = source();
    await expect(facts.wallets(agent, live())).resolves.toStrictEqual([first, second]);
    await expect(facts.balances({ account, assets: [usdt, coin] }, live())).resolves.toStrictEqual([
      { asset: usdt, base: usdtHeld },
      { asset: coin, base: coinHeld },
    ]);
  });

  it("reads a live wallet's coin, the fee per gas, the caps and the day's confirmations", async () => {
    const { facts, intents } = source();
    await intents.create(confirmedDraft(1, 7_000_001n), live());
    await intents.create(confirmedDraft(2, 5n), live());
    const query = { agent, wallet: first, account, isPaper: false };
    await expect(facts.facts(query, live())).resolves.toStrictEqual({
      nativeBalanceBase: coinHeld,
      ceilingPerTxNativeBase: 10n ** 18n,
      feePerGasNativeBase: 2_050_000_000n,
      networkFeeCapNativeBase: 1_000_000_000n,
      recentOutflows: [
        { atMs: nowMs - 1_000, valueUsdMicros: 7_000_001n },
        { atMs: nowMs - 1_000, valueUsdMicros: 5n },
      ],
    });
    await expect(facts.facts({ ...query, intent: intentId(2) }, live())).resolves.toMatchObject({
      recentOutflows: [{ atMs: nowMs - 1_000, valueUsdMicros: 7_000_001n }],
    });
    await expect(facts.facts({ ...query, isPaper: true }, live())).resolves.toMatchObject({
      nativeBalanceBase: 0n,
      recentOutflows: [],
    });
  });

  it("refuses the facts of a wallet that is not the agent's live one", async () => {
    const { facts } = source();
    const query = { agent, wallet: archived, account, isPaper: false };
    await expect(facts.facts(query, live())).rejects.toMatchObject({ code: "wallet.not_found" });
    const elsewhere = accountRefSchema.parse(`eip155:1:${address}`);
    await expect(
      facts.facts({ ...query, wallet: first, account: elsewhere }, live()),
    ).rejects.toMatchObject({ code: "cli.no_chain_parts" });
  });
});
