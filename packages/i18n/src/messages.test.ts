import { IntlMessageFormat } from "intl-messageformat";
import { describe, expect, it } from "vitest";
import { createFormatter } from "./format/create-formatter.js";
import { intlTags, type MessageLocale, messageLocales } from "./locales.js";
import { messages } from "./messages.js";

// A value for each argument a message names: a count for plurals and numbers, text otherwise.
function sampleValues(text: string): Readonly<Record<string, string | number>> {
  const counted = /^(?:plural|selectordinal|number)$/;
  return Object.fromEntries(
    [...text.matchAll(/\{\s*(\w+)\s*(?:,\s*(\w+))?/g)].map(
      ([, name = "", kind = ""]: readonly string[]) => [name, counted.test(kind) ? 2 : "x"],
    ),
  );
}

// The landing site's messages carry rich tags (`<b>`, `<br/>`) that the site fills with
// elements, so the plain formatter cannot format them; they get a value for each tag here.
const tagged = /<\/?\w+\/?>/;

function tagValues(text: string): Readonly<Record<string, (parts: readonly unknown[]) => string>> {
  return Object.fromEntries(
    [...text.matchAll(/<(\w+)\/?>/g)].map(([, name = ""]: readonly string[]) => [
      name,
      (parts: readonly unknown[]) => parts.join(""),
    ]),
  );
}

function entriesOf(
  locale: MessageLocale,
  kind: "plain" | "tagged",
): readonly (readonly [string, string])[] {
  return Object.entries(messages[locale]).filter(
    ([, text]: readonly [string, string]) => tagged.test(text) === (kind === "tagged"),
  );
}

describe("messages", () => {
  it("holds the same keys in every language", () => {
    const english = Object.keys(messages.en).toSorted();
    for (const locale of messageLocales) {
      expect(Object.keys(messages[locale]).toSorted()).toStrictEqual(english);
    }
  });

  it("formats every message without rich tags in every language", () => {
    for (const locale of messageLocales) {
      const formatter = createFormatter({ locale, timeZone: "UTC" });
      for (const [key, text] of entriesOf(locale, "plain")) {
        expect(formatter.message(key, sampleValues(text)).length).toBeGreaterThan(0);
      }
    }
  });

  it("formats every message with rich tags once each tag has a value", () => {
    for (const locale of messageLocales) {
      for (const [, text] of entriesOf(locale, "tagged")) {
        const format = new IntlMessageFormat(text, intlTags[locale]);
        const parts = format.format({ ...sampleValues(text), ...tagValues(text) });
        expect([parts].flat().join("").length).toBeGreaterThan(0);
      }
    }
  });

  it.each(messageLocales)(
    "names every auto order kind in the %s refusal of live fills, which refuses each",
    (locale) => {
      const formatter = createFormatter({ locale, timeZone: "UTC" });
      const kinds = ["limit", "takeProfit", "stopLoss", "trailing", "dca", "copy"];
      const refusal = formatter.message("error.order.live_fills_off").toLowerCase();
      const unnamed = kinds.filter(
        (kind) => !refusal.includes(formatter.message("order.kind", { kind }).toLowerCase()),
      );
      expect(unnamed).toStrictEqual([]);
    },
  );

  it("prefixes each key with the area file it came from", () => {
    expect(messages.en["error.engine.locked"]).toBeDefined();
    expect(messages.en["reason.daily_cap"]).toBeDefined();
    expect(messages.en["engine.locked"]).toBeUndefined();
  });
});
