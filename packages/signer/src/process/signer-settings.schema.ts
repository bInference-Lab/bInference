import { type ChainRef, chainRefSchema } from "@binference/chain";
import { z } from "zod";

/**
 * What the engine tells the signer at start, on the first line of its input, before the agent
 * key. Nothing in it is secret.
 */
export interface SignerSettings {
  /** The chains the owner enabled; the signer signs for no other. */
  readonly chains: readonly ChainRef[];
  /** The origin of Privy's API, such as `https://api.privy.io`; every request URL starts with it. */
  readonly privyApi: string;
}

/** A {@link SignerSettings} as JSON carries it. */
export interface SignerSettingsWire {
  readonly chains: readonly string[];
  readonly privyApi: string;
}

const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);

// An origin and nothing more. Plain http is for a Privy stand-in on this machine only.
function isApiOrigin(text: string): boolean {
  const url = URL.parse(text);
  if (url === null || url.origin !== text) {
    return false;
  }
  return url.protocol === "https:" || (url.protocol === "http:" && loopbackHosts.has(url.hostname));
}

/** Decodes {@link SignerSettings} from JSON. */
export const signerSettingsSchema: z.ZodType<SignerSettings, SignerSettingsWire> = z.strictObject({
  chains: z.array(chainRefSchema).min(1).max(64),
  privyApi: z.string().refine(isApiOrigin, { message: "Expected an https origin." }),
});

/** Reads the settings line; `undefined` for a line that is not JSON or breaks the schema. */
export function readSignerSettings(line: string): SignerSettings | undefined {
  try {
    const settings = signerSettingsSchema.safeParse(JSON.parse(line));
    return settings.success ? settings.data : undefined;
  } catch {
    return undefined;
  }
}
