import { describe, expect, it } from "vitest";
import { redactedMark, redactSecrets } from "./redact-secrets.js";

const phrase = Array.from({ length: 12 }, () => "abandon").join(" ");

describe("redactSecrets", () => {
  it.each([
    ["a private key", `0x${"0f".repeat(32)}`],
    ["a recovery phrase", phrase],
    ["a bot token", "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw9"],
    ["a binference key", `binf_${"a1".repeat(10)}`],
    ["a protocol token", `bnt_${"Q2".repeat(16)}`],
  ])("masks %s", (_kind, secret) => {
    const masked = redactSecrets(`Seen: ${secret}.`);
    expect(masked).toBe(`Seen: ${redactedMark}.`);
  });

  it("keeps an address, an id and short runs of words", () => {
    const text = "agent agt_1 sent to 0x55d398326f99059fF775485246999027B3197955 at block 9";
    expect(redactSecrets(text)).toBe(text);
  });
});
