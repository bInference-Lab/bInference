import type { KeyObject } from "node:crypto";
import { BinferenceError } from "@binference/core";
import type { InstallStore } from "@binference/engine/install";
import { deriveSealingKey } from "../hpke/sealing-key.js";
import type { Opened } from "./open-engine-parts.js";

/** Keeps the sealing key once, and says whether the install holds one. */
export interface SealKeyKeeper {
  /** The owner key hook: derives and keeps the sealing key when the install holds none yet. */
  readonly onOwnerKey: (ownerKey: KeyObject, signal: AbortSignal) => Promise<void>;
  /** Whether backups are sealed to the sealing key now, as last read; true until read. */
  readonly isSealed: () => boolean;
  /** Reads again whether the install holds the sealing key. */
  readonly refresh: (signal: AbortSignal) => Promise<void>;
}

/**
 * Moves an install made before the sealing key to it the next time the owner key is entered
 * (keys spec, section 7.2): the first owner key request that passes derives the key from it and
 * keeps its public half, which every later backup is sealed to.
 */
export function createSealKeyKeeper(
  install: Pick<InstallStore, "read" | "setSealKey">,
): SealKeyKeeper {
  const held = { isSealed: true };
  const refresh = async (signal: AbortSignal): Promise<void> => {
    const { custody } = await install.read({ signal });
    held.isSealed = custody === undefined || custody.sealKeyPublic !== undefined;
  };
  return {
    onOwnerKey: async (ownerKey, signal) => {
      const { custody } = await install.read({ signal });
      if (custody === undefined || custody.sealKeyPublic !== undefined) {
        return;
      }
      const sealing = deriveSealingKey(ownerKey);
      await install.setSealKey({ sealKeyPublic: sealing.publicKey }, { signal });
      held.isSealed = true;
    },
    isSealed: () => held.isSealed,
    refresh,
  };
}

/**
 * The keeper of the opened engine's install, which reads once at start whether the install holds
 * the sealing key; a failed read only logs, and the next owner key entered reads it again.
 */
export function sealKeyOf(opened: Pick<Opened, "stores" | "log">): SealKeyKeeper {
  const keeper = createSealKeyKeeper(opened.stores.install);
  void (async () => {
    try {
      await keeper.refresh(new AbortController().signal);
    } catch (error) {
      const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
      opened.log.logger.warn("backup.seal_key_unread", { errorCode });
    }
  })();
  return keeper;
}
