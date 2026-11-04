import { ok } from "@binference/core";
import type { EngineHandlerTable } from "@binference/engine/surfaces";
import type { EngineParts } from "./compose-engine.js";
import { createEngineOperations } from "./engine-operations.js";

/**
 * `engine/status` and the operations beside it of an engine that is ready, unlocked and healthy,
 * release 2026.10.0, whose custody signs with no agent key of this machine.
 */
export function readyEngineOperations(
  stores: Pick<EngineParts["stores"], "agents" | "install">,
  communityPluginsOn: () => boolean = () => false,
): EngineHandlerTable {
  return createEngineOperations({
    agents: stores.agents,
    install: stores.install,
    version: "2026.10.0",
    state: () => "ready",
    lock: { unlock: async () => Promise.resolve(ok(undefined)) },
    health: () => [],
    nodeOptions: ["--disable-sigusr1"],
    communityPluginsOn,
    stop: () => undefined,
  });
}
