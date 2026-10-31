import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createSecret } from "@binference/core";
import { createKeychainSecretStore } from "@binference/platform";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkPrivyApp } from "../privy/check-privy-app.js";
import { createPrivyApi } from "../privy/privy-api.js";
import type { PrivyApiOptions } from "../privy/privy-client.js";
import { createFakeSignerProcess } from "../testing/fake-signer-process.js";
import { createKeepingPrivyApi } from "../testing/keeping-privy-api.js";
import { createLeftoverBook, leftoverKeychainService } from "../testing/leftover-book.js";
import { type SweepCounts, sweepLeftovers } from "../testing/leftover-sweep.js";
import { liveHttps } from "../testing/live-https.js";
import { ownerSigner } from "../testing/owner-signer.js";
import { realClock } from "../testing/real-clock.js";
import { privyCustodyContract } from "./privy-custody-contract.js";
import type { PrivyCustodySubject } from "./privy-custody-setup.js";

// The live half of the custody contract: it runs against the Privy test app only when this switch
// is set, with the app's id and secret in the environment, never in the repository. It makes key
// quorums, the caps' aggregations, policies and wallets on the app, and signs without
// broadcasting. Its owner key and every id it makes are kept in the OS keychain first, so a sweep
// with that key removes what a run that died left: the app keeps at most 10 aggregations, and only
// their owner deletes one. The suite sweeps what earlier runs left before it starts, and its own
// leftovers at the end.
// oxlint-disable-next-line node/no-process-env -- the switch and the test app's credentials, read only here
const environment = process.env;
const {
  BINFERENCE_PRIVY_TESTS: switchOn,
  BINFERENCE_PRIVY_APP_ID: appId = "",
  BINFERENCE_PRIVY_APP_SECRET: secret = "",
} = environment;
const liveTests = switchOn === "1" && appId !== "" && secret !== "";

const privy: PrivyApiOptions = {
  http: liveHttps,
  clock: realClock,
  appId,
  appSecret: createSecret(secret),
  timeoutMs: 30_000,
};
const book = createLeftoverBook(createKeychainSecretStore({ service: leftoverKeychainService }));

// A sweep sends one request at a time, each within 30 seconds.
const sweepTimeoutMs = 600_000;

let subject: PrivyCustodySubject | undefined;
let kept: string | undefined;

// A subject whose owner key the keychain holds before anything is made with it.
async function keptSubject(signal: AbortSignal): Promise<PrivyCustodySubject> {
  const owner = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const ownerKey = owner.publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const name = await book.keep(owner.privateKey, signal);
  kept = name;
  return {
    api: createKeepingPrivyApi(createPrivyApi(privy), { book, name, ownerKey }),
    signerProcess: createFakeSignerProcess(),
    strangerProcess: createFakeSignerProcess(),
    ownerKey,
    ownerAuthorize: ownerSigner(owner.privateKey),
    clock: realClock,
  };
}

// One subject for every check, so the suite makes one wallet on the app in all.
function sharedSubject(): PrivyCustodySubject {
  assert.ok(subject !== undefined, "The live suite's setup made no subject.");
  return subject;
}

function report(when: string, counts: SweepCounts): void {
  // oxlint-disable-next-line no-console -- what the sweep removed is the suite's output
  console.info(`Privy test app sweep ${when}: ${JSON.stringify(counts)}`);
}

describe.runIf(liveTests)("the Privy test app", () => {
  beforeAll(async () => {
    const signal = AbortSignal.timeout(sweepTimeoutMs);
    report("before the run", await sweepLeftovers({ privy, book }, signal));
    subject = await keptSubject(signal);
  }, sweepTimeoutMs);

  afterAll(async () => {
    assert.ok(kept !== undefined, "The live suite kept no owner key.");
    const swept = await sweepLeftovers(
      { privy, book, only: kept },
      AbortSignal.timeout(sweepTimeoutMs),
    );
    report("after the run", swept);
    assert.equal(swept.recordsCleared, 1, "Privy kept a policy or an aggregation of the run.");
  }, sweepTimeoutMs);

  it.each(privyCustodyContract({ create: sharedSubject }))(
    "follows the custody contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
    120_000,
  );
});

describe.runIf(liveTests)("the Privy test app's id and secret", () => {
  it("passes the check with one read, and another secret is rejected", async () => {
    const options = { http: liveHttps, clock: realClock, appId, timeoutMs: 30_000 };
    const call = { signal: AbortSignal.timeout(60_000) };
    await expect(
      checkPrivyApp({ ...options, appSecret: createSecret(secret) }, call),
    ).resolves.toStrictEqual({ ok: true, value: undefined });
    await expect(
      checkPrivyApp({ ...options, appSecret: createSecret(`${secret}-not`) }, call),
    ).resolves.toStrictEqual({ ok: false, error: "rejected" });
  });
});
