import { generateKeyPairSync } from "node:crypto";
import { createManualClock, createSeededRandom, type ManualClock } from "@binference/core/testing";
import type { PrivyCustodySubject } from "../contracts/privy-custody-setup.js";
import { createPrivyApi } from "../privy/privy-api.js";
import { createFakePrivy, type FakePrivy } from "./fake-privy.js";
import { createFakeSignerProcess, type FakeSignerProcess } from "./fake-signer-process.js";

/** A custody subject on the Privy fake, with the fakes a test drives. */
export interface FakeCustodySubject extends PrivyCustodySubject {
  readonly clock: ManualClock;
  readonly privy: FakePrivy;
  readonly signerProcess: FakeSignerProcess;
}

/**
 * A subject for the custody contract on a fresh Privy fake: a client of the fake app, a fake
 * signer with a new agent key, a stranger's signer and a new owner key's public half. Time starts
 * at a fixed moment and moves only when the test advances it.
 */
export function createFakeCustodySubject(seed = 1): FakeCustodySubject {
  const clock = createManualClock(1_790_000_000_000);
  const privy = createFakePrivy({ clock, random: createSeededRandom(seed) });
  const owner = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    api: createPrivyApi({
      http: privy.http,
      clock,
      appId: privy.appId,
      appSecret: privy.appSecret,
    }),
    clock,
    privy,
    signerProcess: createFakeSignerProcess(),
    strangerProcess: createFakeSignerProcess(),
    ownerKey: owner.publicKey.export({ format: "der", type: "spki" }).toString("base64"),
  };
}
