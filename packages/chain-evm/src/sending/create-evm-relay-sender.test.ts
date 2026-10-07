import type { RelayAnswer, RelayRefusal, RelaySender, SignedTx } from "@binference/chain";
import { type RelayBehavior, relaySenderContract } from "@binference/chain/testing";
import { createManualClock, type ManualClock } from "@binference/core/testing";
import { keccak256 } from "viem";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { EvmChain } from "../evm-chain.js";
import type { RpcEndpoint } from "../rpc/rpc-call.js";
import {
  createFakeRpcHttp,
  type FakeEndpoint,
  type FakeRpcAnswer,
  fakeRpcNode,
  readFakeRpcRequest,
} from "../testing/fake-rpc-http.js";
import { createEvmRelaySender } from "./create-evm-relay-sender.js";

const chain = {
  ref: "eip155:56",
  chainId: 56,
  name: "Test BSC",
  nativeAsset: "eip155:56/slip44:714",
  nativeSymbol: "BNB",
  nativeDecimals: 18,
} as EvmChain;

const raw = "0x02f86c3807";
const signed = { chain: chain.ref, raw } as SignedTx;
const hash = keccak256(raw);
const live = () => ({ signal: new AbortController().signal });

// The contract waits on each send: the clock moves past every relay's timeout while it does,
// so a hanging relay's wait ends with no real timer.
function advancing(sender: RelaySender, clock: ManualClock): RelaySender {
  return {
    relays: sender.relays,
    async send(transaction, options) {
      const sending = sender.send(transaction, options);
      await clock.advance(100);
      return sending;
    },
  };
}

// What a relay answers for each refusal, as the relays' docs and the BSC node's txpool word it.
const refusals: Readonly<Record<RelayRefusal, FakeRpcAnswer>> = {
  nonce_too_low: { error: { code: -32_000, message: "nonce too low" } },
  underpriced: {
    error: {
      code: -32_000,
      message: "[private transaction service] require GasPrice=1, Provide=0",
    },
  },
  replacement_underpriced: {
    error: { code: -32_000, message: "insufficient gasprice increasement for overwriting" },
  },
  insufficient_funds: {
    error: { code: -32_000, message: "insufficient funds for gas * price + value" },
  },
  gas_quota: { error: { code: 4802, message: "koge-holder-policy" } },
  malformed_transaction: {
    error: { code: -32_000, message: "rlp: element is larger than containing list" },
  },
  rate_limited: { status: 429, body: "too many requests" },
  bad_answer: { result: `0x${"ab".repeat(32)}` },
  rejected: { error: { code: -32_000, message: "sender or to in black list" } },
};

function endpointOf(behavior: RelayBehavior): FakeEndpoint {
  if (behavior.kind === "refuse") {
    return fakeRpcNode(() => refusals[behavior.reason]);
  }
  const silent = { hang: "hang", unreachable: "refuse" } as const;
  return behavior.kind === "accept" ? fakeRpcNode(() => ({ result: hash })) : silent[behavior.kind];
}

function relaysOf(count: number): readonly RpcEndpoint[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `relay-${String(index)}`,
    url: `https://relay-${String(index)}.invalid/`,
  }));
}

function subjectOf(behaviors: readonly RelayBehavior[], clock: ManualClock = createManualClock()) {
  const relays = relaysOf(behaviors.length);
  const endpoints = Object.fromEntries(
    relays.map((relay, index) => [relay.url, endpointOf(behaviors[index] ?? { kind: "accept" })]),
  );
  const http = createFakeRpcHttp(endpoints);
  const sender = createEvmRelaySender({ chain, relays, http, clock, timeoutMs: 100 });
  const received = () =>
    http
      .requests()
      .filter((request) => endpoints[request.url] !== "refuse")
      .map((request) => ({
        relay: relays.find((relay) => relay.url === request.url)?.name ?? "",
        raw: z.string().parse(readFakeRpcRequest(request.body).params[0]),
      }));
  return { sender, signed, received, http };
}

function readOutcome(answer: RelayAnswer): string {
  return answer.outcome === "refused" ? `refused:${answer.reason}` : answer.outcome;
}

describe("the EVM relay sender", () => {
  it.each(
    relaySenderContract({
      create: async (behaviors) => {
        const clock = createManualClock();
        const subject = subjectOf(behaviors, clock);
        return await Promise.resolve({ ...subject, sender: advancing(subject.sender, clock) });
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("sends to every relay before a hanging one's wait ends, and records each answer", async () => {
    const clock = createManualClock(5_000);
    const { sender, http } = subjectOf([{ kind: "hang" }, { kind: "accept" }], clock);
    const sending = sender.send(signed, live());
    await clock.advance(0);
    expect(http.requests().map((request) => request.url)).toStrictEqual([
      "https://relay-0.invalid/",
      "https://relay-1.invalid/",
    ]);
    await clock.advance(100);
    await expect(sending).resolves.toStrictEqual([
      { relay: "relay-0", outcome: "timed_out", atMs: 5_100 },
      { relay: "relay-1", outcome: "accepted", atMs: 5_000 },
    ]);
  });

  it("sends each relay one eth_sendRawTransaction of the bytes, and never retries", async () => {
    const behaviors: readonly RelayBehavior[] = [
      { kind: "refuse", reason: "rejected" },
      { kind: "unreachable" },
      { kind: "accept" },
    ];
    const { sender, http } = subjectOf(behaviors);
    await sender.send(signed, live());
    const calls = http.requests().map((request) => readFakeRpcRequest(request.body));
    expect(calls).toStrictEqual(
      behaviors.map(() => ({ id: 1, method: "eth_sendRawTransaction", params: [raw] })),
    );
  });

  it.each<[string, FakeRpcAnswer, string]>([
    ["already holds the bytes", { error: { code: -32_000, message: "already known" } }, "accepted"],
    ["answers in capitals", { result: hash.toUpperCase().replace("0X", "0x") }, "accepted"],
    [
      "refuses a replacement",
      { error: { code: -32_000, message: "replacement transaction underpriced" } },
      "refused:replacement_underpriced",
    ],
    [
      "wants more than the floor",
      { error: { code: -32_000, message: "transaction underpriced" } },
      "refused:underpriced",
    ],
    [
      "sees no chain id it knows",
      { error: { code: -32_000, message: "invalid chain id for signer" } },
      "refused:malformed_transaction",
    ],
    [
      "limits a burst in JSON-RPC",
      { error: { code: -32_005, message: "rate limit exceeded" } },
      "refused:rate_limited",
    ],
    ["answers a server error", { status: 502, body: "bad gateway" }, "refused:bad_answer"],
    ["answers no JSON-RPC", { status: 200, body: "<html>" }, "refused:bad_answer"],
  ])("reads a relay that %s", async (_, answer, outcome) => {
    const relays = relaysOf(1);
    const http = createFakeRpcHttp({ "https://relay-0.invalid/": fakeRpcNode(() => answer) });
    const clock = createManualClock();
    const sender = createEvmRelaySender({ chain, relays, http, clock, timeoutMs: 100 });
    const answers = await sender.send(signed, live());
    expect(answers.map(readOutcome)).toStrictEqual([outcome]);
  });

  it("keeps a refusal's code for the record", async () => {
    const { sender } = subjectOf([{ kind: "refuse", reason: "gas_quota" }]);
    const [answer] = await sender.send(signed, live());
    expect(answer).toMatchObject({ outcome: "refused", reason: "gas_quota", code: 4802 });
  });

  it("refuses bytes of another chain or not in hex, and a set of relays it cannot name", async () => {
    const { sender } = subjectOf([{ kind: "accept" }]);
    const other = { chain: "eip155:1", raw } as SignedTx;
    await expect(sender.send(other, live())).rejects.toMatchObject({
      code: "chain.unknown_chain",
    });
    await expect(sender.send({ ...signed, raw: "0x0" }, live())).rejects.toMatchObject({
      code: "chain.bad_transaction",
    });
    const options = {
      chain,
      http: createFakeRpcHttp({}),
      clock: createManualClock(),
      timeoutMs: 1,
    };
    expect(() => createEvmRelaySender({ ...options, relays: [] })).toThrow(
      expect.objectContaining({ code: "chain.bad_relays" }),
    );
    const twice = [...relaysOf(1), ...relaysOf(1)];
    expect(() => createEvmRelaySender({ ...options, relays: twice })).toThrow(
      expect.objectContaining({ code: "chain.bad_relays" }),
    );
  });

  it("rejects with the caller's reason when the caller stops during a send", async () => {
    const clock = createManualClock();
    const { sender } = subjectOf([{ kind: "hang" }], clock);
    const controller = new AbortController();
    const sending = sender.send(signed, controller);
    const reason = new Error("stopped");
    controller.abort(reason);
    await expect(sending).rejects.toBe(reason);
  });
});
