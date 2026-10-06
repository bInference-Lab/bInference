import { describe, expect, it } from "vitest";
import { checkCodeMessages } from "./check-code-messages.js";

const messages = { error: { "engine.locked": "locked", "engine.starting": "starting" } };

describe("checkCodeMessages", () => {
  it("passes an area with a message for every code", () => {
    const codes = ["engine.locked", "engine.starting"];
    expect(checkCodeMessages({ locale: "en", area: "error", messages, codes })).toStrictEqual([]);
  });

  it("names a code without a message and a key that is no code", () => {
    const codes = ["engine.locked", "engine.timeout"];
    expect(checkCodeMessages({ locale: "en", area: "error", messages, codes })).toStrictEqual([
      {
        locale: "en",
        area: "error",
        key: "engine.timeout",
        text: "The code has no message; add one in every language.",
      },
      {
        locale: "en",
        area: "error",
        key: "engine.starting",
        text: "No code has this key; remove it or fix its spelling.",
      },
    ]);
  });

  it("names every code when the area file is missing", () => {
    const problems = checkCodeMessages({ locale: "en", area: "x", messages, codes: ["a.b"] });
    expect(problems.map((item) => item.key)).toStrictEqual(["a.b"]);
  });
});
