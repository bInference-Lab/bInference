import type { ChainRef } from "@binference/chain";
import { createMemoryLogger } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createWatcherReadLog } from "./watcher-read-log.js";

const chain = "eip155:56" as ChainRef;
const events = { failed: "watcher.leader_read_failed", resumed: "watcher.leader_reads_resumed" };

describe("watcher read log", () => {
  it("tells each outage once at warn, a new reason in it at info, and the read that ends it", () => {
    const logger = createMemoryLogger({ subsystem: "engine.watcher" });
    const log = createWatcherReadLog(logger, chain, events);
    log.stored();
    for (const code of ["chain.rpc_down", "chain.block_ahead", "chain.rpc_down"]) {
      log.failed(code);
    }
    log.stored();
    log.stored();
    log.failed("chain.rpc_down");
    log.failed("chain.rpc_down");
    log.stored();
    expect(
      logger.records().map(({ level, event, fields }) => [level, event, fields]),
    ).toStrictEqual([
      ["warn", events.failed, { chain, errorCode: "chain.rpc_down" }],
      ["info", events.failed, { chain, errorCode: "chain.block_ahead" }],
      ["info", events.resumed, { chain }],
      ["warn", events.failed, { chain, errorCode: "chain.rpc_down" }],
      ["info", events.resumed, { chain }],
    ]);
  });
});
