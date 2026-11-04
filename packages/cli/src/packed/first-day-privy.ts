import process from "node:process";
import { BinferenceError, createSecret, type Http } from "@binference/core";
import {
  createFakePrivy,
  createLeftoverBook,
  leftoverKeychainService,
  liveHttps,
  realClock,
  sweepLeftovers,
} from "@binference/custody-privy/testing";
import { createKeychainSecretStore } from "@binference/platform";
import { createP256KeyPair } from "@binference/signer";
import { createSystemClock } from "../runtime/system-clock.js";
import { createSystemRandom } from "../runtime/system-random.js";

/** Which Privy the first day runs on: the e2e fake, or the dev app on a run by hand. */
export type FirstDayPrivyMode = "fake" | "real";

/** The Privy of one first day: its app, the owner key init names, and its cleanup. */
export interface FirstDayPrivy {
  readonly kind: "fake" | "dev app";
  /** The fake's API, which the edge serves as `api.privy.io`; the dev app is reached as it is. */
  readonly fake: Http | undefined;
  readonly appId: string;
  /** Only ever handed to init through a variable it reads as a secret source. */
  readonly appSecret: string;
  /** The owner key's public half, which init takes; its private half never leaves this process. */
  readonly ownerKeyPublic: string;
  /**
   * Removes what the day made on the dev app with the owner key the keychain kept for it, and
   * answers what Privy kept; the key leaves the keychain only once nothing is left. Nothing to do
   * on the fake.
   */
  cleanUp(signal: AbortSignal): Promise<readonly string[]>;
}

// A sweep sends one request at a time, each within 30 seconds.
const callTimeoutMs = 30_000;

function fakePrivy(): FirstDayPrivy {
  const privy = createFakePrivy({ clock: createSystemClock(), random: createSystemRandom() });
  return {
    kind: "fake",
    fake: privy.http,
    appId: privy.appId,
    appSecret: privy.appSecret.reveal(),
    ownerKeyPublic: createP256KeyPair().publicKey,
    cleanUp: async () => Promise.resolve([]),
  };
}

// The dev app's id and secret, which a run by hand hands over; neither is ever printed, and
// neither stays in this process's environment for the programs it starts.
function devAppCredentials(): { readonly appId: string; readonly appSecret: string } {
  const appId = process.env["BINFERENCE_PRIVY_APP_ID"] ?? "";
  const appSecret = process.env["BINFERENCE_PRIVY_APP_SECRET"] ?? "";
  delete process.env["BINFERENCE_PRIVY_APP_ID"];
  delete process.env["BINFERENCE_PRIVY_APP_SECRET"];
  if (appId === "" || appSecret === "") {
    throw new BinferenceError({
      code: "smoke.no_privy_app",
      message:
        "The first day on Privy's dev app needs BINFERENCE_PRIVY_APP_ID and " +
        "BINFERENCE_PRIVY_APP_SECRET; set both, or run it on the fake.",
    });
  }
  return { appId, appSecret };
}

// The dev app, with the owner key kept in the OS keychain before init makes anything with it, as
// the custody suite's live runs keep theirs, so a sweep removes what a day that died left.
async function devAppPrivy(signal: AbortSignal): Promise<FirstDayPrivy> {
  const { appId, appSecret } = devAppCredentials();
  const book = createLeftoverBook(createKeychainSecretStore({ service: leftoverKeychainService }));
  const owner = createP256KeyPair();
  const name = await book.keep(owner.privateKey, signal);
  const privy = {
    http: liveHttps,
    clock: realClock,
    appId,
    appSecret: createSecret(appSecret),
    timeoutMs: callTimeoutMs,
  };
  return {
    kind: "dev app",
    fake: undefined,
    appId,
    appSecret,
    ownerKeyPublic: owner.publicKey,
    cleanUp: async (cleanUpSignal) => {
      const swept = await sweepLeftovers({ privy, book, only: name }, cleanUpSignal);
      return swept.recordsCleared === 1
        ? []
        : [
            `Privy's dev app kept ${String(swept.othersKept)} policies or aggregations; ` +
              "the owner key stays in the keychain for pnpm privy:sweep",
          ];
    },
  };
}

/** Opens the first day's Privy: the fake, or on `real` the dev app with its owner key kept. */
export async function openFirstDayPrivy(
  mode: FirstDayPrivyMode,
  signal: AbortSignal,
): Promise<FirstDayPrivy> {
  return mode === "real" ? devAppPrivy(signal) : fakePrivy();
}
