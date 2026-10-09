import type { SignerRefusal } from "@binference/chain";
import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { signerRefusedNotice, signerRefusedNoticeKey } from "./signer-refused-notice.js";

const intent = fixtureId("int", 1);
const warning = String.fromCodePoint(0x26a0, 0xfe0f);
const english = createFormatter({ locale: "en", timeZone: "UTC" });
const chinese = createFormatter({ locale: "zh", timeZone: "UTC" });

describe("the signer refusal notice", () => {
  it("reaches every reading client on the notice topic and names the trade and the rule", () => {
    expect(signerRefusedNotice({ intent, refused: "rule_2" })).toStrictEqual({
      topic: "notice",
      kind: "notice/new",
      data: { key: "notice.signerRefused", values: { rule: "rule_2" }, intent },
    });
  });

  it("names the broken rule in plain words", () => {
    expect(english.message(signerRefusedNoticeKey, { rule: "rule_3" })).toBe(
      `${warning} The signer refused to sign a step of a trade: its amounts are not the trade's. Nothing was sent for it.`,
    );
  });

  it("has words for every refusal, in English and Chinese", () => {
    const rules: readonly SignerRefusal[] = [
      "unknown_request",
      "malformed",
      "rule_1",
      "rule_2",
      "rule_3",
      "rule_4",
      "rule_5",
      "rule_6",
    ];
    const named = (formatter: typeof english) =>
      rules.map((rule) => formatter.message(signerRefusedNoticeKey, { rule }));
    expect(new Set(named(english)).size).toBe(rules.length);
    expect(new Set(named(chinese)).size).toBe(rules.length);
  });
});
