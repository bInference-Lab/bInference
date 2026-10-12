import { chainRefSchema } from "@binference/chain";
import { describe, expect, it } from "vitest";
import type { EnginePush } from "../pushes/engine-push.js";
import { createWatcherLagAlerts, watcherStateOf } from "./watcher-lag.js";

const bsc = chainRefSchema.parse("fake:1");
const other = chainRefSchema.parse("fake:2");
const startMs = 1_800_000_000_000;

function alerts() {
  const pushes: EnginePush[] = [];
  const subject = createWatcherLagAlerts({ publish: (push) => pushes.push(push) });
  const read = (lagBlocks: bigint, atMs: number, chain = bsc) =>
    subject.check({ chain, chainName: "Fake Chain", lagBlocks, atMs: startMs + atMs });
  return { subject, pushes, read };
}

describe("watcher lag", () => {
  it.each([
    [0n, "ok"],
    [2n, "ok"],
    [3n, "warn"],
    [10n, "warn"],
    [11n, "fail"],
  ] as const)("reads a lag of %s blocks as %s", (lagBlocks, state) => {
    expect(watcherStateOf(lagBlocks)).toBe(state);
  });

  it("gives no signal before any watcher reads, then the worst chain's", () => {
    const { subject, read } = alerts();
    expect(subject.health()).toBeUndefined();
    read(1n, 0);
    expect(subject.health()).toStrictEqual({ state: "ok", lagBlocks: 1n });
    read(4n, 1_000, other);
    read(5n, 2_000, other);
    expect(subject.health()).toStrictEqual({
      state: "warn",
      since: startMs + 1_000,
      lagBlocks: 5n,
    });
    subject.forget(other);
    expect(subject.health()).toStrictEqual({ state: "ok", lagBlocks: 1n });
  });

  it("tells the owner once a chain stays more than 10 blocks behind for 30 seconds", () => {
    const { pushes, read } = alerts();
    read(11n, 0);
    read(40n, 29_999);
    expect(pushes).toStrictEqual([]);
    read(60n, 30_000);
    read(70n, 45_000);
    expect(pushes).toStrictEqual([
      {
        topic: "notice",
        kind: "notice/new",
        data: { key: "notice.watcherLag", values: { chain: "Fake Chain", blocks: "60" } },
      },
    ]);
  });

  it("starts the 30 seconds again when the chain catches up, and tells at most every 30 minutes", () => {
    const { pushes, read } = alerts();
    read(20n, 0);
    read(20n, 20_000);
    read(5n, 25_000);
    read(20n, 26_000);
    read(20n, 50_000);
    expect(pushes).toHaveLength(0);
    read(20n, 56_000);
    expect(pushes).toHaveLength(1);
    read(0n, 60_000);
    read(20n, 61_000);
    read(20n, 120_000);
    expect(pushes).toHaveLength(1);
    read(20n, 30 * 60_000 + 56_000);
    expect(pushes).toHaveLength(2);
  });
});
