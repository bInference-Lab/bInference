import { createManualClock } from "@binference/core/testing";
import { afterEach, describe, expect, it } from "vitest";
import { createLoopbackHttp } from "../testing/loopback-http.js";
import {
  type LoopbackServer,
  refusingLoopbackUrl,
  serveLoopback,
} from "../testing/loopback-server.js";
import { createRpcFailover } from "./create-rpc-failover.js";
import { quantitySchema } from "./evm-wire.schema.js";

const timeoutMs = 3_000;
const open: LoopbackServer[] = [];

async function serve(server: Promise<LoopbackServer>): Promise<LoopbackServer> {
  const started = await server;
  open.push(started);
  return started;
}

// A node that answers eth_chainId for BSC, echoing the request's id.
function chainIdNode(): Promise<LoopbackServer> {
  return serve(
    serveLoopback((body) => {
      const { id } = JSON.parse(body) as { id: number };
      return { status: 200, body: JSON.stringify({ jsonrpc: "2.0", id, result: "0x38" }) };
    }),
  );
}

function failover(primaryUrl: string, secondaryUrl: string) {
  const clock = createManualClock();
  const rpc = createRpcFailover({
    endpoints: [
      { name: "primary", url: primaryUrl },
      { name: "secondary", url: secondaryUrl },
    ],
    http: createLoopbackHttp(),
    clock,
    timeoutMs,
    restMs: 60_000,
  });
  const chainId = () =>
    rpc.request({
      method: "eth_chainId",
      params: [],
      result: quantitySchema,
      signal: new AbortController().signal,
    });
  return { clock, rpc, chainId };
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((server) => server.close()));
});

describe("rpc failover over loopback http", () => {
  it("fails over from a hanging primary within its timeout and drops the hung request", async () => {
    const hanging = await serve(serveLoopback(() => "hang"));
    const answering = await chainIdNode();
    const { clock, rpc, chainId } = failover(hanging.url, answering.url);
    let settled = false;
    const reply = chainId();
    void reply.finally(() => {
      settled = true;
    });
    await hanging.firstRequest;
    await clock.advance(timeoutMs - 1);
    expect(settled).toBe(false);
    expect(answering.received()).toBe(0);
    await clock.advance(1);
    await expect(reply).resolves.toStrictEqual({
      kind: "result",
      endpoint: "secondary",
      value: 56n,
    });
    expect(clock.now()).toBe(timeoutMs);
    await expect(hanging.dropped).resolves.toBeUndefined();
    expect(rpc.health()[0]).toStrictEqual({
      name: "primary",
      restingUntilMs: timeoutMs + 60_000,
      lastFault: "timeout",
    });
  });

  it("fails over from a refused primary without waiting", async () => {
    const answering = await chainIdNode();
    const { clock, chainId } = failover(await refusingLoopbackUrl(), answering.url);
    await expect(chainId()).resolves.toMatchObject({ endpoint: "secondary", value: 56n });
    expect(clock.now()).toBe(0);
  });

  it("sends the next call straight to the healthy endpoint while the primary rests", async () => {
    const hanging = await serve(serveLoopback(() => "hang"));
    const answering = await chainIdNode();
    const { clock, chainId } = failover(hanging.url, answering.url);
    const first = chainId();
    await hanging.firstRequest;
    await clock.advance(timeoutMs);
    await first;
    await expect(chainId()).resolves.toMatchObject({ endpoint: "secondary" });
    expect(hanging.received()).toBe(1);
    expect(answering.received()).toBe(2);
  });
});
