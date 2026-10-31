import { labelhash, namehash, zeroHash } from "viem";
import { describe, expect, it } from "vitest";
import { bnbNameOf, namesSame, reverseNodeOf } from "./bnb-name.js";

// Each label is written as its code points, as ENSIP-15's examples list them.
const cp = (...points: readonly number[]): string => String.fromCodePoint(...points);

// ENSIP-15's own examples (docs.ens.domains/ensip/15): a label and its normalized form.
const normalizes: readonly (readonly [string, string])[] = [
  [cp(0x5f, 0x24, 0x41), cp(0x5f, 0x24, 0x61)],
  [cp(0x45, 0xfe0e, 0x303), cp(0x1ebd)],
  [cp(0x1318f, 0x1f438), cp(0x1318f, 0x1f438)],
  [cp(0x41, 0xfe0e, 0x1f4a9, 0xfe0e, 0xfe0e, 0x62), cp(0x61, 0x1f4a9, 0x62)],
  [cp(0x61, 0x2122, 0xfe0f), "atm"],
  [cp(0x1f201), cp(0x30b3, 0x30b3)],
  [cp(0x2010, 0x39e, 0x31, 0xfe0f, 0x20e3), cp(0x2d, 0x3be, 0x31, 0x20e3)],
  [cp(0x1f4a9, 0x1f4a9), cp(0x1f4a9, 0x1f4a9)],
  ["___", "___"],
  ["__abc", "__abc"],
  ["ab-c", "ab-c"],
  ["---a", "---a"],
  [cp(0x61, 0x2019, 0x73), cp(0x61, 0x2019, 0x73)],
  ["SpaceID", "spaceid"],
];

// ENSIP-15's labels that do not normalize.
const refused: readonly string[] = [
  cp(0x6e, 0x131, 0x307, 0x63, 0x6b),
  cp(0x203c),
  "abc__",
  "_abc_",
  "xn--",
  "----",
  "ab--c",
  "a_b",
  cp(0x2019, 0x38, 0x35),
  `joneses${cp(0x2019)}`,
  `a${cp(0x30fb, 0x30fb)}a`,
  cp(0x78, 0x300, 0x300),
  cp(0x1f4a9, 0x200d, 0x1f4a9),
  `bahrain${cp(0x645, 0x635, 0x631)}`,
  cp(0x30, 0x445),
];

describe("bnbNameOf", () => {
  it.each(normalizes)("normalizes the label %s as ENSIP-15 does", (label, normalized) => {
    const name = `${normalized}.bnb`;
    expect(bnbNameOf(`${label}.bnb`)).toStrictEqual({
      name,
      node: namehash(name),
      registration: labelhash(normalized),
    });
  });

  it.each(refused)("refuses the label %s, which ENSIP-15 does not normalize", (label) => {
    expect(bnbNameOf(`${label}.bnb`)).toBeUndefined();
  });

  it("hashes names as the registry keys them on chain", () => {
    // `baseNode()` of the base registrar, and the node the registry resolves for spaceid.bnb.
    expect(namehash("bnb")).toBe(
      "0xdba5666821b22671387fe7ea11d7cc41ede85a5aa67c3e7b3d68ce6a661f389c",
    );
    expect(bnbNameOf("spaceid.bnb")?.node).toBe(
      "0xb79823769e3cb2b91391009234a048603f0fe259882303d115d10603fbcbf28e",
    );
  });

  it("takes the second-level label's hash as a subname's registration", () => {
    expect(bnbNameOf("pay.alice.bnb")).toStrictEqual({
      name: "pay.alice.bnb",
      node: namehash("pay.alice.bnb"),
      registration: labelhash("alice"),
    });
  });

  it.each(["alice.eth", "alice", "bnb", ".bnb", "alice..bnb", "alice.bnb.", ""])(
    "refuses %j, which is no name it resolves",
    (text) => {
      expect(bnbNameOf(text)).toBeUndefined();
    },
  );
});

describe("the namehash the names take", () => {
  // EIP-137's test vectors.
  it.each([
    ["", zeroHash],
    ["eth", "0x93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae"],
    ["foo.eth", "0xde9b09fd7c5f901e23a3f19fecc54828e9c848539801e86591bd9801b019f84f"],
  ])("hashes %j as EIP-137 does", (name, node) => {
    expect(namehash(name)).toBe(node);
  });
});

describe("reverseNodeOf", () => {
  it("hashes the address's reverse name in lowercase hex", () => {
    const address = "0xb5932a6B7d50A966AEC6C74C97385412Fb497540";
    expect(reverseNodeOf(address)).toBe(
      namehash("b5932a6b7d50a966aec6c74c97385412fb497540.addr.reverse"),
    );
  });
});

describe("namesSame", () => {
  it("compares a reverse record's text with a name once normalized", () => {
    expect(namesSame("SpaceID.bnb", "spaceid.bnb")).toBe(true);
    expect(namesSame("other.bnb", "spaceid.bnb")).toBe(false);
    expect(namesSame("a_b.bnb", "a_b.bnb")).toBe(false);
  });
});
