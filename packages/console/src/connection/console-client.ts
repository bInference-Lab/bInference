import { createProtocolClient, type ProtocolClient } from "@binference/client";
import { deviceProofText, operations, protocolIdSchema } from "@binference/protocol";
import type { ConsoleBrowser } from "../app/console-browser";
import { signWith } from "../device/device-key";
import type { StoredDevice } from "../device/device-store";
import { browserClock, browserRandom, quietLogger } from "./browser-ports";

/** How the console signs in: a paired device, or a Telegram Mini App launch. */
export type ConsoleCredential =
  | { readonly kind: "device"; readonly device: StoredDevice }
  | { readonly kind: "telegram"; readonly initData: string };

/** The version the console reports in `open`. */
const consoleVersion = "console";

function credentialOf(credential: ConsoleCredential) {
  return credential.kind === "device"
    ? { device: protocolIdSchema("consoleDevice").parse(credential.device.deviceId) }
    : { telegram: { initData: credential.initData } };
}

/**
 * The console's protocol client over the page's own WebSocket at `/ws`. A device answers each
 * challenge by signing the nonce and the page's origin with its key, which never leaves WebCrypto.
 */
export function createConsoleClient(
  browser: Pick<ConsoleBrowser, "origin" | "host" | "isSecure" | "openSocket" | "subtle">,
  credential: ConsoleCredential,
): ProtocolClient {
  const url = `${browser.isSecure ? "wss" : "ws"}://${browser.host}/ws`;
  const { subtle } = browser;
  const prover =
    credential.kind === "device" && subtle !== undefined
      ? {
          proveDevice: async (nonce: string) =>
            signWith(subtle, credential.device, deviceProofText({ nonce, origin: browser.origin })),
        }
      : {};
  return createProtocolClient({
    operations,
    openSocket: () => browser.openSocket(url),
    client: { kind: credential.kind === "device" ? "console" : "mini", version: consoleVersion },
    credential: credentialOf(credential),
    ...prover,
    clock: browserClock,
    random: browserRandom,
    logger: quietLogger,
  });
}
