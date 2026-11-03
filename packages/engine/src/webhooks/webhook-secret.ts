import { Buffer } from "node:buffer";
import { BinferenceError, type Id, type Random } from "@binference/core";
import { type Sha256Hex, sha256Hex } from "../records/sha256-hex.js";

/** A new rule URL's secret, to show once, and the hash the store keeps of it. */
export interface WebhookSecret {
  /** 32 random bytes in base64url, 43 characters: never log or store it. */
  readonly secret: string;
  readonly secretHash: Sha256Hex;
}

const secretBytes = 32;

/**
 * Makes a rule URL's secret (spec 1, section 2.2): 32 bytes in base64url, which the listener's
 * route takes, and the SHA-256 of its text, the only form any store keeps. A 256-bit random secret
 * needs no slow hash. `secrets` must be the operating system's secure generator, which the
 * composition root passes apart from the engine's `Random`, so no seeded source ever makes one.
 */
export function newWebhookSecret(secrets: Random): WebhookSecret {
  const bytes = secrets.bytes(secretBytes);
  if (bytes.length !== secretBytes) {
    throw new BinferenceError({
      code: "engine.webhook_secret",
      message: "The secure generator gave fewer than 32 bytes for a webhook rule's secret.",
    });
  }
  const secret = Buffer.from(bytes).toString("base64url");
  return { secret, secretHash: sha256Hex(secret) };
}

/**
 * A rule's URL, `<base>/hook/<rule>/<secret>` (spec 1, section 7.5): the base is the published
 * webhook address when there is one, else the loopback listener's, with no trailing slash.
 */
export function webhookUrlOf(base: string, rule: Id<"whr">, secret: string): string {
  const root = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${root}/hook/${rule}/${secret}`;
}
