import type { Signer } from "@binference/chain";
import { BinferenceError, err } from "@binference/core";
import type { CeilingEditor, WalletExporter, WalletMaker } from "@binference/engine/install";
import type { OpenedCustody } from "./open-custody.js";

/**
 * The custody the engine and the executor sign through: the custody the unlock opened, or none
 * while the engine is locked. With none it signs nothing (`refused`), knows no wallet, and every
 * ceiling change, new wallet and export fails with `wallet.custody_down`, so a locked engine fails
 * closed.
 */
export interface CustodyCell {
  readonly signer: Signer;
  readonly ceilings: CeilingEditor;
  readonly walletMaker: WalletMaker;
  readonly exporter: WalletExporter;
  /** Whether custody is open now, for the `custody` health signal. */
  isOpen(): boolean;
  /** Puts the custody the unlock opened in place. */
  hold(opened: OpenedCustody): void;
  /** Takes the custody out and answers it, so its stop is the caller's and no surprise. */
  release(): OpenedCustody | undefined;
  /** Whether `opened` is the custody in place. */
  holds(opened: OpenedCustody): boolean;
}

function custodyDown(): BinferenceError {
  return new BinferenceError({
    code: "wallet.custody_down",
    message: "binference is locked, so custody signs nothing; run binference unlock.",
  });
}

async function refuseLocked(options: { readonly signal: AbortSignal }): Promise<never> {
  options.signal.throwIfAborted();
  return Promise.reject(custodyDown());
}

/** Where the custody the unlock opened is held, or none while the engine is locked. */
interface Held {
  held: OpenedCustody | undefined;
}

// The ceilings of the custody held, refused while none is.
function ceilingsIn(cell: Held): CeilingEditor {
  return {
    read: async (ceiling, options) =>
      cell.held === undefined ? refuseLocked(options) : cell.held.ceilings.read(ceiling, options),
    setRecipients: async (request, options) =>
      cell.held === undefined
        ? refuseLocked(options)
        : cell.held.ceilings.setRecipients(request, options),
    signRecipients: async (request, options) =>
      cell.held === undefined
        ? refuseLocked(options)
        : cell.held.ceilings.signRecipients(request, options),
    sendSigned: async (change, options) =>
      cell.held === undefined
        ? refuseLocked(options)
        : cell.held.ceilings.sendSigned(change, options),
    setCalls: async (request, options) =>
      cell.held === undefined
        ? refuseLocked(options)
        : cell.held.ceilings.setCalls(request, options),
  };
}

/** Creates an empty {@link CustodyCell}: the engine starts locked. */
export function createCustodyCell(): CustodyCell {
  const cell: Held = { held: undefined };
  return {
    signer: {
      async account(wallet, chain, options) {
        options.signal.throwIfAborted();
        return cell.held === undefined
          ? err("unknown_wallet")
          : cell.held.signer.account(wallet, chain, options);
      },
      async signTransaction(request, options) {
        options.signal.throwIfAborted();
        return cell.held === undefined
          ? err("refused")
          : cell.held.signer.signTransaction(request, options);
      },
    },
    ceilings: ceilingsIn(cell),
    walletMaker: {
      make: async (request, options) =>
        cell.held === undefined
          ? refuseLocked(options)
          : cell.held.walletMaker.make(request, options),
    },
    exporter: {
      exportSealed: async (request, options) =>
        cell.held === undefined
          ? refuseLocked(options)
          : cell.held.exporter.exportSealed(request, options),
    },
    isOpen: () => cell.held !== undefined,
    hold: (opened) => {
      cell.held = opened;
    },
    release: () => {
      const { held } = cell;
      cell.held = undefined;
      return held;
    },
    holds: (opened) => cell.held === opened,
  };
}
