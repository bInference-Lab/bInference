import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";

/**
 * Parses a client token: `bnt_` and 32 random bytes in base64url, 43 characters without padding.
 * It is a secret; the engine stores only its SHA-256 and shows it once, when it is created.
 */
export const clientTokenSchema: z.ZodType<string, string> = z
  .string()
  .regex(/^bnt_[A-Za-z0-9_-]{43}$/);

/** An IPC client's credential: its `bnt_` token, a secret the engine stores only as SHA-256. */
export interface TokenCredential {
  readonly token: string;
}

/** A paired console device's credential; the engine answers it with a `challenge`. */
export interface DeviceCredential {
  readonly device: ProtocolId<"consoleDevice">;
}

/** The Telegram Mini App's credential: the `initData` Telegram signed for this launch. */
export interface TelegramCredential {
  readonly telegram: { readonly initData: string };
}

/** What `open.auth` carries: exactly one credential. */
export type Credential = TokenCredential | DeviceCredential | TelegramCredential;

/**
 * Parses `open.auth`. A token is `bnt_` and 32 random bytes in base64url, accepted over IPC only;
 * devices and Telegram sign in over WS only. The engine checks the transport, the credential
 * itself and the origin. An object with two credentials is refused.
 */
export const credentialSchema: z.ZodType<Credential> = z.union([
  z.strictObject({ token: clientTokenSchema }),
  z.strictObject({ device: protocolIdSchema("consoleDevice") }),
  z.strictObject({ telegram: z.object({ initData: z.string().min(1) }) }),
]);
