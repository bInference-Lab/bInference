import type { ChainRegistry } from "@binference/chain";
import { ok, type Result } from "@binference/core";
import type { SignerRefusalNotice } from "@binference/signer";
import type { UnlockedKeys, LockReason } from "../unlock/unlock-keys.js";
import { createCustodyCell, type CustodyCell } from "./custody-cell.js";
import { openCustody } from "./open-custody.js";
import type { Opened, Opening } from "./open-engine-parts.js";
import { startBuiltSigner } from "./start-signer.js";

/** Custody as the lock opens it. */
export interface ComposedCustody {
  readonly cell: CustodyCell;
  /** The lock's step: opens custody with the keys, or answers why the engine stays locked. */
  readonly open: (keys: UnlockedKeys, signal: AbortSignal) => Promise<Result<void, LockReason>>;
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
    readonly onStopped: () => void;
    readonly onRefusal: (notice: SignerRefusalNotice) => void;
  },
): ComposedCustody {
  const { host, closers } = opening;
  const { chains, onStopped, onRefusal } = parts;
  const cell = createCustodyCell();
  closers.add("signer", async (signal) => cell.release()?.stop(signal));
  const options = {
    http: host.http,
    clock: host.clock,
    env: host.env,
    startSigner: host.startSigner ?? startBuiltSigner,
    onRefusal,
    config: opened.config,
    install: opened.stores.install,
    chains,
    logger: opened.log.logger,
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
