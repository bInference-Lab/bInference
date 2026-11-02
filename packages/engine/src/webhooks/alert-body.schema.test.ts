import { describe, expect, it } from "vitest";
import { readAlertBody } from "./alert-body.schema.js";

const utf8 = (text: string): Readonly<Uint8Array> => new TextEncoder().encode(text);

describe("an alert's body", () => {
  it.each([
    ["an object with an id", '{"id":"tv-42","side":"sell","size":"9"}', "tv-42"],
    ["an id of 128 characters", `{"id":"${"x".repeat(128)}"}`, "x".repeat(128)],
  ] as const)("keeps %s and reads its id", (_name, text, alertId) => {
    expect(readAlertBody(utf8(text))).toStrictEqual({ body: { text }, alertId });
  });

  it.each([
    ["plain text", "BNBUSDT crossed 600"],
    ["an empty body", ""],
    ["an object without an id", '{"ticker":"BNBUSDT"}'],
    ["an id only in its prototype", '{"__proto__":{"id":"x"}}'],
    ["an array", '[{"id":"x"}]'],
    ["a JSON string", '"buy"'],
    ["an empty id", '{"id":""}'],
    ["an id of 129 characters", `{"id":"${"x".repeat(129)}"}`],
    ["a number as id", '{"id":42}'],
    ["a null id", '{"id":null}'],
  ])("keeps %s as text, with no id", (_name, text) => {
    expect(readAlertBody(utf8(text))).toStrictEqual({ body: { text } });
  });

  it("keeps bytes that are not UTF-8 in base64, with no id", () => {
    expect(readAlertBody(new Uint8Array([0x7b, 0xff, 0x7d]))).toStrictEqual({
      body: { base64: "e/99" },
    });
  });
});
