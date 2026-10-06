import { BinferenceError, type HttpResponse } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createFakeRpcHttp,
  type FakeEndpoint,
  type FakeRpcAnswer,
  fakeRpcNode,
  readFakeRpcRequest,
} from "../testing/fake-rpc-http.js";
import { createRpcFailover } from "./create-rpc-failover.js";
import { quantitySchema } from "./evm-wire.schema.js";

const primary = "https://primary.invalid/";
const secondary = "https://secondary.invalid/";
const timeoutMs = 2_000;
const restMs = 30_000;

const chainIdNode = fakeRpcNode(() => ({ result: "0x38" }));
const raw =
  (status: number, body: string): FakeEndpoint =>
  (): HttpResponse => ({ status, headers: {}, body });

function setup(endpoints: Readonly<Record<string, FakeEndpoint>>) {
  const clock = createManualClock();
  const http = createFakeRpcHttp(endpoints);
  const rpc = createRpcFailover({
    endpoints: [
      { name: "primary", url: primary, headers: { authorization: "Bearer test" } },
      { name: "secondary", url: secondary },
    ],
    http,
    clock,
    timeoutMs,
    restMs,
  });
  const chainId = (signal = new AbortController().signal) =>
    rpc.request({ method: "eth_chainId", params: [], result: quantitySchema, signal });
  const asked = (): readonly string[] => http.requests().map((request) => request.url);
  return { clock, http, rpc, chainId, asked };
}

const fromSecondary = { kind: "result", endpoint: "secondary", value: 56n };

// A node that fails its first request with HTTP 500 and answers every later one.
function failsOnce(): FakeEndpoint {
  const answers: FakeRpcAnswer[] = [{ status: 500, body: "" }];
  return fakeRpcNode(() => answers.shift() ?? { result: "0x38" });
}

describe("rpc failover", () => {
  it("asks the first endpoint and checks its result with the call's schema", async () => {
    const { chainId, asked, http } = setup({ [primary]: chainIdNode, [secondary]: chainIdNode });
    await expect(chainId()).resolves.toStrictEqual({
      kind: "result",
      endpoint: "primary",
      value: 56n,
    });
    expect(asked()).toStrictEqual([primary]);
    const [sent] = http.requests();
    expect(sent?.headers).toStrictEqual({
      "content-type": "application/json",
      authorization: "Bearer test",
    });
    expect(readFakeRpcRequest(sent?.body)).toStrictEqual({
      id: 1,
      method: "eth_chainId",
      params: [],
    });
  });

  it("moves to the next endpoint when a hanging one runs out its timeout", async () => {
    const { clock, chainId, asked } = setup({ [primary]: "hang", [secondary]: chainIdNode });
    let settled = false;
    const reply = chainId();
    void reply.finally(() => {
      settled = true;
    });
    await clock.advance(timeoutMs - 1);
    expect(settled).toBe(false);
    expect(asked()).toStrictEqual([primary]);
    await clock.advance(1);
    await expect(reply).resolves.toStrictEqual(fromSecondary);
    expect(clock.now()).toBe(timeoutMs);
    expect(asked()).toStrictEqual([primary, secondary]);
  });

  it("moves to the next endpoint at once when a connection is refused", async () => {
    const { clock, chainId } = setup({ [primary]: "refuse", [secondary]: chainIdNode });
    await expect(chainId()).resolves.toStrictEqual(fromSecondary);
    expect(clock.now()).toBe(0);
  });

  it("rests a failed endpoint and asks it first again once the rest is over", async () => {
    const { clock, rpc, chainId, asked } = setup({
      [primary]: raw(503, "busy"),
      [secondary]: chainIdNode,
    });
    await chainId();
    expect(rpc.health()).toStrictEqual([
      { name: "primary", restingUntilMs: restMs, lastFault: "bad_status" },
      { name: "secondary" },
    ]);
    await chainId();
    expect(asked()).toStrictEqual([primary, secondary, secondary]);
    await clock.advance(restMs);
    await chainId();
    expect(asked().at(-2)).toBe(primary);
  });

  it("asks resting endpoints when no other is left and clears a rest on an answer", async () => {
    const { rpc, chainId, asked } = setup({ [primary]: failsOnce(), [secondary]: "refuse" });
    await expect(chainId()).rejects.toMatchObject({ code: "chain.rpc_down" });
    await expect(chainId()).resolves.toMatchObject({ endpoint: "primary", value: 56n });
    expect(asked()).toStrictEqual([primary, secondary, primary]);
    expect(rpc.health()).toStrictEqual([
      { name: "primary" },
      { name: "secondary", restingUntilMs: restMs, lastFault: "unreachable" },
    ]);
  });

  it.each([
    ["rate_limited", raw(429, "slow down")],
    ["rate_limited", raw(403, "")],
    ["bad_status", raw(502, "<html>")],
    ["malformed", raw(200, "not json")],
    ["malformed", raw(200, JSON.stringify({ jsonrpc: "2.0", id: 99, result: "0x38" }))],
    ["malformed", fakeRpcNode(() => ({ result: "fifty-six" }))],
    ["node_error", fakeRpcNode(() => ({ error: { code: -32_601, message: "not found" } }))],
    ["node_error", fakeRpcNode(() => ({ error: { code: -32_000, message: "header not found" } }))],
  ])("records %s and asks the next endpoint", async (fault, endpoint) => {
    const { rpc, chainId } = setup({ [primary]: endpoint, [secondary]: chainIdNode });
    await expect(chainId()).resolves.toStrictEqual(fromSecondary);
    expect(rpc.health()[0]?.lastFault).toBe(fault);
  });

  it.each([
    [
      "under 200",
      fakeRpcNode(() => ({
        error: { code: 3, message: "execution reverted", data: "0x08c379a0" },
      })),
    ],
    [
      "under a 4xx",
      raw(
        400,
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          error: { code: 3, message: "execution reverted", data: "0x08c379a0" },
        }),
      ),
    ],
  ])("returns a revert answered %s without asking another endpoint", async (_status, endpoint) => {
    const { chainId, asked } = setup({ [primary]: endpoint, [secondary]: chainIdNode });
    await expect(chainId()).resolves.toStrictEqual({
      kind: "error",
      endpoint: "primary",
      code: 3,
      message: "execution reverted",
      data: "0x08c379a0",
    });
    expect(asked()).toStrictEqual([primary]);
  });

  it("returns an error answer without data as it came", async () => {
    const { chainId } = setup({
      [primary]: fakeRpcNode(() => ({ error: { code: -32_602, message: "invalid params" } })),
    });
    await expect(chainId()).resolves.toStrictEqual({
      kind: "error",
      endpoint: "primary",
      code: -32_602,
      message: "invalid params",
    });
  });

  it("rejects with a retryable rpc_down once every endpoint failed", async () => {
    const { chainId } = setup({ [primary]: "refuse", [secondary]: raw(500, "") });
    const failure = await chainId().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(BinferenceError);
    expect(failure).toMatchObject({
      code: "chain.rpc_down",
      retryable: true,
      details: { method: "eth_chainId", endpoints: 2, lastFault: "bad_status" },
    });
  });

  it("stops on the caller's abort without asking another endpoint", async () => {
    const { chainId, asked } = setup({ [primary]: "hang", [secondary]: chainIdNode });
    const controller = new AbortController();
    const reply = chainId(controller.signal);
    const reason = new Error("shutting down");
    controller.abort(reason);
    await expect(reply).rejects.toBe(reason);
    expect(asked()).toStrictEqual([primary]);
  });

  it("refuses a call whose signal is already aborted", async () => {
    const { chainId, asked } = setup({ [primary]: chainIdNode });
    await expect(chainId(AbortSignal.abort(new Error("late")))).rejects.toThrow("late");
    expect(asked()).toStrictEqual([]);
  });

  it.each(["eth_sendRawTransaction", "eth_sendTransaction", "eth_sign", "personal_sign"])(
    "refuses %s, which goes through the send path",
    async (method) => {
      const { rpc, asked } = setup({ [primary]: chainIdNode });
      const call = { method, params: ["0x00"], result: z.string(), signal: AbortSignal.any([]) };
      await expect(rpc.request(call)).rejects.toMatchObject({ code: "chain.rpc_write_refused" });
      expect(asked()).toStrictEqual([]);
    },
  );

  it.each([
    ["no endpoint", []],
    [
      "two endpoints of one name",
      [
        { name: "same", url: primary },
        { name: "same", url: secondary },
      ],
    ],
  ])("refuses to start with %s", (_case, endpoints) => {
    expect(() =>
      createRpcFailover({
        endpoints,
        http: createFakeRpcHttp({}),
        clock: createManualClock(),
        timeoutMs,
        restMs,
      }),
    ).toThrow(expect.objectContaining({ code: "chain.bad_rpc_endpoints" }));
  });
});
