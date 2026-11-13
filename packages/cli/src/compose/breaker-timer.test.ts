import { BinferenceError } from "@binference/core";
import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import type { Engine } from "@binference/engine";
import { describe, expect, it } from "vitest";
import { breakerFollower, followBreakerAtStart, startBreakerTimer } from "./breaker-timer.js";
import { createClosers } from "./closers.js";

type Followed = Awaited<ReturnType<Engine["followBreaker"]>>;
const live = { signal: new AbortController().signal };

// A follower whose breaker answers each look in turn, the last one again once they run out.
function followerOf(answers: readonly Followed[]) {
  const logger = createMemoryLogger({ subsystem: "engine" });
  const seen = { looks: 0 };
  const follow = breakerFollower({
    followBreaker: async () => {
      const answer = answers[Math.min(seen.looks, answers.length - 1)];
      seen.looks += 1;
      return Promise.resolve(answer ?? { outcome: "kept" });
    },
    logger,
  });
  return { follow, logger, seen };
}

const unread: Followed = { outcome: "unread", errorCode: "breaker.unreadable" };

async function failing(): Promise<void> {
  throw new BinferenceError({ code: "store.lease_lost", message: "Another worker holds it." });
}

describe("the breaker's follower", () => {
  it("logs a long outage of its source as two lines", async () => {
    const { follow, logger } = followerOf([unread, unread, unread, { outcome: "kept" }]);
    await follow(live);
    await follow(live);
    await follow(live);
    await follow(live);
    await follow(live);
    expect(logger.records().map(({ event, fields }) => [event, fields.errorCode])).toStrictEqual([
      ["engine.breaker_unread", "breaker.unreadable"],
      ["engine.breaker_read", undefined],
    ]);
  });

  it("logs each pull and lift it wrote", async () => {
    const { follow, logger } = followerOf([{ outcome: "pulled" }, { outcome: "lifted" }]);
    await follow(live);
    await follow(live);
    expect(logger.records().map(({ event }) => event)).toStrictEqual([
      "engine.breaker_pulled",
      "engine.breaker_lifted",
    ]);
  });

  it("lets the start go on after a write that failed", async () => {
    const logger = createMemoryLogger({ subsystem: "engine" });
    await expect(followBreakerAtStart(failing, { ...live, logger })).resolves.toBeUndefined();
    expect(logger.records().map(({ event, fields }) => [event, fields.errorCode])).toStrictEqual([
      ["engine.breaker_failed", "store.lease_lost"],
    ]);
  });

  it("looks every second, and stops with its closer", async () => {
    const clock = createManualClock(0);
    const closers = createClosers();
    const { follow, logger, seen } = followerOf([{ outcome: "kept" }]);
    startBreakerTimer({ follow, clock, closers, logger });
    await clock.advance(1_000);
    await clock.advance(1_000);
    await closers.closeAll(new AbortController().signal);
    await clock.advance(1_000);
    expect(seen.looks).toBe(2);
  });
});
