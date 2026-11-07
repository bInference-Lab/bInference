// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RichText } from "./rich-text";

afterEach(cleanup);

describe("the agent's text in the console", () => {
  it("draws bold, code and a web link as elements, its text never read as HTML", () => {
    const { container } = render(
      <RichText
        text={"Send **0.5 BNB** to `0xabc` <b>now</b> on [BscScan](https://bscscan.com)"}
      />,
    );
    expect(container.querySelector("strong")?.textContent).toBe("0.5 BNB");
    expect(container.querySelector("code")?.textContent).toBe("0xabc");
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain("<b>now</b>");
    const link = screen.getByRole("link", { name: "BscScan" });
    expect([link.getAttribute("href"), link.getAttribute("rel")]).toStrictEqual([
      "https://bscscan.com",
      "noopener noreferrer",
    ]);
  });

  it("keeps paragraphs, quotes and code blocks apart, and never links a script address", () => {
    const { container } = render(
      <RichText text={"First.\n\n> Careful\n\n```\nls -l\n```\n\n[x](javascript:alert(1))"} />,
    );
    expect(
      [...container.querySelectorAll("p, blockquote, pre")].map((node) => node.tagName),
    ).toStrictEqual(["P", "BLOCKQUOTE", "PRE", "P"]);
    expect(container.querySelector("pre")?.textContent).toBe("ls -l");
    expect(container.querySelector("a")).toBeNull();
  });
});
