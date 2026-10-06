import { createHash } from "node:crypto";
import { chainDefinitionSchema } from "@binference/chain";
import { describe, expect, it } from "vitest";
import { bsc, bscPriceFeeds } from "./bsc.js";

// EIP-55: a hex letter is upper case where the same nibble of the Keccak-256 hash of the lower
// case address is 8 or more. Node's own Keccak-256 keeps viem out of this package.
function toChecksumAddress(address: string): string {
  const hex = address.slice(2).toLowerCase();
  const hash = createHash("keccak-256").update(hex).digest("hex");
  const letters = hex
    .split("")
    .map((char, index) => ("89abcdef".includes(hash.charAt(index)) ? char.toUpperCase() : char));
  return `0x${letters.join("")}`;
}

const hexAddress = /^0x[0-9a-fA-F]{40}$/;

function isChecksummed(address: string): boolean {
  return hexAddress.test(address) && toChecksumAddress(address) === address;
}

const entries = [
  ...bsc.tokens.map((token) => ({ label: `token ${token.symbol}`, ...token })),
  ...bsc.contracts.map((contract) => ({
    label: `${contract.venue}/${contract.name}`,
    ...contract,
  })),
];

describe("the EIP-55 check", () => {
  // The test vectors from EIP-55 itself.
  it.each([
    "0x52908400098527886E0F7030069857D2E4169EE7",
    "0x8617E340B3D01FA5F11F306F4090FD50E238070D",
    "0xde709f2102306220921060314715629080e2fb77",
    "0x27b1fdb04752bbc536007a920d24acb045561c26",
    "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
    "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
    "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB",
    "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb",
  ])("accepts the EIP-55 vector %s", (address) => {
    expect(isChecksummed(address)).toBe(true);
  });

  it.each([
    ["all lower case", "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed"],
    ["all upper case", "0x5AAEB6053F3E94C9B9A09F33669435E7EF1BEAED"],
    ["one letter flipped", "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD"],
    ["a short address", "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeA"],
    ["no 0x prefix", "5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"],
  ])("refuses an address with %s", (_case, address) => {
    expect(isChecksummed(address)).toBe(false);
  });
});

describe("bsc", () => {
  it("passes the chain definition schema", () => {
    expect(chainDefinitionSchema.parse(bsc)).toStrictEqual(bsc);
  });

  it.each(entries)("spells $label in its EIP-55 checksum form", ({ address }) => {
    expect(address).toMatch(hexAddress);
    expect(address).toBe(toChecksumAddress(address));
  });

  it.each(entries)(
    "carries a dated, sourced verification record for $label",
    ({ verification }) => {
      expect(verification.source).toMatch(/^https:\/\/\S+$/);
      expect(verification.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(["read", "not_read"]).toContain(verification.control);
    },
  );

  it("keeps each address once across tokens and contracts", () => {
    const addresses = entries.map((entry) => entry.address.toLowerCase());
    expect(new Set(addresses).size).toBe(addresses.length);
  });

  it("gives stablecoins their 18 decimals on this chain", () => {
    const decimals = bsc.tokens
      .filter((token) => ["USDT", "USDC", "FDUSD"].includes(token.symbol))
      .map((token) => token.decimals);
    expect(decimals).toStrictEqual([18, 18, 18]);
  });

  it("keeps PancakeSwap's Permit2 apart from the one Across uses", () => {
    const permits = bsc.contracts.filter((contract) => contract.name === "permit2");
    expect(permits.map(({ venue, address }) => [venue, address])).toStrictEqual([
      ["pancakeswap", "0x31c2F6fcFf4F8759b3Bd5Bf0e1084A055615c768"],
      ["across", "0x000000000022D473030F116dDEE9F6B43aC78BA3"],
    ]);
  });
});

describe("bsc price feeds", () => {
  const feedContracts = bsc.contracts
    .filter((contract) => contract.venue === "chainlink")
    .map((contract) => contract.name);

  it("names one feed for each chainlink contract and nothing else", () => {
    expect(bscPriceFeeds.map((feed) => feed.contract).toSorted()).toStrictEqual(
      feedContracts.toSorted(),
    );
  });

  it.each(bscPriceFeeds)("reads $contract as an 8-decimal feed with a heartbeat", (feed) => {
    expect(feed.decimals).toBe(8);
    expect(feed.heartbeatSeconds).toBeGreaterThan(0);
  });
});
