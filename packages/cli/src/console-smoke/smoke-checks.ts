import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import type { PublishPush } from "@binference/engine";
import type { EngineHandlerTable } from "@binference/engine/surfaces";
import { testNowMs } from "@binference/engine/testing";
import type { CheckFinding } from "../commands/check-finding.js";
import { createCheckOperations } from "../compose/check-operations.js";
import { createClosers } from "../compose/closers.js";
import { createSystemRandom } from "../runtime/system-random.js";

// The smoke engine's checks: `check/run` as the self-hosted engine answers it, over findings of
// every level the smoke shows, since the skeleton has no machine of its own to check.
const findings: readonly CheckFinding[] = [
  {
    check: "permissions.keys_folder",
    level: "fail",
    message: { key: "check.open", values: { path: "state/keys" } },
  },
  {
    check: "unlock.mode",
    level: "warn",
    message: { key: "check.unlockFile", values: { folder: "state/keys" } },
  },
  {
    check: "plugins.sandbox",
    level: "ok",
    message: { key: "check.pluginSandbox.held", values: {} },
  },
  { check: "config.valid", level: "ok" },
  { check: "engine.reachable", level: "ok" },
  { check: "rpc.keyed", level: "skip" },
];

/** `check/run` over the smoke's findings, its job's end going to `publish`. */
export function smokeCheckHandlers(publish: PublishPush): EngineHandlerTable {
  return createCheckOperations({
    run: async () => Promise.resolve(findings),
    clock: createManualClock(testNowMs),
    random: createSystemRandom(),
    publish,
    closers: createClosers(),
    logger: createMemoryLogger({ subsystem: "check" }),
  });
}
