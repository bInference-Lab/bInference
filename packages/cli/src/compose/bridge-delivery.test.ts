import { createAcrossBridge } from "@binference/across";
import {
  accountRefSchema,
  assetRefSchema,
  type ChainDefinition,
  chainRefSchema,
  type DeliveryReader,
  isTxHash,
  type TxHash,
} from "@binference/chain";
import { arbitrum, bsc, solana } from "@binference/chains";
import type { Http, HttpResponse } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { startBridgeFollowBench } from "@binference/engine/testing";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { bridgeContractsOf, bridgeRoutesOf } from "./bridge-routes.js";
import { deliveryReaderOf } from "./delivery-readers.js";
import acrossStatus from "./recorded/across-fill-status.json" with { type: "json" };
import evmFill from "./recorded/arbitrum-usdc-fill.json" with { type: "json" };
import bscDeposit from "./recorded/bsc-usdc-deposit.json" with { type: "json" };
import solanaFill from "./recorded/solana-usdc-fill.json" with { type: "json" };

// A recording holds what a chain's public RPC answered for each call, by method and params.
const recordedSchema = z.object({
  answers: z.array(
    z.object({ method: z.string(), params: z.array(z.unknown()), result: z.unknown() }),
  ),
});
const callSchema = z.object({
  id: z.union([z.string(), z.number()]),
  method: z.string(),
  params: z.array(z.unknown()).default([]),
});

/**
 * An Http for tests that answers every endpoint's JSON-RPC calls from one recording, with no
 * network; a call it lacks gets an RPC error.
 */
function recordedChainHttp(recording: unknown): Http {
  const answers = new Map(
    recordedSchema
      .parse(recording)
      .answers.map(({ method, params, result }) => [`${method}${JSON.stringify(params)}`, result]),
  );
  return {
    async request(request): Promise<HttpResponse> {
      request.signal.throwIfAborted();
      const call = callSchema.parse(JSON.parse(request.body ?? "null"));
      const recorded = answers.get(`${call.method}${JSON.stringify(call.params)}`);
      const reply =
        recorded === undefined
          ? { error: { code: -32_602, message: "not recorded" } }
          : { result: recorded };
      const body = JSON.stringify({ jsonrpc: "2.0", id: call.id, ...reply });
      return await Promise.resolve({ status: 200, headers: {}, body });
    },
  };
}

function readerOf(definition: ChainDefinition, recording: unknown): DeliveryReader {
  const reader = deliveryReaderOf(definition, {
    http: recordedChainHttp(recording),
    clock: createManualClock(),
  });
  if (reader === undefined) {
    throw new Error(`Expected a delivery reader of ${definition.name}.`);
  }
  return reader;
}

function hashOf(text: string): TxHash {
  if (!isTxHash(text)) {
    throw new Error("Expected a transaction hash.");
  }
  return text;
}

const evm = {
  chain: accountRefSchema.parse(`${arbitrum.id}:0x168E0c5AE6B259883D878C89C042ad6347F8ba85`),
  token: assetRefSchema.parse(`${arbitrum.id}/erc20:0xaf88d065e77c8cC2239327C5EDb3A432268e5831`),
  fill: hashOf("0xf808ab59453dcde518dd2566d067aedd9496a80453210a9cbb2379b417ba9aa1"),
  base: 288_148_284n,
};
// The deposit on BSC Across filled with that fill: 288.504212627345096261 USDC from its depositor.
const evmDeposit = {
  hash: hashOf("0x0f22262e55fba116b38ba98b7d5866102e2fde1a89f9b08177bd8127658a1674"),
  sent: {
    asset: assetRefSchema.parse(`${bsc.id}/erc20:0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d`),
    base: 288_504_212_627_345_096_261n,
  },
  wallet: accountRefSchema.parse(`${bsc.id}:0x144c5fb302dbaa789fc59bbec301169eaa56c5fc`),
};

// Across over its recorded status of that deposit, with the registry's routes and SpokePools.
function recordedAcross() {
  const answer = JSON.stringify(z.object({ answer: z.unknown() }).parse(acrossStatus).answer);
  const http: Http = {
    request: async () => Promise.resolve({ status: 200, headers: {}, body: answer }),
  };
  const routes = bridgeRoutesOf("across");
  const spokePools = bridgeContractsOf("across", "spoke-pool");
  return createAcrossBridge({ http, chains: [chainRefSchema.parse(bsc.id)], routes, spokePools });
}

// Arbitrum One's reader over the recorded fill, and BSC's over the recorded deposit.
const evmReaders = () => [readerOf(arbitrum, evmFill), readerOf(bsc, bscDeposit)];
// A fill on Solana whose memo names the deposit it settles, as the fake bridge takes its own.
const sol = {
  deposit: hashOf("0xe74b2e9ec4a759b595bb17cf1211d490a31a0a61788d9710fc5c19de055a5f2e"),
  chain: accountRefSchema.parse(`${solana.id}:A9YsiCuAtY5RT3nfLKZTz2EuxxXf3FZogPqHkSH89SXT`),
  token: assetRefSchema.parse(`${solana.id}/token:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`),
  fill: hashOf(
    "4QN4bPaaZguhX2hxpkabijEJcKZ4WpFn4TxTsGCVyuJd5ccSTGn6BN7aaowMjRjyzvy3gGWag75ouQPC6p7zDbu4",
  ),
  base: 3_074_273n,
};

describe("a bridge's delivery read from a recorded destination", () => {
  it("reconciles once on an EVM chain, Across matching its FilledRelay to the BSC deposit", async () => {
    const bench = await startBridgeFollowBench({
      readers: evmReaders(),
      recipient: evm.chain,
      minOut: { asset: evm.token, base: evm.base },
      fill: { chain: chainRefSchema.parse(arbitrum.id), hash: evm.fill },
      deposit: evmDeposit,
      bridge: recordedAcross(),
    });

    await bench.follow();
    await bench.follow();

    expect(await bench.states()).toStrictEqual(["reconciled", "delivered"]);
  });

  it("reconciles once on Solana, its memo event naming the deposit it settles", async () => {
    const reader = readerOf(solana, solanaFill);
    const bench = await startBridgeFollowBench({
      readers: [reader],
      recipient: sol.chain,
      minOut: { asset: sol.token, base: sol.base },
      fill: { chain: reader.chain, hash: sol.fill },
      depositHash: sol.deposit,
    });

    await bench.follow();
    await bench.follow();

    expect(await bench.states()).toStrictEqual(["reconciled", "delivered"]);
  });

  it("leaves a bridge in transit when the recorded fill paid less than its least output", async () => {
    const bench = await startBridgeFollowBench({
      readers: evmReaders(),
      recipient: evm.chain,
      minOut: { asset: evm.token, base: evm.base + 1n },
      fill: { chain: chainRefSchema.parse(arbitrum.id), hash: evm.fill },
      deposit: evmDeposit,
      bridge: recordedAcross(),
    });

    await bench.follow();

    expect(await bench.states()).toStrictEqual(["finalized", "in_transit"]);
  });

  it("leaves a bridge in transit when its deposit is another than the one the fill names", async () => {
    const other = { ...evmDeposit, sent: { ...evmDeposit.sent, base: evmDeposit.sent.base - 1n } };
    const bench = await startBridgeFollowBench({
      readers: evmReaders(),
      recipient: evm.chain,
      minOut: { asset: evm.token, base: evm.base },
      fill: { chain: chainRefSchema.parse(arbitrum.id), hash: evm.fill },
      deposit: other,
      bridge: recordedAcross(),
    });

    await bench.follow();

    expect(await bench.states()).toStrictEqual(["finalized", "in_transit"]);
  });

  it("leaves a Solana bridge in transit when the fill's memo names another deposit", async () => {
    const reader = readerOf(solana, solanaFill);
    const bench = await startBridgeFollowBench({
      readers: [reader],
      recipient: sol.chain,
      minOut: { asset: sol.token, base: sol.base },
      fill: { chain: reader.chain, hash: sol.fill },
    });

    await bench.follow();

    expect(await bench.states()).toStrictEqual(["finalized", "in_transit"]);
  });
});
