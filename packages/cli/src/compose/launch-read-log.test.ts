import type { ChainRef } from "@binference/chain";
import { createMemoryLogger } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createLaunchReadLog } from "./launch-read-log.js";

const chain = "eip155:56" as ChainRef;

describe("launch read log", () => {
  it("tells an outage once at warn, a new reason in it at info, and the read that ends it", () => {
    const logger = createMemoryLogger({ subsystem: "engine.watcher" });
    const log = createLaunchReadLog(logger, chain);
    log.stored();
    for (const code of ["chain.rpc_down", "chain.block_ahead", "chain.rpc_down"]) {
      log.failed(code);
    }
    log.stored();
    log.stored();
    log.failed("chain.rpc_down");
    expect(
      logger.records().map(({ level, event, fields }) => [level, event, fields]),
    ).toStrictEqual([
      ["warn", "watcher.launch_read_failed", { chain, errorCode: "chain.rpc_down" }],
      ["info", "watcher.launch_read_failed", { chain, errorCode: "chain.block_ahead" }],
      ["info", "watcher.launch_reads_resumed", { chain }],
      ["warn", "watcher.launch_read_failed", { chain, errorCode: "chain.rpc_down" }],
    ]);
  });
});
