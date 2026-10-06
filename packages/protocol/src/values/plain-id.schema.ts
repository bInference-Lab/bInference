import { z } from "zod";

/**
 * Parses the id of a thing the protocol names without a type prefix: an upload, a note, a skill, a
 * signer or a check. One to 128 letters, digits and `._:-`, starting with a letter or a digit.
 */
export const plainIdSchema: z.ZodType<string, string> = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);

/**
 * Parses a venue's id, such as the id of a router, a lending market or a launchpad. Venues are
 * plugins, so the engine checks the id against its registry, never this package.
 */
export const venueIdSchema: z.ZodType<string, string> = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);
