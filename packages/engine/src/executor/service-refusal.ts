import type { DaySumsRefusal, SignerLock } from "@binference/chain";
import type { Err, Id } from "@binference/core";
import type { ServiceRefusalReason } from "../intents/intent-reason.js";
import type { EnginePush } from "../pushes/engine-push.js";
import { noticePush } from "../pushes/notice-push.js";

/**
 * A signer service's refusal of a step (decision 0427): the user's 24-hour sum it would pass, or
 * why the service signs nothing. Neither changes when asked again, so the executor never asks.
 */
export type ServiceRefusal =
  | (Err<"over_sums"> & { readonly sums: DaySumsRefusal })
  | (Err<"locked"> & { readonly lock: SignerLock });

// The message key of the notice that a step would pass the user's 24-hour sums.
const daySumsNoticeKey = "notice.daySums";

/** The reason an intent stores once a signer service refused its step. */
export function serviceRefusalReason(refusal: ServiceRefusal): ServiceRefusalReason {
  return refusal.error === "over_sums" ? "day_sums" : "signer_locked";
}

/**
 * The notice that a step was not sent because it would pass the user's 24-hour sums: the cap and
 * what is used, as amounts of the sum's asset, the chain's name, and when room frees.
 */
export function daySumsNotice(refused: {
  readonly agent: Id<"agt">;
  readonly intent: Id<"int">;
  readonly chainName: string;
  readonly sums: DaySumsRefusal;
}): EnginePush {
  const { sums } = refused;
  return noticePush({
    key: daySumsNoticeKey,
    agent: refused.agent,
    intent: refused.intent,
    values: { chain: refused.chainName },
    amounts: {
      cap: { asset: sums.asset, base: sums.capBase },
      used: { asset: sums.asset, base: sums.usedBase },
    },
    times: { room: sums.roomAtMs },
  });
}
