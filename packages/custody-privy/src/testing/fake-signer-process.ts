import { generateKeyPairSync, sign } from "node:crypto";
import { err, ok } from "@binference/core";
import type { SignerProcess } from "../ports.js";
import type { AuthorizeRequest } from "../signer-process/authorize-request.js";
import { signaturePayload } from "../signer-process/privy-request.js";

/**
 * A signer for tests: it holds a real P-256 agent key and signs Privy's payload of every request
 * it is asked, as the signer process does once its hard rules pass. It checks no hard rule.
 */
export interface FakeSignerProcess extends SignerProcess {
  /** The last 1,000 requests it was asked to authorize, oldest first. */
  requests(): readonly AuthorizeRequest[];
  /** Refuses every later request, as a failed hard rule does. */
  refuseFromNow(): void;
}

const maxKept = 1_000;

/** Creates a {@link FakeSignerProcess} with a new P-256 key. */
export function createFakeSignerProcess(): FakeSignerProcess {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicText = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const asked: AuthorizeRequest[] = [];
  let refusing = false;
  return {
    async publicKey(options) {
      options.signal.throwIfAborted();
      return Promise.resolve({ publicKey: publicText });
    },
    async authorize(request, options) {
      options.signal.throwIfAborted();
      asked.push(request);
      if (asked.length > maxKept) {
        asked.shift();
      }
      if (refusing) {
        return Promise.resolve(err("refused"));
      }
      const payload = Buffer.from(signaturePayload(request.request), "utf8");
      const signature = sign("sha256", payload, privateKey).toString("base64");
      return Promise.resolve(ok({ signature }));
    },
    requests: () => [...asked],
    refuseFromNow: () => {
      refusing = true;
    },
  };
}
