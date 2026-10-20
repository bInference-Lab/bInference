import { z } from "zod";

/** What the crash engine reads from its environment besides the config's own variables. */
export interface CrashEnv {
  /** The state folder `binference init` set up. */
  readonly BINFERENCE_HOME: string;
  /** The origin on 127.0.0.1 where the test's relays listen, each at `/<name>`. */
  readonly CRASH_RELAYS: string;
  /** The origin on 127.0.0.1 where the test serves Privy and KyberSwap's API. */
  readonly CRASH_SERVICES: string;
  /** The port the engine's HTTP listener takes. */
  readonly CRASH_PORT: string;
  /** `1` when the run's prices fire live auto orders, which then fill live. */
  readonly CRASH_FILLS?: "1";
  /** `1` when the run's agent runtime answers the owner's chat on a scripted model. */
  readonly CRASH_CHAT?: "1";
}

const loopback = z.url({ protocol: /^http$/, hostname: /^127\.0\.0\.1$/ });

/** Parses the crash engine's environment; every other variable is left out. */
export const crashEnvSchema: z.ZodType<CrashEnv> = z.object({
  BINFERENCE_HOME: z.string().min(1),
  CRASH_RELAYS: loopback,
  CRASH_SERVICES: loopback,
  CRASH_PORT: z.string().regex(/^[1-9]\d{0,4}$/),
  CRASH_FILLS: z.literal("1").exactOptional(),
  CRASH_CHAT: z.literal("1").exactOptional(),
});
