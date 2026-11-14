import type { CallableName, CallOptions } from "@binference/client";
import { BinferenceError } from "@binference/core";
import type { EngineCaller } from "@binference/engine";
import type { EngineHandlerTable } from "@binference/engine/surfaces";
import type { OperationShapes } from "@binference/protocol";
import type { EngineReach, EngineReader } from "../commands/engine-reach.js";
import { cliScopes } from "./cli-token.js";

/**
 * A reach of the engine's own handlers in its own process, for the findings `check/run` runs
 * there (decision 0445): each call goes to the handler as the CLI's caller would, and a refusal
 * throws its code, as the CLI's client does. `handlers` is read on each call, so a table the
 * composition root fills after it composes the engine is the one asked.
 */
export function createHandlerReach(
  handlers: () => EngineHandlerTable,
  version: string,
): EngineReach {
  const caller: EngineCaller = {
    credential: "check",
    client: { kind: "cli", version },
    scopes: cliScopes,
    transport: "ipc",
  };
  async function call<N extends CallableName<OperationShapes>>(
    op: N,
    args: OperationShapes[N]["args"],
    options: CallOptions,
  ): Promise<OperationShapes[N]["result"]> {
    const handler = handlers()[op];
    if (handler === undefined) {
      throw new BinferenceError({ code: "protocol.unknown_op", message: `No handler for ${op}.` });
    }
    const answer = await handler({ args, caller, signal: options.signal });
    if (!answer.ok) {
      throw new BinferenceError({ code: answer.error, message: `The engine refused ${op}.` });
    }
    return answer.value;
  }
  const client: EngineReader = { call, close: () => undefined };
  return async () => Promise.resolve({ ok: true, client });
}
