import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "../../../../packages/i18n/messages/en/web.json" with { type: "json" };
import { wordsFor } from "./words";

describe("wordsFor", () => {
  const words = wordsFor("en");

  it("draws the tags of a message", () => {
    expect(renderToStaticMarkup(<p>{words.rich("readme.title")}</p>)).toBe(
      "<p>Read <b>me.</b></p>",
    );
    expect(renderToStaticMarkup(<p>{words.rich("assembly.final")}</p>)).toBe(
      '<p>One agent. <b class="gold">Yours.</b></p>',
    );
  });

  it("gives plain text without its tags", () => {
    expect(words.text("readme.title")).toBe("Read me.");
  });

  it("puts each word of a split heading in its own mask, numbered in order", () => {
    const markup = renderToStaticMarkup(<h1>{words.split("play.title")}</h1>);
    expect(markup.match(/class="sw"/g)).toHaveLength(4);
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
