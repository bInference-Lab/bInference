import type { Api } from "grammy";

/** The AbortSignal type grammY's methods declare: the `abort-controller` package's, not Node's. */
export type GrammySignal = NonNullable<Parameters<Api["deleteMessage"]>[2]>;

/**
 * Types Node's AbortSignal as grammY's. grammY declares its signals with an old polyfill's type,
 * and at run time needs only `addEventListener`, which Node's signal has. This is the package's
 * only cast.
 */
export function assertGrammySignal(signal: AbortSignal): GrammySignal {
  return signal as AbortSignal & GrammySignal;
}
