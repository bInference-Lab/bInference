import type { RelaySender, SignedTx } from "@binference/chain";
import { BinferenceError, type Clock, type Http } from "@binference/core";
import { type Hex, keccak256 } from "viem";
import type { EvmChain } from "../evm-chain.js";
import type { RpcEndpoint } from "../rpc/rpc-call.js";
import { isHexPayload } from "../signing/evm-transaction.js";
import { askRelay } from "./ask-relay.js";

/** What the EVM relay sender sends through: one chain's private relays. */
export interface EvmRelaySenderOptions {
  readonly chain: EvmChain;
  /** The relays, each with a name of its own; a URL may carry a key, so answers name it only. */
  readonly relays: readonly RpcEndpoint[];
  readonly http: Http;
  readonly clock: Clock;
  /** How long one relay may take to answer before its answer is `timed_out`. */
  readonly timeoutMs: number;
}

function rawOf(chain: EvmChain, signed: SignedTx): Hex {
  if (signed.chain !== chain.ref) {
    throw new BinferenceError({
      code: "chain.unknown_chain",
      message: `This relay sender sends on ${chain.name} only.`,
      details: { chain: signed.chain },
    });
  }
  if (!isHexPayload(signed.raw)) {
    throw new BinferenceError({
      code: "chain.bad_transaction",
      message: "Signed EVM bytes are 0x and whole bytes in hex.",
    });
  }
  return signed.raw;
}

/**
 * Creates the `RelaySender` of one EVM chain: `eth_sendRawTransaction` to every relay at once,
 * each request with its own timeout, so a relay that hangs never delays another. A relay's answer
 * counts as accepted only when it names the keccak-256 hash of the bytes sent, or says it holds
 * them already. Nothing is retried. A chain with no relay, or two relays with one name, is a fault.
 */
export function createEvmRelaySender(options: EvmRelaySenderOptions): RelaySender {
  const names = options.relays.map((relay) => relay.name);
  if (names.length === 0 || new Set(names).size !== names.length) {
    throw new BinferenceError({
      code: "chain.bad_relays",
      message: "A relay sender needs at least one relay, each with a name of its own.",
      details: { relays: names.length },
    });
  }
  return {
    relays: names,
    async send(signed, { signal }) {
      signal.throwIfAborted();
      const raw = rawOf(options.chain, signed);
      const hash = keccak256(raw);
      return Promise.all(
        options.relays.map(async (relay) => askRelay({ relay, raw, hash, signal }, options)),
      );
    },
  };
}
