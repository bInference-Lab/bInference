import { accountRefSchema } from "@binference/chain";
import { bsc } from "@binference/chains";
import { describe, expect, it } from "vitest";
import { ceilingAddressesOf } from "./ceiling-addresses.js";
import { selfHostedCeilingAddresses } from "./self-hosted-destinations.js";

const person = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const other = "0xeA6F82DbD6C87DE5E542eFbd1f9964879828e4e7";
const solanaWallet = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";
const on = (chain: string, address: string) => accountRefSchema.parse(`${chain}:${address}`);
const parts = selfHostedCeilingAddresses([bsc]);

describe("the addresses a ceiling lists per chain", () => {
  it("lists each account for its own chain alone, as lowercase recipient bytes", () => {
    const accounts = [on(bsc.id, person), on("eip155:8453", other), on(bsc.id, other)];
    expect(ceilingAddressesOf(accounts, parts)).toStrictEqual([
      { chainId: "56", addresses: [person.toLowerCase(), other.toLowerCase()] },
      { chainId: "8453", addresses: [other.toLowerCase()] },
    ]);
  });

  it("lists an account nowhere on a chain no rule pays on, or the registry does not know", () => {
    const solana = on("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", solanaWallet);
    expect(ceilingAddressesOf([solana, on("eip155:10", person)], parts)).toStrictEqual([]);
  });

  it("lists a Solana account's 32 bytes once a venue gives Solana an id", () => {
    const solana = on("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", solanaWallet);
    const withId = { ...parts, chainIdsOf: () => ["34268394551451"] };
    const [listed] = ceilingAddressesOf([solana], withId);
    expect(listed?.chainId).toBe("34268394551451");
    expect(listed?.addresses[0]).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
