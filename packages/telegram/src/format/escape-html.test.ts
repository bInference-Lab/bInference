import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseFakeHtml } from "../testing/fake-html.js";
import { escapeHtml } from "./escape-html.js";

describe("escapeHtml", () => {
  it("turns ampersands and angle brackets into entities", () => {
    expect(escapeHtml('<b>Tom & "Jerry"</b>')).toBe('&lt;b&gt;Tom &amp; "Jerry"&lt;/b&gt;');
  });

  it("makes any text show as itself in Telegram's HTML, with no formatting", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary" }), (text) => {
        expect(parseFakeHtml(escapeHtml(text))).toStrictEqual({
          ok: true,
          value: { text, entities: [] },
        });
      }),
    );
  });
});
