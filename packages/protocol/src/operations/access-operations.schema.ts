import { z } from "zod";
import { clientTokenSchema } from "../auth/credential.js";
import { type Scope, scopeSchema } from "../auth/scopes.js";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { type Empty, emptyArgsSchema, emptyResultSchema } from "../values/empty.schema.js";
import { epochMsSchema } from "../values/epoch-ms.schema.js";
import { labelSchema } from "../values/label.schema.js";
import { type Page, pageSchema } from "../values/page.schema.js";
import { type JobRef, jobRefSchema } from "../views/job-ref.schema.js";
import { localWriteFlags, readFlags, writeFlags, type OperationTable } from "./operation.schema.js";

/** A paired console device. */
interface DeviceView {
  readonly device: ProtocolId<"consoleDevice">;
  readonly label: string;
  readonly alg: "ed25519" | "p256";
  readonly createdAt: number;
  readonly lastSeenAt?: number;
  readonly revokedAt?: number;
}

/** A client token without its secret. */
interface TokenView {
  readonly token: ProtocolId<"clientToken">;
  readonly label: string;
  readonly kind: "cli" | "runtime" | "mcp" | "custom";
  readonly scopes: readonly Scope[];
  readonly createdAt: number;
  readonly lastUsedAt?: number;
  readonly revokedAt?: number;
  /** When the token stops signing in; absent for a token that works until it is revoked. */
  readonly expiresAt?: number;
}

/** The args of `token/create`. */
interface CreateTokenArgs {
  readonly label: string;
  readonly scopes: readonly Scope[];
}

/**
 * The args of `token/register`: a token the CLI made, of which the engine gets only the SHA-256
 * (decision 0154).
 */
interface RegisterTokenArgs {
  readonly label: string;
  readonly kind: "mcp" | "custom";
  readonly scopes: readonly Scope[];
  /** The SHA-256 of the `bnt_` secret, in lowercase hex. */
  readonly secretHash: string;
  /**
   * When the token stops signing in, after the engine's time and at most 90 days later (decision
   * 0159); absent for a token that works until it is revoked.
   */
  readonly expiresAt?: number;
}

/** The answer of `remote/status`: Tailscale's state and the published URLs. */
interface RemoteView {
  readonly tailscale: "absent" | "stopped" | "running";
  readonly miniUrl?: string;
  readonly webhookUrl?: string;
}

/** The answer of `cex/status`: the connection to the exchange account. */
interface CexView {
  readonly state: "disconnected" | "connected";
  readonly scopes?: readonly string[];
  readonly connectedAt?: number;
}

/** The answer of `device/pair`: the console's single-use pairing link and when it stops working. */
interface DevicePairing {
  /** `http://127.0.0.1:<port>/#pair=<code>`; shown once, never logged. */
  readonly link: string;
  readonly expiresAt: number;
}

/** The device, token, remote access and exchange operations of protocol spec section 7.9. */
export interface AccessOperationShapes {
  readonly "device/pair": { readonly args: Empty; readonly result: DevicePairing };
  readonly "device/list": { readonly args: Empty; readonly result: Page<DeviceView> };
  readonly "device/revoke": {
    readonly args: { readonly device: ProtocolId<"consoleDevice"> };
    readonly result: Empty;
  };
  readonly "token/list": { readonly args: Empty; readonly result: Page<TokenView> };
  readonly "token/create": {
    readonly args: CreateTokenArgs;
    /** The `bnt_` secret, shown this once. */
    readonly result: { readonly token: string };
  };
  readonly "token/revoke": {
    readonly args: { readonly token: ProtocolId<"clientToken"> };
    readonly result: Empty;
  };
  readonly "token/register": { readonly args: RegisterTokenArgs; readonly result: TokenView };
  readonly "remote/status": { readonly args: Empty; readonly result: RemoteView };
  readonly "remote/enable": {
    readonly args: { readonly mini?: boolean; readonly webhooks?: boolean };
    readonly result: JobRef;
  };
  readonly "remote/disable": { readonly args: Empty; readonly result: Empty };
  readonly "cex/status": { readonly args: Empty; readonly result: CexView };
  readonly "cex/connect": {
    readonly args: Empty;
    /** The exchange's sign-in page; it returns to `127.0.0.1`. */
    readonly result: { readonly authorizeUrl: string };
  };
  readonly "cex/disconnect": { readonly args: Empty; readonly result: Empty };
}

const device = protocolIdSchema("consoleDevice");
const token = protocolIdSchema("clientToken");
const url = z.string().min(1);
const tokenView = z.object({
  token,
  label: z.string(),
  kind: z.enum(["cli", "runtime", "mcp", "custom"]),
  scopes: z.array(scopeSchema),
  createdAt: epochMsSchema,
  lastUsedAt: epochMsSchema.exactOptional(),
  revokedAt: epochMsSchema.exactOptional(),
  expiresAt: epochMsSchema.exactOptional(),
});

/** The device, token, remote access and exchange operations, by name. */
export const accessOperations: OperationTable<AccessOperationShapes> = {
  "device/pair": {
    // A read: the engine keeps no answer, so no idempotency entry ever holds a pairing code.
    ...readFlags,
    transport: "ipc",
    name: "device/pair",
    scope: "admin",
    args: emptyArgsSchema,
    result: z.object({ link: z.url(), expiresAt: epochMsSchema }),
  },
  "device/list": {
    ...readFlags,
    name: "device/list",
    scope: "admin",
    args: emptyArgsSchema,
    result: pageSchema(
      z.object({
        device,
        label: z.string(),
        alg: z.enum(["ed25519", "p256"]),
        createdAt: epochMsSchema,
        lastSeenAt: epochMsSchema.exactOptional(),
        revokedAt: epochMsSchema.exactOptional(),
      }),
    ),
  },
  "device/revoke": {
    ...writeFlags,
    name: "device/revoke",
    scope: "confirm",
    args: z.strictObject({ device }),
    result: emptyResultSchema,
  },
  "token/list": {
    ...readFlags,
    name: "token/list",
    scope: "admin",
    args: emptyArgsSchema,
    result: pageSchema(tokenView),
  },
  "token/create": {
    ...localWriteFlags,
    name: "token/create",
    scope: "admin",
    args: z.strictObject({ label: labelSchema, scopes: z.array(scopeSchema).min(1) }),
    result: z.object({ token: clientTokenSchema }),
  },
  "token/revoke": {
    ...writeFlags,
    name: "token/revoke",
    scope: "confirm",
    args: z.strictObject({ token }),
    result: emptyResultSchema,
  },
  "token/register": {
    ...localWriteFlags,
    name: "token/register",
    scope: "admin",
    args: z.strictObject({
      label: labelSchema,
      kind: z.enum(["mcp", "custom"]),
      scopes: z.array(scopeSchema).min(1),
      secretHash: z.string().regex(/^[0-9a-f]{64}$/),
      expiresAt: epochMsSchema.exactOptional(),
    }),
    result: tokenView,
  },
  "remote/status": {
    ...readFlags,
    name: "remote/status",
    scope: "read",
    args: emptyArgsSchema,
    result: z.object({
      tailscale: z.enum(["absent", "stopped", "running"]),
      miniUrl: url.exactOptional(),
      webhookUrl: url.exactOptional(),
    }),
  },
  "remote/enable": {
    ...localWriteFlags,
    name: "remote/enable",
    scope: "admin",
    args: z.strictObject({
      mini: z.boolean().exactOptional(),
      webhooks: z.boolean().exactOptional(),
    }),
    result: jobRefSchema,
  },
  "remote/disable": {
    ...writeFlags,
    name: "remote/disable",
    scope: "confirm",
    args: emptyArgsSchema,
    result: emptyResultSchema,
  },
  "cex/status": {
    ...readFlags,
    name: "cex/status",
    scope: "read",
    args: emptyArgsSchema,
    result: z.object({
      state: z.enum(["disconnected", "connected"]),
      scopes: z.array(z.string()).exactOptional(),
      connectedAt: epochMsSchema.exactOptional(),
    }),
  },
  "cex/connect": {
    ...localWriteFlags,
    name: "cex/connect",
    scope: "admin",
    args: emptyArgsSchema,
    result: z.object({ authorizeUrl: url }),
  },
  "cex/disconnect": {
    ...writeFlags,
    name: "cex/disconnect",
    scope: "confirm",
    args: emptyArgsSchema,
    result: emptyResultSchema,
  },
};
