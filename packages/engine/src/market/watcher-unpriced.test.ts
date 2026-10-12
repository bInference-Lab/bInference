import { assetRefSchema, chainRefSchema } from "@binference/chain";
import { describe, expect, it } from "vitest";
import type { EnginePush } from "../pushes/engine-push.js";
import { createWatcherUnpricedAlerts } from "./watcher-unpriced.js";

const chain = chainRefSchema.parse("fake:1");
const other = chainRefSchema.parse("fake:2");
const startMs = 1_800_000_000_000;
const tokenOf = (byte: string) =>
  assetRefSchema.parse(`fake:1/token:0x00000000000000000000000000000000000000${byte}`);

function alerts() {
  const pushes: EnginePush[] = [];
  const subject = createWatcherUnpricedAlerts({ publish: (push) => pushes.push(push) });
  const read = (tokens: readonly string[], atMs: number, on = chain) =>
    subject.check({
      chain: on,
      chainName: "Fake Chain",
      tokens: tokens.map(tokenOf),
      atMs: startMs + atMs,
    });
  return { subject, pushes, read };
}

const told = (count: string) => ({
  topic: "notice",
  kind: "notice/new",
  data: {
    key: "notice.watcherUnpriced",
    values: { chain: "Fake Chain", count, token: "0x0000…00a1" },
  },
});

describe("watched tokens without a price", () => {
  it("counts them over every chain, since the first chain's went", () => {
    const { subject, read } = alerts();
    expect(subject.count()).toStrictEqual({ count: 0 });
    read(["a1"], 0);
    read(["a1", "a2"], 1_000, other);
    read(["a1"], 2_000);
    expect(subject.count()).toStrictEqual({ count: 3, sinceMs: startMs });
    read([], 3_000);
    expect(subject.count()).toStrictEqual({ count: 2, sinceMs: startMs + 1_000 });
  });

  it("tells the owner once a chain has one, once until all are priced, at most once in 30 minutes", () => {
    const { subject, read, pushes } = alerts();
    read(["a1", "a2"], 0);
    read(["a1"], 1_000);
    expect(pushes).toStrictEqual([told("2")]);
    read([], 2_000);
    read(["a1"], 3_000);
    expect(pushes).toHaveLength(1);
    subject.forget(chain);
    read(["a1"], 30 * 60_000);
    expect(pushes).toStrictEqual([told("2"), told("1")]);
  });
});
