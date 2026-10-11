import * as z from "zod/mini";
import type { StoredDevice } from "./device-store";

const storedDeviceSchema = z.object({
  deviceId: z.string().check(z.regex(/^dev_/)),
  alg: z.enum(["ed25519", "p256"]),
  privateKey: z.instanceof(CryptoKey),
});

/** The device record IndexedDB gave back, or `undefined` for anything that is not one. */
export function readStoredDevice(value: unknown): StoredDevice | undefined {
  const parsed = storedDeviceSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
