import type { AuthorizeInput } from "@binference/chain";

/** How long after a fill grant expired its count stays taken: a cancel's grace. */
const graceMs = 60_000;

/** One order count the signer has signed a fill for, and until when it stays that fill's. */
interface TakenCount {
  readonly intent: string;
  readonly untilMs: number;
}

/**
 * The signer's own memory of the fills it signed (decision 0211): each order's count, the fills
 * the order had when the fill was proposed, belongs to the first fill intent it signs a step of,
 * for its grant's life and a cancel's grace, so a second fill under one count signs nothing,
 * whatever the engine sends. It lives as long as the signer process.
 */
export interface FillSingleUse {
  /**
   * Whether the request may sign as far as single use goes, and, when it may, takes its order's
   * count for its intent. Any request but an order fill's always may.
   */
  admit(input: AuthorizeInput, nowMs: number): boolean;
}

/** Creates an empty {@link FillSingleUse}. */
export function createFillSingleUse(): FillSingleUse {
  const taken = new Map<string, TakenCount>();
  return {
    admit(input, nowMs) {
      const { authorization } = input;
      if (authorization.kind !== "order") {
        return true;
      }
      for (const [key, count] of taken) {
        if (count.untilMs <= nowMs) {
          taken.delete(key);
        }
      }
      const { grant } = authorization;
      const key = `${grant.order}:${String(grant.fillsBefore)}`;
      const held = taken.get(key);
      if (held !== undefined && held.intent !== input.intent) {
        return false;
      }
      taken.set(key, { intent: input.intent, untilMs: grant.expiresAtMs + graceMs });
      return true;
    },
  };
}
