import { z } from "zod";
import { epochMsSchema } from "../values/epoch-ms.schema.js";

/**
 * A single-use link: `GET /file/:ticket` for a download, valid 5 minutes, or `POST /upload/:ticket`
 * for an upload, valid 2 minutes.
 */
export interface FileTicket {
  readonly url: string;
  readonly expiresAt: number;
}

/** Parses a file ticket. */
export const fileTicketSchema: z.ZodType<FileTicket> = z.object({
  url: z.string().min(1),
  expiresAt: epochMsSchema,
});
