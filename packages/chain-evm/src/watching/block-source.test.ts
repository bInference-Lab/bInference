import { createManualClock, type ManualClock } from "@binference/core/testing";
import { getAddress, toHex } from "viem";
import { afterEach, describe, expect, it } from "vitest";
import { createRpcFailover } from "../rpc/create-rpc-failover.js";
import { createFakeEvmNode, type FakeEvmNode } from "../testing/fake-evm-node.js";
import { createFakeHeadSockets, type FakeHeadSockets } from "../testing/fake-head-socket.js";
import { createFakeRpcHttp, type FakeEndpoint } from "../testing/fake-rpc-http.js";
import { type BlockSource, createBlockSource, type SeenHead } from "./block-source.js";
import type { HeadSocketFactory } from "./head-socket.js";

const multicall = getAddress("0xca11bde05977b3631167028862be2a173976ca11");
const blockTimeMs = 450;
const timeoutMs = 1_000;
const wsUrl = "wss://heads.test/key-123";
const subscribed = JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0xsub" });

const headMessage = (number: bigint, subscription = "0xsub", hash = "0x01"): string =>
  JSON.stringify({
    jsonrpc: "2.0",
    method: "eth_subscription",
    params: { subscription, result: { number: toHex(number), hash } },
  });

interface Running {
  readonly clock: ManualClock;
  readonly node: FakeEvmNode;
  readonly source: BlockSource;
  readonly heads: bigint[];
  readonly endpoints: (string | undefined)[];
  readonly sockets: FakeHeadSockets;
  /** The heads handed on again because a socket sent another block at their height. */
  readonly reorgs: bigint[];
}

const controllers: AbortController[] = [];

// Hands on one head a block time, as a node behind the chain does.
async function trickle(
  clock: ManualClock,
  numbers: readonly bigint[],
  send: (number: bigint) => void,
): Promise<void> {
  const [number, ...rest] = numbers;
  if (number !== undefined) {
    send(number);
    await clock.advance(blockTimeMs);
    await trickle(clock, rest, send);
  }
}

const refuseSocket = (): never => {
  throw new Error("not a WebSocket URL");
};

// Lets every message already queued be read: each takes a few turns of the event loop.
async function settle(clock: ManualClock, rounds: number): Promise<void> {
  if (rounds > 0) {
    await clock.advance(0);
    await settle(clock, rounds - 1);
  }
}

// A node that refuses every request while it is down.
function flakyNode(head: bigint): {
  readonly endpoint: FakeEndpoint;
  readonly state: { isDown: boolean };
} {
  const state = { isDown: true };
  const live = createFakeEvmNode({ multicall, head, answer: () => undefined }).endpoint;
  const endpoint: FakeEndpoint = (request) => {
    if (state.isDown) {
      throw new Error("down");
    }
    return live(request);
  };
  return { endpoint, state };
}

afterEach(() => {
  controllers.splice(0).forEach((controller) => controller.abort());
});

function start(
  options: {
    readonly first?: FakeEndpoint;
    readonly second?: FakeEndpoint;
    readonly subscribe?: boolean;
    readonly open?: HeadSocketFactory;
    readonly callTimeoutMs?: number;
  } = {},
): Running {
  const clock = createManualClock(1_000);
  const node = createFakeEvmNode({ multicall, head: 100n, answer: () => undefined });
  const http = createFakeRpcHttp({
    "https://first.test": options.first ?? node.endpoint,
    "https://second.test": options.second ?? node.endpoint,
  });
  const rpc = createRpcFailover({
    endpoints: [
      { name: "first", url: "https://first.test" },
      { name: "second", url: "https://second.test" },
    ],
    http,
    clock,
    timeoutMs,
    restMs: 30_000,
  });
  const sockets = createFakeHeadSockets();
  const subscription =
    options.subscribe === true
      ? {
          subscription: {
            url: wsUrl,
            open: options.open ?? sockets.open,
            headTimeoutMs: 3_000,
            restMs: 30_000,
          },
        }
      : {};
  const callTimeout =
    options.callTimeoutMs === undefined ? {} : { callTimeoutMs: options.callTimeoutMs };
  const source = createBlockSource({ rpc, clock, blockTimeMs, ...subscription, ...callTimeout });
  const heads: bigint[] = [];
  const controller = new AbortController();
  controllers.push(controller);
  const endpoints: (string | undefined)[] = [];
  const reorgs: bigint[] = [];
  const onHead = (number: bigint, seen?: SeenHead): void => {
    heads.push(number);
    endpoints.push(seen?.endpoint);
    reorgs.push(...(seen?.isReorg === true ? [number] : []));
  };
  source.run(onHead, controller.signal).catch(() => undefined);
  return { clock, node, source, heads, endpoints, sockets, reorgs };
}

describe("block source", () => {
  it("polls the head once a block time and hands on each number above the last", async () => {
    const { clock, node, heads, source } = start();
    await clock.advance(0);
    expect(heads).toStrictEqual([100n]);
    await clock.advance(blockTimeMs);
    expect(heads).toStrictEqual([100n]);
    node.setHead(102n);
    await clock.advance(blockTimeMs);
    node.setHead(101n);
    await clock.advance(blockTimeMs);
    expect(heads).toStrictEqual([100n, 102n]);
    expect(source.state()).toStrictEqual({ mode: "polling", head: 102n, headAtMs: 1_900 });
  });

  it("names the endpoint whose poll saw a head, and none for a socket's", async () => {
    const polled = start({ first: "refuse" });
    await polled.clock.advance(0);
    expect(polled.endpoints).toStrictEqual(["second"]);
    const followed = start({ subscribe: true });
    await followed.clock.advance(0);
    const [socket] = followed.sockets.opened();
    socket?.accept();
    socket?.receive(subscribed);
    socket?.receive(headMessage(300n));
    await followed.clock.advance(0);
    expect(followed.endpoints).toStrictEqual([undefined]);
  });

  it("fails over from a dead endpoint within the failover's timeout", async () => {
    const { clock, heads, source } = start({ first: "hang" });
    await clock.advance(timeoutMs - 1);
    expect(heads).toStrictEqual([]);
    await clock.advance(1);
    expect(heads).toStrictEqual([100n]);
    expect(source.state().headAtMs).toBe(1_000 + timeoutMs);
  });

  it("fails over within the watcher's own call timeout when it is shorter", async () => {
    const { clock, heads } = start({ first: "hang", callTimeoutMs: 300 });
    await clock.advance(299);
    expect(heads).toStrictEqual([]);
    await clock.advance(1);
    expect(heads).toStrictEqual([100n]);
  });

  it("keeps polling when no endpoint answers, and says why until a head comes", async () => {
    const flaky = flakyNode(7n);
    const { clock, heads, source } = start({ first: flaky.endpoint, second: "refuse" });
    await clock.advance(blockTimeMs * 2);
    expect(heads).toStrictEqual([]);
    expect(source.state()).toStrictEqual({ mode: "polling", fault: "rpc_down" });
    flaky.state.isDown = false;
    await clock.advance(30_000);
    expect(heads).toStrictEqual([7n]);
    expect(source.state().fault).toBeUndefined();
  });

  it("follows new heads over the subscription and polls nothing while it lives", async () => {
    const { clock, heads, sockets, source } = start({ subscribe: true });
    await clock.advance(0);
    const [socket] = sockets.opened();
    expect(socket?.url).toBe(wsUrl);
    socket?.accept();
    await clock.advance(0);
    expect(socket?.sent()).toStrictEqual([
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_subscribe", params: ["newHeads"] }),
    ]);
    socket?.receive(subscribed);
    socket?.receive(headMessage(200n));
    socket?.receive(headMessage(201n, "0xother"));
    socket?.receive(headMessage(202n));
    await clock.advance(0);
    expect(heads).toStrictEqual([200n, 202n]);
    expect(source.state()).toMatchObject({ mode: "subscription", head: 202n });
  });

  it("hands on a socket's head again when another block replaces it at the newest height", async () => {
    const { clock, heads, reorgs, sockets } = start({ subscribe: true });
    await clock.advance(0);
    const [socket] = sockets.opened();
    socket?.accept();
    socket?.receive(subscribed);
    socket?.receive(headMessage(200n, "0xsub", "0xaa"));
    socket?.receive(headMessage(200n, "0xsub", "0xaa"));
    socket?.receive(headMessage(200n, "0xsub", "0xbb"));
    socket?.receive(headMessage(199n, "0xsub", "0xcc"));
    await settle(clock, 4);
    expect([heads, reorgs]).toStrictEqual([[200n, 200n], [200n]]);
  });

  it("polls at once when the socket drops, and subscribes again after the rest", async () => {
    const { clock, heads, sockets, source } = start({ subscribe: true });
    await clock.advance(0);
    const [first] = sockets.opened();
    first?.accept();
    first?.receive(subscribed);
    first?.receive(headMessage(99n));
    await clock.advance(0);
    first?.drop();
    await clock.advance(0);
    expect(heads).toStrictEqual([99n, 100n]);
    expect(source.state()).toMatchObject({ mode: "polling", fault: "socket_closed" });
    expect(first?.isClosed()).toBe(true);
    await clock.advance(30_000 - blockTimeMs);
    expect(sockets.opened()).toHaveLength(1);
    await clock.advance(blockTimeMs * 2);
    expect(sockets.opened()).toHaveLength(2);
  });

  it("gives up a socket that sends no head within its timeout", async () => {
    const { clock, sockets, source } = start({ subscribe: true });
    await clock.advance(0);
    sockets.opened()[0]?.accept();
    await clock.advance(2_999);
    expect(source.state().mode).toBe("subscription");
    await clock.advance(1);
    expect(source.state()).toMatchObject({ mode: "polling", fault: "head_timeout", head: 100n });
  });

  it("gives up a socket that repeats one head, as one that sends none", async () => {
    const { clock, sockets, source } = start({ subscribe: true });
    await clock.advance(0);
    const [socket] = sockets.opened();
    socket?.accept();
    socket?.receive(subscribed);
    socket?.receive(headMessage(150n));
    await clock.advance(1_000);
    socket?.receive(headMessage(150n));
    await clock.advance(1_000);
    socket?.receive(headMessage(150n));
    await clock.advance(1_000);
    expect(source.state()).toMatchObject({ mode: "polling", fault: "head_timeout", head: 150n });
  });

  it("gives up a socket whose heads trail the head the polls saw", async () => {
    const { clock, sockets, source, heads } = start({ subscribe: true });
    await clock.advance(0);
    const [first] = sockets.opened();
    first?.drop();
    await clock.advance(30_000 + blockTimeMs);
    const [, second] = sockets.opened();
    second?.accept();
    second?.receive(subscribed);
    await settle(clock, 1);
    await trickle(clock, [60n, 61n, 62n, 63n, 64n, 65n, 66n, 67n], (number) =>
      second?.receive(headMessage(number)),
    );
    expect(heads).toStrictEqual([100n]);
    expect(source.state()).toMatchObject({ mode: "polling", fault: "head_timeout" });
  });

  it("polls when the node refuses the subscription", async () => {
    const { clock, sockets, source } = start({ subscribe: true });
    await clock.advance(0);
    const [socket] = sockets.opened();
    socket?.accept();
    socket?.receive(
      JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32_601, message: "no" } }),
    );
    await clock.advance(0);
    expect(source.state()).toMatchObject({ mode: "polling", fault: "refused", head: 100n });
  });

  it("polls when the socket cannot be made", async () => {
    const clock = createManualClock(1_000);
    const node = createFakeEvmNode({ multicall, head: 5n, answer: () => undefined });
    const rpc = createRpcFailover({
      endpoints: [{ name: "only", url: "https://only.test" }],
      http: createFakeRpcHttp({ "https://only.test": node.endpoint }),
      clock,
      timeoutMs,
      restMs: 1,
    });
    const subscription = {
      url: "https://heads.test",
      open: refuseSocket,
      headTimeoutMs: 3_000,
      restMs: 30_000,
    };
    const source = createBlockSource({ rpc, clock, blockTimeMs, subscription });
    const controller = new AbortController();
    controllers.push(controller);
    source.run(() => undefined, controller.signal).catch(() => undefined);
    await clock.advance(0);
    expect(source.state()).toStrictEqual({
      mode: "polling",
      head: 5n,
      headAtMs: 1_000,
      fault: "socket_closed",
    });
  });

  it("subscribes at once on a socket that is open as it is made, and skips what it cannot read", async () => {
    const sockets = createFakeHeadSockets();
    const opened = (url: string) => {
      const socket = sockets.open(url);
      socket.accept();
      return socket;
    };
    const { clock, heads, source } = start({ subscribe: true, open: opened });
    await clock.advance(0);
    const [socket] = sockets.opened();
    expect(socket?.sent()).toHaveLength(1);
    socket?.receive(subscribed);
    socket?.receive("not json");
    socket?.receive(JSON.stringify({ jsonrpc: "2.0", method: "ping" }));
    socket?.receive(headMessage(300n));
    await clock.advance(0);
    expect(heads).toStrictEqual([300n]);
    expect(source.state().mode).toBe("subscription");
  });

  it("keeps the newest messages of a burst it cannot read as fast", async () => {
    const { clock, heads, sockets } = start({ subscribe: true });
    await clock.advance(0);
    const [socket] = sockets.opened();
    socket?.accept();
    socket?.receive(subscribed);
    await clock.advance(0);
    Array.from({ length: 300 }, (_unused, index) =>
      socket?.receive(headMessage(BigInt(index + 1))),
    );
    await settle(clock, 100);
    expect(heads.at(-1)).toBe(300n);
    expect(heads).toHaveLength(256);
  });

  it("stops with the signal's reason", async () => {
    const clock = createManualClock();
    const node = createFakeEvmNode({ multicall, head: 1n, answer: () => undefined });
    const rpc = createRpcFailover({
      endpoints: [{ name: "only", url: "https://only.test" }],
      http: createFakeRpcHttp({ "https://only.test": node.endpoint }),
      clock,
      timeoutMs,
      restMs: 1,
    });
    const source = createBlockSource({ rpc, clock, blockTimeMs });
    const controller = new AbortController();
    const running = source.run(() => undefined, controller.signal);
    const reason = new Error("stopped");
    await clock.advance(0);
    controller.abort(reason);
    await expect(running).rejects.toBe(reason);
  });
});
