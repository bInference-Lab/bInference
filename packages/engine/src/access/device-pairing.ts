import {
  BinferenceError,
  type Clock,
  err,
  type Id,
  type IdSource,
  ok,
  type Result,
} from "@binference/core";
import type { AccessStore } from "../ports.js";
import type { EnginePush } from "../pushes/engine-push.js";
import { noticePush } from "../pushes/notice-push.js";
import { consolePairCodeHash } from "./console-pair-code.js";
import { deviceKeyObject } from "./device-key.js";
import type { DeviceAlg } from "./device-record.js";

/** The message key of the notice that a console device was paired (spec 4, section 4). */
export const newDeviceNoticeKey = "notice.newDevice";

/** The body of `POST /pair`, after the server parsed it. */
export interface PairRequest {
  /** The code from the link `binference console` printed. */
  readonly code: string;
  /** The device's public key, its SPKI DER in base64url. */
  readonly publicKey: string;
  readonly alg: DeviceAlg;
  /** What the owner calls the device, 1 to 64 characters. */
  readonly label: string;
}

/** Why a pairing is refused: a key that does not parse, or a code that does not work. */
export type PairRefusal = "protocol.bad_args" | "auth.invalid" | "auth.expired";

/** Pairs console devices with the codes `device/pair` issued. */
export interface DevicePairing {
  /**
   * Pairs a device: checks its key, uses the code once, stores the device and tells every surface.
   * A key that is not an SPKI key of `alg` is `protocol.bad_args`, before the code is used; an
   * unknown or used code is `auth.invalid`, an expired one `auth.expired`.
   */
  pair(
    request: PairRequest,
    call: { readonly signal: AbortSignal },
  ): Promise<Result<{ readonly device: Id<"dev"> }, PairRefusal>>;
}

/** What a {@link DevicePairing} reads and writes. */
export interface DevicePairingOptions {
  readonly access: AccessStore;
  readonly clock: Clock;
  readonly ids: IdSource;
  /** Sends the `notice.newDevice` notice to every surface. */
  readonly publish: (push: EnginePush) => void;
}

/** The notice that a console device was paired, with the label its browser gave. */
export function newDeviceNotice(label: string): EnginePush {
  return noticePush({ key: newDeviceNoticeKey, values: { label } });
}

/** Creates the pairing of console devices (protocol spec, section 4.2; decision 0155). */
export function createDevicePairing(options: DevicePairingOptions): DevicePairing {
  const { access, clock, ids } = options;
  return {
    async pair(request, call) {
      if (deviceKeyObject(request) === undefined) {
        return err("protocol.bad_args");
      }
      const atMs = clock.now();
      const used = await access.usePairCode(
        { codeHash: consolePairCodeHash(request.code), atMs },
        call,
      );
      if (!used.ok) {
        return err(used.error === "expired" ? "auth.expired" : "auth.invalid");
      }
      const { label, alg, publicKey } = request;
      const device = { id: ids.next("dev"), label, alg, publicKey, createdAtMs: atMs };
      const added = await access.addDevice(device, call);
      if (!added.ok) {
        throw new BinferenceError({
          code: "engine.device_taken",
          message: "A new device id collided with a stored one; pair again.",
        });
      }
      options.publish(newDeviceNotice(label));
      return ok({ device: device.id });
    },
  };
}
