import { err, ok, type Result, type Secret } from "@binference/core";
import { sha256Hex } from "@binference/engine";

/** One bot token's polling right in this process, held until released. */
export interface PollerLease {
  /** Gives the token back; a second call does nothing. */
  release(): void;
}

/** One poller per bot token: Telegram refuses a second `getUpdates` caller on the same token. */
export interface PollerLeases {
  /** Takes the lease for a token; `held` while another poller has it, `full` past the bound. */
  acquire(token: Secret): Result<PollerLease, "held" | "full">;
}

// An engine runs a bot or two; the bound refuses a runaway caller.
const maxLeases = 16;

/**
 * Creates the process's poller leases; the composition root makes one and gives it to every
 * poller. Tokens are held by their SHA-256, never as text.
 */
export function createPollerLeases(): PollerLeases {
  const held = new Set<string>();
  return {
    acquire: (token) => {
      const key = sha256Hex(token.reveal());
      if (held.has(key)) {
        return err("held");
      }
      if (held.size >= maxLeases) {
        return err("full");
      }
      held.add(key);
      let isHeld = true;
      return ok({
        release: () => {
          if (isHeld) {
            isHeld = false;
            held.delete(key);
          }
        },
      });
    },
  };
}
