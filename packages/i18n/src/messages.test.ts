import { describe, expect, it } from "vitest";
import { createFormatter } from "./format/create-formatter.js";
import { messageLocales } from "./locales.js";
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

describe("messages", () => {
  it("holds the same keys in every language", () => {
    const english = Object.keys(messages.en).toSorted();
    for (const locale of messageLocales) {
      expect(Object.keys(messages[locale]).toSorted()).toStrictEqual(english);
    }
  });

  it("formats every message in every language", () => {
    for (const locale of messageLocales) {
      const formatter = createFormatter({ locale, timeZone: "UTC" });
      for (const [key, text] of Object.entries(messages[locale])) {
        expect(formatter.message(key, sampleValues(text)).length).toBeGreaterThan(0);
      }
    }
  });

  it("prefixes each key with the area file it came from", () => {
    expect(messages.en["error.engine.locked"]).toBeDefined();
    expect(messages.en["reason.daily_cap"]).toBeDefined();
    expect(messages.en["engine.locked"]).toBeUndefined();
  });
});
