import { z } from "zod";

/** What the crash engine reads from its environment. */
export interface CrashEnv {
  /** The state folder. */
  readonly BINFERENCE_HOME: string;
  /** The run's name: the wallet's key is made from it, so each run trades from its own wallet. */
  readonly CRASH_WALLET: string;
  /** The origin on 127.0.0.1 where the test's relays listen, each at `/<name>`. */
  readonly CRASH_RELAYS: string;
  /** `signed`: custody holds after its first signature, before the engine stores the bytes. */
  readonly CRASH_HOLD?: "signed";
}

/** Parses the crash engine's environment; every other variable is left out. */
export const crashEnvSchema: z.ZodType<CrashEnv> = z.object({
  BINFERENCE_HOME: z.string().min(1),
  CRASH_WALLET: z.string().regex(/^[a-z0-9-]{1,40}$/),
  CRASH_RELAYS: z.url({ protocol: /^http$/, hostname: /^127\.0\.0\.1$/ }),
  CRASH_HOLD: z.literal("signed").exactOptional(),
});

/**
 * What the crash engine reports, one JSON line each on standard output: the intents recovery
 * took, each signature custody made, custody holding after one, the intent it proposed, each
 * intent once it ended, with the hashes of the transactions it stored, and a fault that stopped it.
 */
export type CrashEvent =
  | { readonly event: "recovered"; readonly intents: number }
  | { readonly event: "signed" }
  | { readonly event: "holding" }
  | { readonly event: "proposed"; readonly intent: string }
  | {
      readonly event: "settled";
      readonly intent: string;
      readonly state: string;
      readonly hashes: readonly string[];
    }
  | { readonly event: "failed"; readonly code: string; readonly message: string };

/** Parses one line the crash engine reported. */
export const crashEventSchema: z.ZodType<CrashEvent> = z.discriminatedUnion("event", [
  z.strictObject({ event: z.literal("recovered"), intents: z.int().nonnegative() }),
  z.strictObject({ event: z.literal("signed") }),
  z.strictObject({ event: z.literal("holding") }),
  z.strictObject({ event: z.literal("proposed"), intent: z.string() }),
  z.strictObject({
    event: z.literal("settled"),
    intent: z.string(),
    state: z.string(),
    hashes: z.array(z.string()),
  }),
  z.strictObject({ event: z.literal("failed"), code: z.string(), message: z.string() }),
]);
