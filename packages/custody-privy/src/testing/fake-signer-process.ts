import { generateKeyPairSync, sign } from "node:crypto";
import {
  type AuthorizeInput,
  authorizationPayload,
  type SignerProcess,
  type SignerRefusal,
} from "@binference/chain";
import { err, ok } from "@binference/core";

/**
 * A signer for tests: it holds a real P-256 agent key and signs Privy's payload of every request
 * it is asked, as the signer process does once its hard rules pass. It checks no hard rule.
 */
export interface FakeSignerProcess extends SignerProcess {
  /** The last 1,000 requests it was asked to authorize, oldest first. */
  requests(): readonly AuthorizeInput[];
  /** Refuses every later request with this reason, as a failed hard rule does. */
  refuseFromNow(reason: SignerRefusal): void;
}

const maxKept = 1_000;

/** Creates a {@link FakeSignerProcess} with a new P-256 key. */
export function createFakeSignerProcess(): FakeSignerProcess {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicText = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const asked: AuthorizeInput[] = [];
  let refusal: SignerRefusal | undefined;
  return {
    async publicKey(options) {
      options.signal.throwIfAborted();
      return Promise.resolve(publicText);
    },
    async authorize(input, options) {
      options.signal.throwIfAborted();
      asked.push(input);
      if (asked.length > maxKept) {
        asked.shift();
      }
      if (refusal !== undefined) {
        return Promise.resolve(err(refusal));
      }
      const payload = authorizationPayload(input.request);
      return Promise.resolve(ok(sign("sha256", payload, privateKey).toString("base64")));
    },
    requests: () => [...asked],
    refuseFromNow: (reason) => {
      refusal = reason;
    },
  };
}
