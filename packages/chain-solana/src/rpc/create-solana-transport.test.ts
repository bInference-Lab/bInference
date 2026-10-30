import { createManualClock } from "@binference/core/testing";
import { createSolanaRpcFromTransport, type Address } from "@solana/kit";
import { describe, expect, it } from "vitest";
import {
  createFakeSolanaHttp,
  type FakeSolanaEndpoint,
  jsonRpcAnswer,
} from "../testing/fake-solana-http.js";
import { createSolanaTransport } from "./create-solana-transport.js";

const first = "https://first.invalid/";
const second = "https://second.invalid/";
const owner = "A9YsiCuAtY5RT3nfLKZTz2EuxxXf3FZogPqHkSH89SXT" as Address;
const live = () => ({ abortSignal: new AbortController().signal });
const balance: FakeSolanaEndpoint = (_call, id) =>
  jsonRpcAnswer(id, { result: { context: { slot: 1 }, value: 7 } });

const invalid: FakeSolanaEndpoint = (_call, id) =>
  jsonRpcAnswer(id, { error: { code: -32_602, message: "Invalid param" } });
const big: FakeSolanaEndpoint = (_call, id) => ({
  status: 200,
  headers: {},
  body: `{"jsonrpc":"2.0","id":"${id}","result":{"context":{"slot":1},"value":18446744073709551615}}`,
});

function rpcOver(endpoints: Readonly<Record<string, FakeSolanaEndpoint>>) {
  const http = createFakeSolanaHttp(endpoints);
  const transport = createSolanaTransport({
    endpoints: [
      { name: "first", url: first },
      { name: "second", url: second },
    ],
    http,
    clock: createManualClock(),
    timeoutMs: 1_000,
  });
  return { http, rpc: createSolanaRpcFromTransport(transport) };
}

describe("the Solana transport", () => {
  it("asks the first endpoint and stops there once it answers", async () => {
    const { http, rpc } = rpcOver({ [first]: balance, [second]: balance });
    await expect(rpc.getBalance(owner).send(live())).resolves.toMatchObject({ value: 7n });
    expect(http.calls(second)).toHaveLength(0);
  });

  it.each<[string, FakeSolanaEndpoint]>([
    ["refuses connections", "refuse"],
    ["answers 429, its rate limit", (_call, id) => jsonRpcAnswer(id, { result: 1 }, 429)],
    ["answers 403", (_call, id) => jsonRpcAnswer(id, { result: 1 }, 403)],
    ["answers 503", () => ({ status: 503, headers: {}, body: "busy" })],
    ["answers a result under 500", (_call, id) => jsonRpcAnswer(id, { result: 1 }, 500)],
    ["answers a body that is no JSON", () => ({ status: 200, headers: {}, body: "<html>" })],
    ["answers JSON that is no JSON-RPC answer", () => ({ status: 200, headers: {}, body: "{}" })],
    [
      "is unhealthy (-32005)",
      (_call, id) => jsonRpcAnswer(id, { error: { code: -32_005, message: "Node is unhealthy" } }),
    ],
    [
      "keeps no history (-32011)",
      (_call, id) =>
        jsonRpcAnswer(id, {
          error: { code: -32_011, message: "Transaction history is not available" },
        }),
    ],
  ])("moves on when the first endpoint %s", async (_case, failing) => {
    const { http, rpc } = rpcOver({ [first]: failing, [second]: balance });
    await expect(rpc.getBalance(owner).send(live())).resolves.toMatchObject({ value: 7n });
    expect(http.calls(second)).toHaveLength(1);
  });

  it("gives an error about the call itself as the call's answer, asking no other endpoint", async () => {
    const { http, rpc } = rpcOver({ [first]: invalid, [second]: balance });
    await expect(rpc.getBalance(owner).send(live())).rejects.toThrow(/Invalid param/);
    expect(http.calls(second)).toHaveLength(0);
  });

  it("fails, retryable, once every endpoint failed", async () => {
    const { rpc } = rpcOver({});
    await expect(rpc.getBalance(owner).send(live())).rejects.toMatchObject({
      code: "chain.rpc_down",
      retryable: true,
      details: { method: "getBalance", endpoints: 2, faults: "unreachable, unreachable" },
    });
  });

  it("moves on when an endpoint stays silent past its time", async () => {
    const clock = createManualClock();
    const http = createFakeSolanaHttp({ [first]: "hang", [second]: balance });
    const endpoints = [
      { name: "first", url: first },
      { name: "second", url: second },
    ];
    const rpc = createSolanaRpcFromTransport(
      createSolanaTransport({ endpoints, http, clock, timeoutMs: 1_000 }),
    );
    const reading = rpc.getBalance(owner).send(live());
    await clock.advance(1_000);
    await expect(reading).resolves.toMatchObject({ value: 7n });
  });

  it("keeps an integer past 2^53 exact", async () => {
    const { rpc } = rpcOver({ [first]: big });
    await expect(rpc.getBalance(owner).send(live())).resolves.toMatchObject({
      value: 18_446_744_073_709_551_615n,
    });
  });

  it("refuses a send before any request", async () => {
    const { http, rpc } = rpcOver({ [first]: balance });
    const sending = rpc.requestAirdrop(owner, 1n as never).send(live());
    await expect(sending).rejects.toMatchObject({ code: "chain.rpc_write_refused" });
    expect(http.calls(first)).toHaveLength(0);
  });

  it("writes a bigint parameter as a plain JSON number", async () => {
    const { http, rpc } = rpcOver({ [first]: balance });
    await rpc.getBalance(owner, { minContextSlot: 463_255_824n }).send(live());
    expect(http.calls(first)[0]?.params[1]).toStrictEqual({
      commitment: "confirmed",
      minContextSlot: 463_255_824,
    });
  });

  it("asks nothing once the caller's signal aborted", async () => {
    const { http, rpc } = rpcOver({ [first]: balance });
    const reason = new Error("stopped");
    await expect(
      rpc.getBalance(owner).send({ abortSignal: AbortSignal.abort(reason) }),
    ).rejects.toBe(reason);
    expect(http.calls(first)).toHaveLength(0);
  });

  it("reads a call sent with no signal of its own", async () => {
    const { rpc } = rpcOver({ [first]: balance });
    await expect(rpc.getBalance(owner).send()).resolves.toMatchObject({ value: 7n });
  });

  it("needs at least one endpoint", () => {
    const http = createFakeSolanaHttp({});
    expect(() =>
      createSolanaTransport({ endpoints: [], http, clock: createManualClock(), timeoutMs: 1 }),
    ).toThrow(expect.objectContaining({ code: "chain.bad_rpc_endpoints" }));
  });
});
