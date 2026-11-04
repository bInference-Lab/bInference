import { idSchema } from "@binference/core";
import { createSeededRandom } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../records/sha256-hex.js";
import { newWebhookSecret, webhookUrlOf } from "./webhook-secret.js";

const rule = idSchema("whr").parse("whr_0190f1c2-3a4b-7c5d-8e6f-000000000001");

describe("a webhook rule's secret", () => {
  it("is 32 bytes in base64url, of which a store keeps only the SHA-256", () => {
    const { secret, secretHash } = newWebhookSecret(createSeededRandom(7));

    expect(Buffer.from(secret, "base64url")).toHaveLength(32);
    expect(secretHash).toBe(sha256Hex(secret));
  });

  it("is a fault when the generator gives fewer than 32 bytes", () => {
    const short = { bytes: (length: number) => new Uint8Array(length - 1) };

    expect(() => newWebhookSecret(short)).toThrow(
      expect.objectContaining({ code: "engine.webhook_secret" }),
    );
  });
});

describe("a webhook rule's URL", () => {
  it("joins the base, the rule and the secret, with one slash after a base that ends in one", () => {
    expect(webhookUrlOf("https://hooks.example.org/", rule, "s3cret")).toBe(
      `https://hooks.example.org/hook/${rule}/s3cret`,
    );
    expect(webhookUrlOf("http://127.0.0.1:7457", rule, "s3cret")).toBe(
      `http://127.0.0.1:7457/hook/${rule}/s3cret`,
    );
  });
});
