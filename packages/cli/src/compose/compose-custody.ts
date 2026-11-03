import type { ChainRef, ChainRegistry, VenueDeclaration } from "@binference/chain";
import { type JsonValue, ok, type Result } from "@binference/core";
import type { CeilingRead } from "@binference/engine/install";
import type { SignerRefusalNotice } from "@binference/signer";
import { capAssetsOn } from "../init/ceiling-request.js";
import type { UnlockedKeys, LockReason } from "../unlock/unlock-keys.js";
import { createCustodyCell, type CustodyCell } from "./custody-cell.js";
import { openCustody } from "./open-custody.js";
import type { Opened, Opening } from "./open-engine-parts.js";
import { readStoredPrivyCeiling } from "./privy-ceiling-read.js";
import type { SealKeyKeeper } from "./seal-key-keeper.js";
import { selfHostedCeilingAddresses } from "./self-hosted-destinations.js";
import { startBuiltSigner } from "./start-signer.js";

/** Custody as the lock opens it. */
export interface ComposedCustody {
  readonly cell: CustodyCell;
  /** The lock's step: opens custody with the keys, or answers why the engine stays locked. */
  readonly open: (keys: UnlockedKeys, signal: AbortSignal) => Promise<Result<void, LockReason>>;
}

// How a wallet's stored copy of its Privy policy reads while the engine is locked, as the ceiling
// editor reads one once custody opens.
function storedReaderOf(chains: ChainRegistry): (policy: JsonValue) => CeilingRead | undefined {
  const parts = {
    capAssetsOn: (chain: ChainRef) => capAssetsOn(chains, chain),
    addresses: selfHostedCeilingAddresses(chains.list().map((item) => item.definition)),
  };
  return (policy) => readStoredPrivyCeiling(policy, parts);
}

/**
 * Builds the self-hosted engine's custody: empty while the engine is locked, then the
 * `privy-owner` adapter over the signer that the unlock starts (decision 0117). A signer that
 * stops by itself while it is in place leaves custody empty again and calls `onStopped`; each
 * step it refuses reaches `onRefusal`. The
 * shutdown stops the signer once the executor has finished what it signs.
 */
export function composeCustody(
  opening: Opening,
  opened: Opened,
  parts: {
    readonly chains: ChainRegistry;
    /** The venues every ceiling custody writes is planned from (`selfHostedCeilingVenues`). */
    readonly venues: readonly VenueDeclaration[];
    readonly onStopped: () => void;
    readonly onRefusal: (notice: SignerRefusalNotice) => void;
    readonly sealKey: SealKeyKeeper;
  },
): ComposedCustody {
  const { host, closers } = opening;
  const { chains, onStopped, onRefusal } = parts;
  const cell = createCustodyCell(storedReaderOf(chains));
  closers.add("signer", async (signal) => cell.release()?.stop(signal));
  const options = {
    http: host.http,
    clock: host.clock,
    env: host.env,
    startSigner: host.startSigner ?? startBuiltSigner,
    onRefusal,
    config: opened.config,
    venues: parts.venues,
    install: opened.stores.install,
    chains,
    logger: opened.log.logger,
    onOwnerKey: parts.sealKey.onOwnerKey,
  };
  return {
    cell,
    open: async (keys, signal) => {
      const custody = await openCustody(keys, options, signal);
      if (!custody.ok) {
        return custody;
      }
      const held = custody.value;
      cell.hold(held);
      void (async () => {
        await held.stopped;
        if (cell.holds(held)) {
          cell.release();
          onStopped();
        }
      })();
      return ok(undefined);
    },
  };
}
