import { BinferenceError } from "@binference/core";
import { type AccountRef, accountRefParts } from "../caip/account-ref.js";
import type { ChainRef } from "../caip/chain-ref.js";
import type { NameResolution, ReverseRecord } from "../names/name-resolution.js";
import type { NameResolver } from "../names/ports.js";

/** What a fake name's record holds. */
export interface FakeNameRecord {
  readonly address: AccountRef;
  /** The address holds code other than a delegation. */
  readonly isContract?: boolean;
  /** The address is a smart-account wallet: its only code is a delegation. */
  readonly isSmartAccount?: boolean;
  /** What the address's reverse record names, `unread` for none read; `matches` when absent. */
  readonly reverse?: ReverseRecord | "unread";
}

/** A fake resolver whose records a test changes, and whose chain can stop answering. */
export interface FakeNameResolver extends NameResolver {
  /** Points the name, normalized, to the record, or removes it with `undefined`. */
  set(name: string, record: FakeNameRecord | undefined): void;
  /** Every later read rejects as a chain that does not answer, until `up` is called. */
  down(): void;
  /** Reads answer again after `down`. */
  up(): void;
  /** How many reads reached the resolver, the refused ones too. */
  reads(): number;
}

// Labels of lowercase letters, digits and inner hyphens, as the fake normalizes them.
const label = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

function normalized(text: string, suffix: string): string | undefined {
  const name = text.toLowerCase();
  const labels = name.slice(0, -suffix.length).split(".");
  return name.endsWith(suffix) && labels.every((part) => label.test(part)) ? name : undefined;
}

function answerOf(name: string, record: FakeNameRecord | undefined): NameResolution {
  if (record === undefined) {
    return { kind: "not_found", name };
  }
  const { address, reverse = { kind: "matches" } } = record;
  if (record.isContract === true) {
    return { kind: "contract", name, address };
  }
  const found = {
    kind: "found",
    name,
    address,
    ...(record.isSmartAccount === true ? { smartAccount: true as const } : {}),
  } as const;
  return reverse === "unread" ? found : { ...found, reverse };
}

/**
 * Creates a name resolver for tests over the records a test sets: a name normalizes to lowercase
 * labels of letters, digits and inner hyphens, every read sees the records as they are then, and a
 * resolver that is down rejects as a chain that does not answer.
 */
export function createFakeNameResolver(options: {
  readonly chain: ChainRef;
  readonly suffix: string;
}): FakeNameResolver {
  const records = new Map<string, FakeNameRecord>();
  const state = { isDown: false, reads: 0 };
  return {
    chain: options.chain,
    suffix: options.suffix,
    async resolve(text, { signal }) {
      signal.throwIfAborted();
      state.reads += 1;
      if (state.isDown) {
        throw new BinferenceError({
          code: "chain.rpc_down",
          message: "The fake chain does not answer.",
          retryable: true,
        });
      }
      const name = normalized(text, options.suffix);
      return await Promise.resolve(
        name === undefined ? { kind: "malformed" } : answerOf(name, records.get(name)),
      );
    },
    set(name, record) {
      if (record !== undefined && accountRefParts(record.address).chain !== options.chain) {
        throw new Error("A fake name points to an account of its resolver's chain.");
      }
      if (record === undefined) {
        records.delete(name);
      } else {
        records.set(name, record);
      }
    },
    down() {
      state.isDown = true;
    },
    up() {
      state.isDown = false;
    },
    reads: () => state.reads,
  };
}
