import assert from "node:assert/strict";
import type { LogRecord } from "../log-record.js";
import type { Logger } from "../ports.js";
import type { ContractCheck } from "./contract-check.js";

/** A logger under test, and the records it wrote. */
export interface LoggerSubject {
  readonly logger: Logger;
  readonly records: () => readonly LogRecord[];
}

/** Makes a fresh {@link LoggerSubject} for a subsystem. */
export interface LoggerHarness {
  create(subsystem: string): LoggerSubject;
}

const privateKey = `0x${"ab".repeat(32)}`;
const token = `bnt_${"Zx9".repeat(12)}`;

/** The contract every `Logger` adapter passes, redaction included. */
export function loggerContract(harness: LoggerHarness): readonly ContractCheck[] {
  return [
    {
      name: "writes each level with its subsystem, event and ids",
      run: async () => {
        const { logger, records } = harness.create("engine");
        logger.debug("queue.idle");
        logger.info("intent.confirmed", { intentId: "int_1" });
        logger.warn("relay.slow", { durationMs: 900 });
        logger.error("rpc.down", { errorCode: "chain.rpc_down" });
        assert.deepEqual(
          records().map((record) => [record.level, record.subsystem, record.event]),
          [
            ["debug", "engine", "queue.idle"],
            ["info", "engine", "intent.confirmed"],
            ["warn", "engine", "relay.slow"],
            ["error", "engine", "rpc.down"],
          ],
        );
        assert.equal(records()[1]?.fields.intentId, "int_1");
        await Promise.resolve();
      },
    },
    {
      name: "names a child after its parent and its part",
      run: async () => {
        const { logger, records } = harness.create("engine");
        logger.child("policy").child("caps").info("cap.hit");
        assert.equal(records()[0]?.subsystem, "engine.policy.caps");
        await Promise.resolve();
      },
    },
    {
      name: "masks secrets in events and fields",
      run: async () => {
        const { logger, records } = harness.create("engine");
        logger.error(`leaked ${privateKey}`, { traceId: token });
        const written = JSON.stringify(records());
        assert.ok(!written.includes(privateKey) && !written.includes(token));
        await Promise.resolve();
      },
    },
  ];
}
