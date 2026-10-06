import { describe, expect, it } from "vitest";
import { parseMessage } from "./parse-message.js";

describe("parseMessage", () => {
  it("lists each argument once, sorted, with its kind", () => {
    const parsed = parseMessage(
      "{name} has {count, plural, one {# token} other {# tokens}} on {day, date} at {hour, time}" +
        " worth {value, number}; {side, select, buy {buying} other {selling}} <b>{name}</b>" +
        " {place, selectordinal, one {#st} other {#th}}",
    );
    expect(parsed).toMatchObject({
      ok: true,
      value: {
        arguments: [
          "<b>",
          "{count, plural}",
          "{day, date}",
          "{hour, time}",
          "{name}",
          "{place, selectordinal}",
          "{side, select}",
          "{value, number}",
        ],
      },
    });
  });

  it("keeps the words of every branch and leaves out the argument names", () => {
    const parsed = parseMessage("Sell {in} to {count, plural, one {one wallet} other {# wallets}}");
    expect(parsed).toMatchObject({
      ok: true,
      value: {
        arguments: ["{count, plural}", "{in}"],
        text: ["Sell ", " to ", "one wallet", " wallets"].join("\n"),
      },
    });
  });

  it("names the parser's error for a message that does not parse", () => {
    expect(parseMessage("over {cap")).toStrictEqual({
      ok: false,
      error: "EXPECT_ARGUMENT_CLOSING_BRACE",
    });
  });
});
