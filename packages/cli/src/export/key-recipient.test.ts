import { describe, expect, it } from "vitest";
import { createKeyRecipient, sealTo } from "./key-recipient.js";

const key = `0x${"ef".repeat(32)}`;

async function sealed(publicKey: string) {
  const done = await sealTo(publicKey, key);
  if (done === undefined) {
    throw new Error("Expected a sealed key.");
  }
  return done;
}

describe("an export's recipient key", () => {
  it("opens what was sealed to it, and nothing sealed to another", async () => {
    const recipient = await createKeyRecipient();
    const other = await createKeyRecipient();

    const opened = await recipient.open(await sealed(recipient.publicKey));

    expect(new TextDecoder().decode(opened)).toBe(key);
    await expect(other.open(await sealed(recipient.publicKey))).rejects.toThrow(/./u);
  });

  it("sends a P-256 public key in DER, and seals nothing to a key that is none", async () => {
    const recipient = await createKeyRecipient();

    expect(Buffer.from(recipient.publicKey, "base64")).toHaveLength(91);
    expect(await sealTo("AAAA", key)).toBeUndefined();
  });
});
