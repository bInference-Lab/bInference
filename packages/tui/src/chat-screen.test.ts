import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { createChatScreen } from "./chat-screen.js";

function screenOf(columns: number, rows: number) {
  const output = new PassThrough();
  const written: string[] = [];
  output.on("data", (chunk: Buffer) => written.push(chunk.toString("utf8")));
  const screen = createChatScreen({ output, size: () => ({ columns, rows }) });
  return { screen, written: () => written.join("") };
}

describe("the chat's screen", () => {
  it("prints lines above the live area and draws the area again under them", () => {
    const { screen, written } = screenOf(40, 10);
    screen.show([{ text: "Working on it · 2 s" }, { text: "› hi" }]);
    screen.print([{ text: "main: Hello." }]);
    expect(written()).toBe(
      "Working on it · 2 s\n› hi" +
        "\r\u001b[1A\u001b[J" +
        "main: Hello.\n" +
        "Working on it · 2 s\n› hi",
    );
  });

  it("cuts each live row one column short of the width, so no row wraps", () => {
    const { screen, written } = screenOf(10, 10);
    screen.show([{ text: "Confirm swap · main" }]);
    expect(written()).toBe("Confirm …");
  });

  it("keeps the newest rows that fit the terminal's height", () => {
    const { screen, written } = screenOf(40, 3);
    screen.show([{ text: "one" }, { text: "two" }, { text: "three" }]);
    expect(written()).toBe("two\nthree");
  });

  it("clears the live area when it closes", () => {
    const { screen, written } = screenOf(40, 10);
    screen.show([{ text: "a" }, { text: "b" }, { text: "› " }]);
    screen.close();
    expect(written()).toBe("a\nb\n› \r\u001b[1A\u001b[1A\u001b[J");
  });

  it("writes no color to a stream that is no terminal", () => {
    const { screen, written } = screenOf(40, 10);
    screen.print([{ text: "Chat closed.", tone: "dim" }]);
    expect(written()).toBe("Chat closed.\n");
  });
});
