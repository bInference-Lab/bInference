import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { type Empty, emptyArgsSchema } from "../values/empty.schema.js";
import { epochMsSchema } from "../values/epoch-ms.schema.js";
import {
  type Page,
  type PageArgs,
  pageArgsSchema,
  pageArgsShape,
  pageSchema,
} from "../values/page.schema.js";
import { plainIdSchema } from "../values/plain-id.schema.js";
import { releaseVersionSchema } from "../values/release-version.schema.js";
import { type FileTicket, fileTicketSchema } from "../views/file-ticket.schema.js";
import { type JobRef, jobRefSchema } from "../views/job-ref.schema.js";
import { localWriteFlags, readFlags, writeFlags, type OperationTable } from "./operation.schema.js";

/** A JSON object whose shape another package owns, such as the config file's. */
type JsonObject = Readonly<Record<string, unknown>>;

/** The config, with every secret source shown as its kind only. */
interface ConfigView {
  readonly config: JsonObject;
}

/** One change in the config journal. */
interface ConfigEntryView {
  readonly at: number;
  /** Who changed it: a token, a device or the owner in Telegram. */
  readonly by: string;
  readonly surface: string;
  /** The changed key's path, such as `limits.perTradeUsd`. */
  readonly path: string;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly reason?: string;
}

/** The time range and agent of a ledger read; absent fields do not filter. */
interface LedgerRange {
  readonly agent?: ProtocolId<"agent">;
  readonly from?: number;
  readonly to?: number;
}

/** One ledger entry with its hash, chained to the entry before it. */
interface LedgerEntryView {
  readonly seq: number;
  readonly entry: ProtocolId<"ledgerEntry">;
  readonly at: number;
  readonly agent?: ProtocolId<"agent">;
  readonly kind: string;
  /** The id of the thing the entry records, such as an intent. */
  readonly subject: string;
  readonly data: JsonObject;
  readonly prevHash: string;
  readonly hash: string;
}

/** A backup file. */
interface BackupView {
  readonly backup: ProtocolId<"backup">;
  readonly kind: "daily" | "weekly" | "manual" | "before_update" | "before_migration";
  readonly bytes: number;
  readonly createdAt: number;
  readonly verifiedAt?: number;
}

/** The answer of `update/check`. */
interface UpdateView {
  readonly current: string;
  readonly latest?: string;
  readonly channel: "stable" | "beta";
  readonly notes?: string;
}

/** The args of `check/run`: `fix` repairs what it can; `only` names stable check ids. */
interface CheckArgs {
  readonly fix?: boolean;
  readonly only?: readonly string[];
}

/** The settings, ledger, backup, update and check operations of protocol spec section 7.9. */
export interface SettingsOperationShapes {
  readonly "config/read": { readonly args: Empty; readonly result: ConfigView };
  readonly "config/change": {
    readonly args: { readonly patch: JsonObject; readonly reason?: string };
    readonly result: ConfigView & { readonly restartNeeded: boolean };
  };
  readonly "config/history": { readonly args: PageArgs; readonly result: Page<ConfigEntryView> };
  readonly "ledger/list": {
    readonly args: LedgerRange & PageArgs;
    readonly result: Page<LedgerEntryView>;
  };
  /** A CSV file of the range. */
  readonly "ledger/export": { readonly args: LedgerRange; readonly result: FileTicket };
  readonly "backup/list": { readonly args: Empty; readonly result: Page<BackupView> };
  readonly "backup/create": {
    readonly args: { readonly copyTo?: string };
    readonly result: JobRef;
  };
  /** The engine restarts after it restores. */
  readonly "backup/restore": {
    readonly args: { readonly backup: ProtocolId<"backup"> };
    readonly result: JobRef;
  };
  readonly "update/check": { readonly args: Empty; readonly result: UpdateView };
  readonly "update/apply": {
    readonly args: { readonly version?: string };
    readonly result: JobRef;
  };
  readonly "check/run": { readonly args: CheckArgs; readonly result: JobRef };
  /** The job ends with a file: the redacted support bundle. */
  readonly "report/create": { readonly args: Empty; readonly result: JobRef };
}

const agent = protocolIdSchema("agent");
const jsonObject = z.record(z.string(), z.unknown());
const configView = z.object({ config: jsonObject });
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const ledgerRange = {
  agent: agent.exactOptional(),
  from: epochMsSchema.exactOptional(),
  to: epochMsSchema.exactOptional(),
};

/** The settings, ledger, backup, update and check operations, by name. */
export const settingsOperations: OperationTable<SettingsOperationShapes> = {
  "config/read": {
    ...readFlags,
    name: "config/read",
    scope: "admin",
    args: emptyArgsSchema,
    result: configView,
  },
  "config/change": {
    ...writeFlags,
    name: "config/change",
    scope: "admin",
    args: z.strictObject({ patch: jsonObject, reason: z.string().min(1).exactOptional() }),
    result: z.object({ config: jsonObject, restartNeeded: z.boolean() }),
  },
  "config/history": {
    ...readFlags,
    name: "config/history",
    scope: "read",
    args: pageArgsSchema,
    result: pageSchema(
      z.object({
        at: epochMsSchema,
        by: z.string(),
        surface: z.string(),
        path: z.string(),
        before: z.unknown().exactOptional(),
        after: z.unknown().exactOptional(),
        reason: z.string().exactOptional(),
      }),
    ),
  },
  "ledger/list": {
    ...readFlags,
    name: "ledger/list",
    scope: "read",
    args: z.strictObject({ ...pageArgsShape, ...ledgerRange }),
    result: pageSchema(
      z.object({
        seq: z.int().positive(),
        entry: protocolIdSchema("ledgerEntry"),
        at: epochMsSchema,
        agent: agent.exactOptional(),
        kind: z.string(),
        subject: z.string(),
        data: jsonObject,
        prevHash: hash,
        hash,
      }),
    ),
  },
  "ledger/export": {
    ...writeFlags,
    name: "ledger/export",
    scope: "read",
    args: z.strictObject(ledgerRange),
    result: fileTicketSchema,
  },
  "backup/list": {
    ...readFlags,
    name: "backup/list",
    scope: "read",
    args: emptyArgsSchema,
    result: pageSchema(
      z.object({
        backup: protocolIdSchema("backup"),
        kind: z.enum(["daily", "weekly", "manual", "before_update", "before_migration"]),
        bytes: z.int().nonnegative(),
        createdAt: epochMsSchema,
        verifiedAt: epochMsSchema.exactOptional(),
      }),
    ),
  },
  "backup/create": {
    ...writeFlags,
    name: "backup/create",
    scope: "admin",
    args: z.strictObject({ copyTo: z.string().min(1).exactOptional() }),
    result: jobRefSchema,
  },
  "backup/restore": {
    ...localWriteFlags,
    name: "backup/restore",
    scope: "admin",
    args: z.strictObject({ backup: protocolIdSchema("backup") }),
    result: jobRefSchema,
  },
  "update/check": {
    ...readFlags,
    name: "update/check",
    scope: "read",
    args: emptyArgsSchema,
    result: z.object({
      current: z.string(),
      latest: z.string().exactOptional(),
      channel: z.enum(["stable", "beta"]),
      notes: z.string().exactOptional(),
    }),
  },
  "update/apply": {
    ...localWriteFlags,
    name: "update/apply",
    scope: "admin",
    args: z.strictObject({ version: releaseVersionSchema.exactOptional() }),
    result: jobRefSchema,
  },
  "check/run": {
    ...writeFlags,
    name: "check/run",
    scope: "read",
    scopeCase: { scope: "admin", when: "fix" },
    args: z.strictObject({
      fix: z.boolean().exactOptional(),
      only: z.array(plainIdSchema).min(1).exactOptional(),
    }),
    result: jobRefSchema,
  },
  "report/create": {
    ...writeFlags,
    name: "report/create",
    scope: "admin",
    args: emptyArgsSchema,
    result: jobRefSchema,
  },
};
