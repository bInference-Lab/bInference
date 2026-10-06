import { z } from "zod";
import { type Credential, credentialSchema } from "../auth/credential.js";
import { type Locale, localeSchema } from "../locale.js";

const clientKinds = ["runtime", "console", "mini", "cli", "tui", "mcp"] as const;

/** Which client opens the connection; `mini` is the Telegram Mini App. */
export type ClientKind = (typeof clientKinds)[number];

/** The client's side of `open`. */
export interface ClientInfo {
  readonly kind: ClientKind;
  /** The client's own release, for logs and support. */
  readonly version: string;
  readonly locale?: Locale;
}

/**
 * The first frame of every connection, client to engine, within 10 seconds. `v` names the
 * protocol version the client speaks.
 */
export interface OpenFrame {
  readonly t: "open";
  readonly v: number;
  readonly client: ClientInfo;
  readonly auth: Credential;
}

/** Parses an `open` frame. Any positive `v` parses; the engine then checks it is served. */
export const openFrameSchema: z.ZodType<OpenFrame> = z.object({
  t: z.literal("open"),
  v: z.int().positive(),
  client: z.object({
    kind: z.enum(clientKinds),
    version: z.string().min(1),
    locale: localeSchema.exactOptional(),
  }),
  auth: credentialSchema,
});
