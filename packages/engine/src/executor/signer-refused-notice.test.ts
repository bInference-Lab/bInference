import type { SignerRefusal, SignerServiceRefusal } from "@binference/chain";
import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { signerRefusedNotice, signerRefusedNoticeKey } from "./signer-refused-notice.js";

const intent = fixtureId("int", 1);
const warning = String.fromCodePoint(0x26a0, 0xfe0f);
const english = createFormatter({ locale: "en", timeZone: "UTC" });
const chinese = createFormatter({ locale: "zh", timeZone: "UTC" });

const refused = `${warning} The signer refused to sign a step of a trade:`;
const nothingSent = "Nothing was sent for it.";

// Every reason the signer process or a signer service refuses with, once each.
const reasons: readonly (SignerRefusal | SignerServiceRefusal)[] = [
  "unknown_request",
  "malformed",
  "rule_1",
  "rule_2",
  "rule_3",
  "rule_4",
  "rule_5",
  "rule_6",
  "unknown_wallet",
  "intent_state",
  "no_authorization",
  "authorization_ended",
  "terms_changed",
  "nonce_held",
  "privy_refused",
];

describe("the signer refusal notice", () => {
  it("reaches every reading client on the notice topic and names the trade and the rule", () => {
    expect(signerRefusedNotice({ intent, refused: "rule_2" })).toStrictEqual({
      topic: "notice",
      kind: "notice/new",
      data: { key: "notice.signerRefused", values: { rule: "rule_2" }, intent },
    });
  });

  it("names a signer service's reason as it names a rule", () => {
    expect(signerRefusedNotice({ intent, refused: "nonce_held" })).toMatchObject({
      data: { key: "notice.signerRefused", values: { rule: "nonce_held" }, intent },
    });
  });

  it("names the broken rule in plain words", () => {
    expect(english.message(signerRefusedNoticeKey, { rule: "rule_3" })).toBe(
      `${refused} its amounts are not the trade's. ${nothingSent}`,
    );
  });

  it.each<readonly [SignerServiceRefusal, string]>([
    ["unknown_wallet", "it is from a wallet the signer service does not know"],
    ["intent_state", "the trade was no longer under way"],
    ["no_authorization", "no confirmation or grant stood behind it"],
    [
      "authorization_ended",
      "the confirmation or the grant behind it had run out before it was signed",
    ],
    ["terms_changed", "its terms are not the ones that were confirmed"],
    [
      "nonce_held",
      "another trade of the wallet still holds its nonce, so propose it again once that trade ends",
    ],
    [
      "privy_refused",
      "Privy refused it: the wallet's ceiling does not allow it, or bInference's signer service was removed from the wallet. Check the wallet on binference.io",
    ],
  ])("says what a signer service's %s means", (reason, words) => {
    expect(english.message(signerRefusedNoticeKey, { rule: reason })).toBe(
      `${refused} ${words}. ${nothingSent}`,
    );
  });

  it("has words of its own for every refusal, in English and Chinese", () => {
    const named = (formatter: typeof english) =>
      reasons.map((rule) => formatter.message(signerRefusedNoticeKey, { rule }));
    const fallback = (formatter: typeof english) =>
      formatter.message(signerRefusedNoticeKey, { rule: "other" });
    expect(new Set(named(english)).size).toBe(reasons.length);
    expect(new Set(named(chinese)).size).toBe(reasons.length);
    expect(named(english)).not.toContain(fallback(english));
    expect(named(chinese)).not.toContain(fallback(chinese));
  });
});
