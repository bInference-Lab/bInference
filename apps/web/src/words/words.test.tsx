import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "../../../../packages/i18n/messages/en/web.json" with { type: "json" };
import { wordsFor } from "./words";

describe("wordsFor", () => {
  const words = wordsFor("en");

  it("draws the tags of a message", () => {
    expect(renderToStaticMarkup(<p>{words.rich("gate.line")}</p>)).toBe(
      "<p><b>Nothing moves</b> until you tap.</p>",
    );
  });

  it("gives plain text without its tags", () => {
    expect(words.text("gate.line")).toBe("Nothing moves until you tap.");
  });

  it("puts each word of a split heading in its own mask, numbered in order", () => {
    const markup = renderToStaticMarkup(<h1>{words.split("install.title")}</h1>);
    expect(markup.match(/class="sw"/g)).toHaveLength(3);
    expect(markup).toContain('style="--n:0"');
    expect(markup).toContain('style="--n:2"');
    expect(markup).toContain("<b>");
  });

  it("formats every English message", () => {
    for (const key of Object.keys(en)) {
      expect(() => words.text(key as keyof typeof en)).not.toThrow();
    }
  });
});
