import type { Amount } from "../amount.js";
import type { AccountRef } from "../caip/account-ref.js";
import type { ChainRef } from "../caip/chain-ref.js";
import type { ChainEvent, Delivery } from "../delivery/delivery.js";
import type { DeliveryReader } from "../delivery/ports.js";
import type { TxHash } from "../transaction.js";
import { createFakeChainGate, type FakeChainGate } from "./fake-chain-gate.js";

/** One transaction a test lands on the fake chain: whom it paid, what, and whether it is final. */
export interface FakeLanding {
  readonly recipient: AccountRef;
  readonly received: readonly Amount[];
  readonly status?: Delivery["status"];
  readonly final?: boolean;
  /** The events it emitted; none when absent, and none read from a failed one. */
  readonly events?: readonly ChainEvent[];
}

/** A fake delivery reader whose transactions and holdings a test sets. */
export interface FakeDeliveryReader extends DeliveryReader, Omit<FakeChainGate, "check"> {
  /** Lands a transaction, successful and final unless the landing says otherwise. */
  land(hash: TxHash, landing: FakeLanding): void;
  /** Sets what an account holds of an asset. */
  hold(account: AccountRef, amount: Amount): void;
}

/**
 * Creates a {@link DeliveryReader} for tests on one chain: a transaction a test landed brought its
 * recipient what it names, at block 7, with the events it names; any other is in no block. An account or an asset of another
 * chain is a fault.
 */
export function createFakeDeliveryReader(chain: ChainRef): FakeDeliveryReader {
  const gate = createFakeChainGate(chain);
  const landings = new Map<TxHash, FakeLanding>();
  const holdings = new Map<string, bigint>();
  return {
    chain,
    async balance(account, asset, { signal }) {
      gate.check(account, signal);
      return await Promise.resolve(holdings.get(`${account} ${asset}`) ?? 0n);
    },
    async delivery({ hash, recipient, asset }, { signal }) {
      gate.check(recipient, signal);
      const landing = landings.get(hash);
      if (landing === undefined) {
        return await Promise.resolve(undefined);
      }
      const status = landing.status ?? "success";
      const paid = landing.recipient === recipient && status === "success";
      const base = paid
        ? (landing.received.find((amount) => amount.asset === asset)?.base ?? 0n)
        : 0n;
      const events = status === "success" ? (landing.events ?? []) : [];
      const final = landing.final ?? true;
      return { hash, block: 7n, final, status, received: { asset, base }, events };
    },
    land: (hash, landing) => {
      landings.set(hash, landing);
    },
    hold: (account, amount) => {
      holdings.set(`${account} ${amount.asset}`, amount.base);
    },
    down: gate.down,
    up: gate.up,
  };
}
