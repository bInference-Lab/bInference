import { z } from "zod";
import { pathSchema } from "./value-formats.schema.js";

/** The agent's browser (decision 0401). */
export interface BrowserConfig {
  readonly enabled: boolean;
  /** Without a window; unset, headless only on a machine without a desktop. */
  readonly headless?: boolean;
  /** The Chrome-family browser's program; the one found on this machine when unset. */
  readonly executablePath?: string;
  readonly evaluate: boolean;
  readonly allowPrivateNetwork: boolean;
}

/** Parses `browser`. */
export const browserSchema: z.ZodType<BrowserConfig> = z
  .strictObject({
    enabled: z
      .boolean()
      .prefault(true)
      .describe(
        "Lets the agent drive a browser of its own on this machine, with its own profile in " +
          "binference's folder.",
      ),
    headless: z
      .boolean()
      .exactOptional()
      .describe(
        "true runs the agent's browser without a window; unset, it shows a window where this " +
          "machine has a desktop.",
      ),
    executablePath: pathSchema
      .exactOptional()
      .describe(
        "The program of the Chrome-family browser the agent drives; unset, Google Chrome, " +
          "Microsoft Edge, Brave or Chromium as found on this machine.",
      ),
    evaluate: z
      .boolean()
      .prefault(true)
      .describe("Lets the agent run scripts in the pages its browser opens."),
    allowPrivateNetwork: z
      .boolean()
      .prefault(false)
      .describe(
        "Lets the agent's browser open addresses on this machine and private networks; " +
          "binference's own engine, console and folder stay refused.",
      ),
  })
  .prefault({})
  .describe("The agent's browser.");
