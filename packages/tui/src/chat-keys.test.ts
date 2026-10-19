import { describe, expect, it } from "vitest";
import { keyAction } from "./chat-keys.js";

const empty = { input: "", isPasting: false, choices: 0 };
const asked = { ...empty, choices: 3 };

describe("what a key does in the chat", () => {
  it.each([
    ["c", "leave"],
    ["y", "confirm"],
    ["n", "cancel"],
    ["u", "clearLine"],
    ["d", "leave"],
  ])("a control key with %s does %s", (name, kind) => {
    expect(keyAction(undefined, { name, ctrl: true }, empty)).toStrictEqual({ kind });
  });

  it("leaves on Ctrl+D only while the line is empty", () => {
    expect(
      keyAction(undefined, { name: "d", ctrl: true }, { ...empty, input: "hi" }),
    ).toStrictEqual({ kind: "ignore" });
  });

  it("sends on Enter, and starts a new line of the message inside a paste", () => {
    expect(keyAction("\r", { name: "return" }, empty)).toStrictEqual({ kind: "send" });
    expect(keyAction("\r", { name: "return" }, { ...empty, isPasting: true })).toStrictEqual({
      kind: "type",
      text: "\n",
    });
  });

  it("stops on Esc, erases on Backspace and follows a paste's start and end", () => {
    expect(keyAction("\u001b", { name: "escape" }, empty)).toStrictEqual({ kind: "stop" });
    expect(keyAction("\u007f", { name: "backspace" }, empty)).toStrictEqual({ kind: "erase" });
    expect(keyAction(undefined, { name: "paste-start" }, empty)).toStrictEqual({
      kind: "pasteStart",
    });
    expect(keyAction(undefined, { name: "paste-end" }, empty)).toStrictEqual({ kind: "pasteEnd" });
  });

  it("answers the open question with a number key on an empty line", () => {
    expect(keyAction("2", { name: "2" }, asked)).toStrictEqual({ kind: "choose", place: 1 });
  });

  it("types a number past the question's choices, or on a line already started", () => {
    expect(keyAction("4", { name: "4" }, asked)).toStrictEqual({ kind: "type", text: "4" });
    expect(keyAction("2", { name: "2" }, { ...asked, input: "x" })).toStrictEqual({
      kind: "type",
      text: "2",
    });
    expect(keyAction("1", { name: "1" }, empty)).toStrictEqual({ kind: "type", text: "1" });
  });

  it("types letters and wide characters, and ignores arrows, tabs and Alt keys", () => {
    const wide = String.fromCodePoint(0x4f60, 0x597d);
    expect(keyAction("y", { name: "y" }, empty)).toStrictEqual({ kind: "type", text: "y" });
    expect(keyAction(wide, {}, empty)).toStrictEqual({ kind: "type", text: wide });
    expect(keyAction("\u001b[A", { name: "up" }, empty)).toStrictEqual({ kind: "ignore" });
    expect(keyAction("\t", { name: "tab" }, empty)).toStrictEqual({ kind: "ignore" });
    expect(keyAction("\u001bb", { name: "b", meta: true }, empty)).toStrictEqual({
      kind: "ignore",
    });
  });
});
