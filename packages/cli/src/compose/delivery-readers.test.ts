import { accountRefSchema, assetRefSchema, isTxHash, type TxHash } from "@binference/chain";
import { deliveryReaderContract } from "@binference/chain/testing";
import { arbitrum, ethereum } from "@binference/chains";
import type { Http, HttpResponse } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { deliveryReaderOf } from "./delivery-readers.js";
import evmFill from "./recorded/arbitrum-usdc-fill.json" with { type: "json" };

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

/** One JSON-RPC call a recorded node received: its method and its params. */
interface RecordedCall {
  readonly method: string;
  readonly params: readonly unknown[];
}

/**
 * An Http for tests that answers every endpoint's JSON-RPC calls from one recording, with no
 * network: `answerFirst` answers a call first when it gives a result, and a call neither knows gets an
 * RPC error.
 */
function recordedChainHttp(
  recording: unknown,
  answerFirst: (call: RecordedCall) => { readonly result: unknown } | undefined = () => undefined,
): Http {
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
      const given = answerFirst(call);
      const reply =
        given ??
        (recorded === undefined
          ? { error: { code: -32_602, message: "not recorded" } }
          : { result: recorded });
      const body = JSON.stringify({ jsonrpc: "2.0", id: call.id, ...reply });
      return await Promise.resolve({ status: 200, headers: {}, body });
    },
  };
}

function hashOf(text: string): TxHash {
  if (!isTxHash(text)) {
    throw new Error("Expected a transaction hash.");
  }
  return text;
}

// An Across fill on Arbitrum One as its RPC answered it, and two hashes the recording never saw:
// one this test makes revert, one no block holds.
const fill = hashOf("0xf808ab59453dcde518dd2566d067aedd9496a80453210a9cbb2379b417ba9aa1");
const reverted = hashOf(`0x${"bb".repeat(32)}`);
const unknown = hashOf(`0x${"cc".repeat(32)}`);
const recipient = accountRefSchema.parse(
  `${arbitrum.id}:0x168E0c5AE6B259883D878C89C042ad6347F8ba85`,
);
const usdc = assetRefSchema.parse(
  `${arbitrum.id}/erc20:0xaf88d065e77c8cC2239327C5EDb3A432268e5831`,
);
const fillReceipt = evmFill.answers.find(
  ({ method, params }) => method === "eth_getTransactionReceipt" && params[0] === fill,
)?.result;

function override(call: RecordedCall): { readonly result: unknown } | undefined {
  const [hash] = call.params;
  if (call.method === "eth_getTransactionReceipt" && hash === reverted) {
    return {
      result: { ...(fillReceipt as object), transactionHash: reverted, status: "0x0", logs: [] },
    };
  }
  return hash === unknown ? { result: null } : undefined;
}

const clock = createManualClock();

function arbitrumReader() {
  const reader = deliveryReaderOf(arbitrum, { http: recordedChainHttp(evmFill, override), clock });
  if (reader === undefined) {
    throw new Error("Expected Arbitrum One's delivery reader.");
  }
  return reader;
}

describe("the delivery readers of the chains a bridge reads", () => {
  it.each(
    deliveryReaderContract({
      create: async () => {
        return await Promise.resolve({
          reader: arbitrumReader(),
          recipient,
          holding: { asset: usdc, base: 599_532_886n },
          delivered: fill,
          received: { asset: usdc, base: 288_148_284n },
          emitter: accountRefSchema.parse(
            `${arbitrum.id}:0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A`,
          ),
          failed: reverted,
          unknown,
          stranger: accountRefSchema.parse(
            `${ethereum.id}:0x168E0c5AE6B259883D878C89C042ad6347F8ba85`,
          ),
        });
      },
    }),
  )("follow the contract on an EVM chain: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("gives an EVM chain whose registry lists no Multicall3 no reader", () => {
    const bare = { ...arbitrum, contracts: [] };
    expect(deliveryReaderOf(bare, { http: recordedChainHttp(evmFill), clock })).toBeUndefined();
  });
});
