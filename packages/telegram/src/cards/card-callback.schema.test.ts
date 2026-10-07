import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { cardCallbackData, cardCallbackSchema, type CardDecision } from "./card-callback.schema.js";

const ref = "q3Zr_x9-AbCdEfGh";
const decisions: readonly CardDecision[] = ["confirm", "deny", "details"];
const refs = fc
  .uint8Array({ minLength: 12, maxLength: 12 })
  .map((bytes) => Buffer.from(bytes).toString("base64url"));

// Data close to a button's: a real one with characters dropped, added or changed.
const nearlyCanonical = fc
  .tuple(refs, fc.constantFrom(...decisions), fc.string({ maxLength: 3 }), fc.nat(30))
  .map(([random, decision, noise, at]) => {
    const data = cardCallbackData({ decision, ref: random });
    return `${data.slice(0, at)}${noise}${data.slice(at + (noise.length % 2))}`;
  });

// Data the schema takes must be exactly what the writer writes for what it read.
function isRefusedOrExact(data: string): boolean {
  const parsed = cardCallbackSchema.safeParse(data);
  return !parsed.success || cardCallbackData(parsed.data) === data;
}

describe("card callback data", () => {
  it("writes each decision as bnf1:c:<decision>:<ref>", () => {
    expect(decisions.map((decision) => cardCallbackData({ decision, ref }))).toStrictEqual([
      `bnf1:c:y:${ref}`,
      `bnf1:c:n:${ref}`,
      `bnf1:c:d:${ref}`,
    ]);
  });

  it("fits Telegram's 64 bytes and reads back as written, for any reference", () => {
    fc.assert(
      fc.property(refs, fc.constantFrom(...decisions), (random, decision) => {
        const data = cardCallbackData({ decision, ref: random });
        expect(new TextEncoder().encode(data).length).toBeLessThanOrEqual(64);
        expect(cardCallbackSchema.parse(data)).toStrictEqual({ decision, ref: random });
      }),
    );
  });

  it.each([
    ["another prefix", `bnf2:c:y:${ref}`],
    ["another kind", `bnf1:o:y:${ref}`],
    ["another decision", `bnf1:c:x:${ref}`],
    ["a short reference", "bnf1:c:y:q3Zr_x9-AbCdEfG"],
    ["a long reference", `bnf1:c:y:${ref}A`],
    ["a reference outside base64url", "bnf1:c:y:q3Zr/x9+AbCdEfGh"],
    ["a part too many", `bnf1:c:y:${ref}:1`],
    ["an id in place of a reference", "bnf1:c:y:int_0190f1c2-3a4b-7c5d"],
    ["a trailing line break", `bnf1:c:y:${ref}\n`],
    ["nothing", ""],
  ])("refuses data with %s", (_name, data) => {
    expect(cardCallbackSchema.safeParse(data).success).toBe(false);
  });

  it("refuses any data but the exact form its buttons carry", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string({ unit: "binary", maxLength: 80 }), nearlyCanonical),
        (data) => {
          expect(isRefusedOrExact(data)).toBe(true);
        },
      ),
    );
  });

  it("refuses to write a reference that is not 12 bytes in base64url", () => {
    expect(() => cardCallbackData({ decision: "confirm", ref: "short" })).toThrow(
      expect.objectContaining({ code: "telegram.bad_card_ref" }),
    );
  });
});
