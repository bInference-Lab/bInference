import { createSeededRandom } from "@binference/core/testing";
import { concat, getAddress, getContractAddress, hexToBytes, keccak256, pad } from "viem";
import { describe, expect, it } from "vitest";
import { findCreate2Salt } from "./create2-salt.js";

const deployer = getAddress("0xeEa6C3bfb29Fd9a35380438956bae7B109c63d85");
const initCodeHash = keccak256("0x60c0604052");
const creator = getAddress("0x3cb2460Fb3b1b87743287C3d39f1F8f381C29705");
const signal = new AbortController().signal;

// The salt found, or a failed test.
async function foundOf(search: Parameters<typeof findCreate2Salt>[0], seed: number) {
  const found = await findCreate2Salt(search, { random: createSeededRandom(seed), signal });
  if (found === undefined) {
    throw new Error("No salt was found.");
  }
  return found;
}

describe("a CREATE2 salt for an address suffix", () => {
  it("gives an address that ends in the suffix, as CREATE2 makes it from the salt", async () => {
    const search = { deployer, initCodeHash, suffix: [0x77, 0x77] as const };
    const found = await foundOf(search, 271);
    const expected = getContractAddress({
      opcode: "CREATE2",
      from: deployer,
      salt: found.salt,
      bytecodeHash: initCodeHash,
    });
    expect(found.address).toBe(expected);
    expect(expected.toLowerCase().endsWith("7777")).toBe(true);
  });

  it("hashes the salt behind its prefix for a deployer that does", async () => {
    const saltPrefix = hexToBytes(pad(creator));
    const search = { deployer, initCodeHash, suffix: [0x66, 0x66] as const, saltPrefix };
    const found = await foundOf(search, 272);
    const salt = keccak256(concat([pad(creator), found.salt]));
    const expected = getContractAddress({
      opcode: "CREATE2",
      from: deployer,
      salt,
      bytecodeHash: initCodeHash,
    });
    expect(found.address).toBe(expected);
    expect(expected.toLowerCase().endsWith("6666")).toBe(true);
  });

  it("stops when its signal aborts", async () => {
    const reason = new Error("stopped");
    const search = { deployer, initCodeHash, suffix: [0x66, 0x66] as const };
    await expect(
      findCreate2Salt(search, { random: createSeededRandom(1), signal: AbortSignal.abort(reason) }),
    ).rejects.toBe(reason);
  });
});
