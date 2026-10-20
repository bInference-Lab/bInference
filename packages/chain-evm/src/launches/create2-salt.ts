import { createHash } from "node:crypto";
import { setImmediate as nextTurn } from "node:timers/promises";
import type { Random } from "@binference/core";
import { type Address, bytesToHex, getAddress, type Hex, hexToBytes, keccak256 } from "viem";

/**
 * What a search for a CREATE2 salt hashes: the deployer, the hash of the contract's creation code
 * with its arguments, the last two bytes the address must end in, and, for a deployer that hashes
 * the caller's salt behind 32 bytes of its own, such as the caller's address, those bytes.
 */
export interface Create2Search {
  readonly deployer: Address;
  readonly initCodeHash: Hex;
  readonly suffix: readonly [number, number];
  /**
   * The deployer's CREATE2 salt is `keccak256(saltPrefix . salt)`, as Solidity's
   * `keccak256(abi.encode(account, salt))` is for a 32-byte prefix; the salt itself when absent.
   */
  readonly saltPrefix?: Readonly<Uint8Array>;
}

/** A salt the search found, and the address it gives. */
export interface FoundCreate2Salt {
  readonly salt: Hex;
  readonly address: Address;
}

// One try in 65,536 ends in a two-byte suffix, so 2^21 tries miss one with a chance of about 1 in
// 10^14. Node's own Keccak-256 runs about 2 million tries a second; the search hands the event
// loop back, and reads its signal, every 65,536 tries.
const mostTries = 2_097_152;
const triesPerTurn = 65_536;

// Node's Keccak-256 when its OpenSSL has it (3.2 and later), else viem's, which is slower.
function keccakOf(): (input: Uint8Array) => Uint8Array {
  try {
    createHash("keccak-256");
    return (input) => createHash("keccak-256").update(input).digest();
  } catch {
    return (input) => keccak256(input, "bytes");
  }
}

const keccak = keccakOf();

// Counts the salt's last 8 bytes up by one, in place.
function countUp(salt: Uint8Array): void {
  for (let at = salt.length - 1; at >= salt.length - 8; at -= 1) {
    const next = ((salt[at] ?? 0) + 1) & 0xff;
    salt.set([next], at);
    if (next !== 0) {
      return;
    }
  }
}

/** The search's buffers: the salt it counts up, and the CREATE2 input it hashes. */
interface Buffers {
  readonly salt: Uint8Array;
  /** `prefix . salt`, for a deployer that hashes the salt behind a prefix. */
  readonly salted?: Uint8Array;
  /** `0xff . deployer . create2Salt . initCodeHash`, whose hash's last 20 bytes are the address. */
  readonly input: Uint8Array;
}

function buffersOf(create2: Create2Search, start: Uint8Array): Buffers {
  const input = new Uint8Array(85);
  input.set([0xff], 0);
  input.set(hexToBytes(create2.deployer), 1);
  input.set(hexToBytes(create2.initCodeHash), 53);
  const { saltPrefix } = create2;
  if (saltPrefix === undefined) {
    input.set(start, 21);
    return { salt: input.subarray(21, 53), input };
  }
  const salted = new Uint8Array(saltPrefix.length + 32);
  salted.set(saltPrefix, 0);
  salted.set(start, saltPrefix.length);
  return { salt: salted.subarray(saltPrefix.length), salted, input };
}

// One turn of the search: up to its tries from where the salt stands; the salt it found, if any.
function searchTurn(create2: Create2Search, buffers: Buffers): FoundCreate2Salt | undefined {
  const [high, low] = create2.suffix;
  for (let tries = 0; tries < triesPerTurn; tries += 1) {
    if (buffers.salted !== undefined) {
      buffers.input.set(keccak(buffers.salted), 21);
    }
    const hash = keccak(buffers.input);
    if (hash[30] === high && hash[31] === low) {
      const address = getAddress(bytesToHex(hash.subarray(12)));
      return { salt: bytesToHex(buffers.salt), address };
    }
    countUp(buffers.salt);
  }
  return undefined;
}

async function searchTurns(
  parts: { readonly create2: Create2Search; readonly buffers: Buffers },
  turnsLeft: number,
  signal: AbortSignal,
): Promise<FoundCreate2Salt | undefined> {
  signal.throwIfAborted();
  const found = searchTurn(parts.create2, parts.buffers);
  if (found !== undefined || turnsLeft <= 1) {
    return found;
  }
  await nextTurn();
  return searchTurns(parts, turnsLeft - 1, signal);
}

/**
 * Finds, off line, a salt whose CREATE2 address ends in the search's two bytes: it counts up from
 * 32 random bytes and hashes each candidate as the deployer does, handing the event loop back
 * between turns. `undefined` once 2^21 tries found none, which does not happen in practice; an
 * aborted signal rejects with its reason at the next turn.
 */
export async function findCreate2Salt(
  create2: Create2Search,
  options: { readonly random: Random; readonly signal: AbortSignal },
): Promise<FoundCreate2Salt | undefined> {
  const buffers = buffersOf(create2, options.random.bytes(32));
  return searchTurns({ create2, buffers }, mostTries / triesPerTurn, options.signal);
}
