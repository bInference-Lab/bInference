import { BinferenceError, err, ok } from "@binference/core";
import type { ResultOf } from "@binference/protocol";
import type { EngineHandler } from "../operations/engine-call.js";
import { type ConsolePairCodeOptions, issueConsolePairCode } from "./console-pair-code.js";
import type { DeviceRecord } from "./device-record.js";

/** The handlers of the console devices (protocol spec, section 7.9; decision 0155). */
export interface DeviceHandlers {
  readonly "device/pair": EngineHandler<"device/pair">;
  readonly "device/list": EngineHandler<"device/list">;
  readonly "device/revoke": EngineHandler<"device/revoke">;
}

/** What the device handlers read and write through. */
export interface DeviceHandlersOptions extends ConsolePairCodeOptions {
  /**
   * The origin the console is served on, such as `http://127.0.0.1:7456`, once the HTTP listener
   * bound; `undefined` before.
   */
  readonly consoleOrigin: () => string | undefined;
}

type DeviceView = ResultOf<"device/list">["items"][number];

/** A device as the protocol shows it: never its public key. */
function deviceViewOf(record: DeviceRecord): DeviceView {
  return {
    device: record.id,
    label: record.label,
    alg: record.alg,
    createdAt: record.createdAtMs,
    ...(record.lastSeenAtMs === undefined ? {} : { lastSeenAt: record.lastSeenAtMs }),
    ...(record.revokedAtMs === undefined ? {} : { revokedAt: record.revokedAtMs }),
  };
}

function noListener(): BinferenceError {
  return new BinferenceError({
    code: "engine.no_console",
    message: "The HTTP listener is not bound, so no console link can be made.",
  });
}

/**
 * Creates the device handlers. `device/pair` stores a new single-use pairing code's hash and
 * answers the console link that carries it, `#pair=<code>` after the console's origin, shown once.
 * `device/list` answers every device, oldest first, revoked ones too. `device/revoke` revokes a
 * device, keeping the time of an earlier revoke; an unknown one is `protocol.bad_args`.
 */
export function createDeviceHandlers(options: DeviceHandlersOptions): DeviceHandlers {
  return {
    async "device/pair"({ signal }) {
      const origin = options.consoleOrigin();
      if (origin === undefined) {
        throw noListener();
      }
      const issued = await issueConsolePairCode(options, { signal });
      return ok({ link: `${origin}/#pair=${issued.code}`, expiresAt: issued.expiresAtMs });
    },
    async "device/list"({ signal }) {
      const devices = await options.access.listDevices({ signal });
      return ok({ items: devices.map(deviceViewOf) });
    },
    async "device/revoke"({ args, signal }) {
      const revoked = await options.access.revokeDevice(
        { id: args.device, atMs: options.clock.now() },
        { signal },
      );
      return revoked.ok ? ok({}) : err("protocol.bad_args");
    },
  };
}
