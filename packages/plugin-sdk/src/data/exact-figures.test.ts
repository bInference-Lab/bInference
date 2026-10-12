import { describe, expect, it } from "vitest";
import { changeBpsOf, ratioOf, usdMicrosOf, wholeOf } from "./exact-figures.js";

describe("exact figures", () => {
  it.each([
    ["753.55", { numerator: 75_355n, denominator: 100n }],
    ["0", { numerator: 0n, denominator: 1n }],
    ["1e-7", { numerator: 1n, denominator: 10_000_000n }],
    ["1.25E+2", { numerator: 125n, denominator: 1n }],
    ["-1", undefined],
    ["1e61", undefined],
    ["0x10", undefined],
    [undefined, undefined],
  ])("reads the price %s exactly", (text, ratio) => {
    expect(ratioOf(text)).toStrictEqual(ratio);
  });

  it.each([
    ["15689173.54", 15_689_173_540_000n],
    ["0.0000019", 1n],
    ["0.0000009", 0n],
    ["2e3", 2_000_000_000n],
    ["-0.5", undefined],
    ["", undefined],
  ])("reads %s USD as micro-dollars, rounded down", (text, micros) => {
    expect(usdMicrosOf(text)).toBe(micros);
  });

  it.each([
    ["0.87", 87],
    ["-12.345", -1_234],
    ["312.456", 31_245],
    ["-0.001", 0],
    ["many", undefined],
  ])("reads a change of %s percent as basis points, toward zero", (text, bps) => {
    expect(changeBpsOf(text)).toBe(bps);
  });

  it.each([
    ["1680703943000", 1_680_703_943_000],
    ["1.0", 1],
    ["1.5", undefined],
    ["-3", undefined],
    ["1e20", undefined],
  ])("reads %s as a whole number only when it is one", (text, whole) => {
    expect(wholeOf(text)).toBe(whole);
  });
});
