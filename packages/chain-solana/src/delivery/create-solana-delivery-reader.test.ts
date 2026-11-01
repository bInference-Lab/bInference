import { type AccountRef, type AssetRef, accountRefSchema, type TxHash } from "@binference/chain";
import { deliveryReaderContract } from "@binference/chain/testing";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createSolanaRpcClient } from "../rpc/create-solana-rpc-client.js";
import type { SolanaChain } from "../solana-chain.js";
import {
  createFakeSolanaHttp,
  type FakeSolanaCall,
  jsonRpcAnswer,
} from "../testing/fake-solana-http.js";
import { createSolanaDeliveryReader } from "./create-solana-delivery-reader.js";
import recorded from "./recorded/solana-usdc-fill.json" with { type: "json" };

// A Relay fill from BSC on Solana, as Solana's public RPC answered it (see the fixture's source).
const cluster = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const chain = { ref: cluster, name: "Solana", nativeAsset: `${cluster}/slip44:501` } as SolanaChain;
const fill =
  "4QN4bPaaZguhX2hxpkabijEJcKZ4WpFn4TxTsGCVyuJd5ccSTGn6BN7aaowMjRjyzvy3gGWag75ouQPC6p7zDbu4" as TxHash;
const owner = "A9YsiCuAtY5RT3nfLKZTz2EuxxXf3FZogPqHkSH89SXT";
const recipient = `${cluster}:${owner}` as AccountRef;
const usdc = `${cluster}/token:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` as AssetRef;
// Two signatures the recording never saw: one this test makes fail, one no block holds.
const failed = `${fill.slice(0, -1)}A` as TxHash;
const unknown = `${fill.slice(0, -1)}B` as TxHash;
const url = "https://node.invalid/";
const live = () => ({ signal: new AbortController().signal });

const answers = new Map(
  recorded.answers.map(({ method, params, result }) => [
    `${method}${JSON.stringify(params)}`,
    result,
  ]),
);
const fillTransaction = recorded.answers.find(({ method }) => method === "getTransaction")?.result;

function answer(call: FakeSolanaCall, id: string) {
  const [first] = call.params;
  if (call.method === "getTransaction" && first === failed) {
    const meta = {
      ...(fillTransaction as { meta: object }).meta,
      err: { InstructionError: [0, "Custom"] },
    };
    return jsonRpcAnswer(id, { result: { ...(fillTransaction as object), meta } });
  }
  if (call.method === "getTransaction" && first === unknown) {
    return jsonRpcAnswer(id, { result: null });
  }
  const result = answers.get(`${call.method}${JSON.stringify(call.params)}`);
  return result === undefined
    ? jsonRpcAnswer(id, { error: { code: -32_602, message: `not recorded: ${call.method}` } })
    : jsonRpcAnswer(id, { result });
}

function readerOf(endpoint = answer) {
  const http = createFakeSolanaHttp({ [url]: endpoint });
  const rpc = createSolanaRpcClient({
    endpoints: [{ name: "node", url }],
    http,
    clock: createManualClock(),
    timeoutMs: 1_000,
  });
  return createSolanaDeliveryReader({ rpc, chain });
}

describe("the Solana delivery reader", () => {
  it.each(
    deliveryReaderContract({
      create: async () =>
        await Promise.resolve({
          reader: readerOf(),
          recipient,
          holding: { asset: usdc, base: 30_281_703n },
          delivered: fill,
          received: { asset: usdc, base: 3_074_273n },
          emitter: accountRefSchema.parse(
            `${chain.ref}:MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`,
          ),
          failed,
          unknown,
          stranger: "eip155:1:0x168E0c5AE6B259883D878C89C042ad6347F8ba85" as AccountRef,
        }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("reads SOL's balance in lamports", async () => {
    await expect(readerOf().balance(recipient, chain.nativeAsset, live())).resolves.toBe(0n);
  });

  it("reads the SOL a fill brought the recipient from its lamports before and after", async () => {
    const delivery = await readerOf().delivery(
      { hash: fill, recipient, asset: chain.nativeAsset },
      live(),
    );
    expect(delivery?.received).toStrictEqual({ asset: chain.nativeAsset, base: 0n });
  });

  it("reads nothing for an account the fill never named", async () => {
    const stranger = `${cluster}:11111111111111111111111111111112` as AccountRef;
    const delivery = await readerOf().delivery(
      { hash: fill, recipient: stranger, asset: usdc },
      live(),
    );
    expect(delivery?.received.base).toBe(0n);
    const coin = await readerOf().delivery(
      { hash: fill, recipient: stranger, asset: chain.nativeAsset },
      live(),
    );
    expect(coin?.received.base).toBe(0n);
  });

  it("refuses a hash that is no base58 signature of 64 bytes", async () => {
    const hash = `0x${"aa".repeat(32)}` as TxHash;
    await expect(
      readerOf().delivery({ hash, recipient, asset: usdc }, live()),
    ).rejects.toMatchObject({
      code: "chain.bad_hash",
    });
  });
});
