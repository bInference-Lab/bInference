import { generateKeyPairSync } from "node:crypto";
// oxlint-disable-next-line eslint/no-restricted-imports -- the live suite reaches Privy's API itself; no Http adapter exists in the packages yet
import { request as httpsRequest } from "node:https";
import {
  BinferenceError,
  type Clock,
  createSecret,
  type Http,
  type HttpRequest,
  type HttpResponse,
} from "@binference/core";
import { describe, expect, it } from "vitest";
import { createPrivyApi } from "../privy/privy-api.js";
import { createFakeSignerProcess } from "../testing/fake-signer-process.js";
import { privyCustodyContract } from "./privy-custody-contract.js";
import type { PrivyCustodySubject } from "./privy-custody-setup.js";

// The live half of the custody contract: it runs against the Privy test app only when this switch
// is set, with the app's id and secret in the environment, never in the repository. It makes key
// quorums, one policy and one wallet on the app, and signs without broadcasting.
// oxlint-disable-next-line node/no-process-env -- the switch and the test app's credentials, read only here
const environment = process.env;
const {
  BINFERENCE_PRIVY_TESTS: switchOn,
  BINFERENCE_PRIVY_APP_ID: appId = "",
  BINFERENCE_PRIVY_APP_SECRET: secret = "",
} = environment;
const liveTests = switchOn === "1" && appId !== "" && secret !== "";

function send(request: HttpRequest): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const outgoing = httpsRequest(
      request.url,
      { method: request.method, headers: request.headers, signal: request.signal },
      (incoming) => {
        const parts: Buffer[] = [];
        incoming.on("data", (part: Buffer) => parts.push(part));
        incoming.on("error", reject);
        incoming.on("end", () => {
          const headers = Object.fromEntries(
            Object.entries(incoming.headers).map(([name, value]) => [name, String(value)]),
          );
          resolve({
            status: incoming.statusCode ?? 0,
            headers,
            body: Buffer.concat(parts).toString("utf8"),
          });
        });
      },
    );
    outgoing.on("error", (cause) => {
      reject(
        request.signal.aborted
          ? request.signal.reason
          : new BinferenceError({
              code: "http.unreachable",
              message: "Privy gave no answer.",
              retryable: true,
              cause,
            }),
      );
    });
    outgoing.end(request.body);
  });
}

const https: Http = { request: async (request) => send(request) };

// Unit tests run on fake timers; the live suite needs the real time Privy checks expiries against.
const realClock: Clock = {
  now: () => Math.round(performance.timeOrigin + performance.now()),
  sleep: async (delayMs, signal) =>
    new Promise((resolve, reject) => {
      AbortSignal.timeout(delayMs).addEventListener("abort", () => {
        resolve();
      });
      signal.addEventListener("abort", () => {
        reject(signal.reason);
      });
    }),
};

function liveSubject(): PrivyCustodySubject {
  const owner = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    api: createPrivyApi({
      http: https,
      clock: realClock,
      appId,
      appSecret: createSecret(secret),
      timeoutMs: 30_000,
    }),
    signerProcess: createFakeSignerProcess(),
    strangerProcess: createFakeSignerProcess(),
    ownerKey: owner.publicKey.export({ format: "der", type: "spki" }).toString("base64"),
  };
}

let subject: PrivyCustodySubject | undefined;

// One subject for every check, so the suite makes one wallet on the app in all.
function sharedSubject(): PrivyCustodySubject {
  subject ??= liveSubject();
  return subject;
}

describe.runIf(liveTests)("the Privy test app", () => {
  it.each(privyCustodyContract({ create: sharedSubject }))(
    "follows the custody contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
    120_000,
  );
});
