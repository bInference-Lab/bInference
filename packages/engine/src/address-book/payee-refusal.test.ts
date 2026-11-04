import { accountRefSchema } from "@binference/chain";
import { describe, expect, it } from "vitest";
import { testChains } from "../operations/test-engine.js";
import { payeeRefusal } from "./payee-refusal.js";

const chains = testChains();
const refusalOf = (account: string) => payeeRefusal([], accountRefSchema.parse(account), chains);

describe("whether an account may be a payee", () => {
  it("refuses a venue's contract the registry lists, in any letter case", () => {
    expect(refusalOf("fake:1:0x0000000b")).toBe("address.venue_contract");
    expect(refusalOf("fake:1:0x0000000B")).toBe("address.venue_contract");
  });

  it("takes a plain account, and one on a chain the registry does not run", () => {
    expect(refusalOf("fake:1:0x000000a1")).toBeUndefined();
    expect(refusalOf("fake:9:0x0000000b")).toBeUndefined();
  });

  it("finds no registry contract at an address its family cannot read", () => {
    expect(refusalOf("fake:1:0xnot-an-address")).toBeUndefined();
  });
});
