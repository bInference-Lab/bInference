import { z } from "zod";

/** What the console's smoke engine reads from its environment. */
export interface SmokeEnv {
  /** The port the engine's HTTP listener takes, which serves the console. */
  readonly SMOKE_PORT: string;
  /** The port of the control listener the browser test drives the engine through. */
  readonly SMOKE_CONTROL_PORT: string;
  /** The console's build folder. */
  readonly SMOKE_CONSOLE: string;
}

const port = z.string().regex(/^[1-9]\d{0,4}$/);

/** What the browser test asks the control listener's `/alert` to send: a rule's URL and a body. */
export interface SmokeAlertRequest {
  readonly url: string;
  readonly body: string;
}

/** Parses the body of an `/alert` request. */
export const smokeAlertSchema: z.ZodType<SmokeAlertRequest> = z.object({
  url: z.url(),
  body: z.string().max(16_384),
});

/** Parses the smoke engine's environment; every other variable is left out. */
export const smokeEnvSchema: z.ZodType<SmokeEnv> = z.object({
  SMOKE_PORT: port,
  SMOKE_CONTROL_PORT: port,
  SMOKE_CONSOLE: z.string().min(1),
});
