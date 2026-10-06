import { messageLocales, messages } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { cardKeys } from "./card-line.js";

const areas = ["card.", "autoAsks.", "receipt."];

describe("card keys", () => {
  it("has an English and a Chinese message for every card key and no other", () => {
    const wanted = [...cardKeys].toSorted();
    const found = messageLocales.map((locale) =>
      Object.keys(messages[locale])
        .filter((key) => areas.some((area) => key.startsWith(area)))
        .toSorted(),
    );
    expect(found).toStrictEqual(messageLocales.map(() => wanted));
  });
});
