import type { Clock, IdSource, Random } from "@binference/core";
import type { EngineStores } from "@binference/engine";
import { createDeviceHandlers, createTokenHandlers } from "@binference/engine/access";
import { createNoticeHandlers } from "@binference/engine/notices";
import type { EngineHandlerTable } from "@binference/engine/surfaces";
import type { ProtocolServer } from "@binference/server";
import type { ConsoleOrigin } from "./console-origin.js";

/** What the access handlers answer from, and the server whose connections a revoke ends. */
interface AccessHandlerParts {
  readonly stores: Pick<EngineStores, "access" | "notices">;
  readonly clock: Clock;
  readonly random: Random;
  readonly ids: IdSource;
  readonly origin: ConsoleOrigin;
  readonly server: () => ProtocolServer;
}

/**
 * The notice, token and device handlers; a device or token revoke also ends the open connections
 * signed in with it (decisions 0155 and 0159).
 */
export function accessHandlersOf(parts: AccessHandlerParts): EngineHandlerTable {
  const { clock, random, stores } = parts;
  const devices = createDeviceHandlers({
    access: stores.access,
    clock,
    random,
    consoleOrigin: parts.origin.get,
  });
  const tokens = createTokenHandlers({ access: stores.access, clock, ids: parts.ids });
  return {
    ...createNoticeHandlers(stores.notices),
    ...tokens,
    "token/revoke": async (call) => {
      const revoked = await tokens["token/revoke"](call);
      if (revoked.ok) {
        parts.server().endSessions(call.args.token, "auth.revoked");
      }
      return revoked;
    },
    ...devices,
    "device/revoke": async (call) => {
      const revoked = await devices["device/revoke"](call);
      if (revoked.ok) {
        parts.server().endSessions(call.args.device, "auth.revoked");
      }
      return revoked;
    },
  };
}
