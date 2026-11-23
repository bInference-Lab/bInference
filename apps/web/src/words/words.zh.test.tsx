import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { wordsFor } from "./words";

describe("wordsFor in Chinese", () => {
  it("draws the gold full stop and the light second line of the hero", () => {
    const markup = renderToStaticMarkup(<h1>{wordsFor("zh").rich("hero.title")}</h1>);
    expect(markup).toBe(
      '<h1>你的 Agent<i class="stop"></i><br/><span class="second">就在 BNB Smart Chain 上。</span></h1>',
    );
  });
});
