import type { ChainRegistry } from "@binference/chain";
import { err, idSchema, ok, type Result } from "@binference/core";
import type { IntentView, Page, ProtocolErrorCode } from "@binference/protocol";
import { z } from "zod";
import type { StoredIntents } from "../intents/create-stored-intents.js";
import type { IntentQuery } from "../intents/intent-change.js";
import { intentStates } from "../intents/intent-state.js";
import { epochMsSchema } from "../records/record-fields.js";
import type { EngineCall } from "./engine-call.js";
import { intentViewOf } from "./intent-view-of.js";

/** What `intent/list` reads: the intents by state, each one's snapshot, and the chains. */
export interface IntentListOptions {
  readonly stored: Pick<StoredIntents, "list" | "snapshot">;
  readonly chains: ChainRegistry;
}

const defaultPageSize = 50;

// A cursor is the last intent of the page before: its change time and its id, `<ms>:<id>`.
const cursorSchema = z
  .string()
  .max(128)
  .transform((text) => {
    const at = text.indexOf(":");
    return { changedAtMs: text.slice(0, at), id: text.slice(at + 1) };
  })
  .pipe(
    z.strictObject({
      changedAtMs: z
        .string()
        .regex(/^(?:0|[1-9]\d{0,14})$/)
        .pipe(z.coerce.number<string>())
        .pipe(epochMsSchema),
      id: idSchema("int"),
    }),
  );

function queryOf(
  args: EngineCall<"intent/list">["args"],
): Result<IntentQuery, "protocol.bad_args"> {
  const after = args.cursor === undefined ? undefined : cursorSchema.safeParse(args.cursor);
  if (after?.success === false) {
    return err("protocol.bad_args");
  }
  return ok({
    states: args.state === undefined ? [...intentStates] : [args.state],
    limit: args.limit ?? defaultPageSize,
    ...(args.agent === undefined ? {} : { agentId: args.agent }),
    ...(after === undefined ? {} : { after: after.data }),
  });
}

/**
 * Answers `intent/list` (protocol spec, section 7.4): a page of intents, the least recently
 * changed first, in one state or all, of one agent or all. The kind filter applies within each
 * page, and `next` is present while a full page came back.
 */
export async function listIntents(
  options: IntentListOptions,
  call: EngineCall<"intent/list">,
): Promise<Result<Page<IntentView>, ProtocolErrorCode>> {
  const { args, signal } = call;
  const query = queryOf(args);
  if (!query.ok) {
    return query;
  }
  const records = await options.stored.list(query.value, { signal });
  const wanted = records.filter((record) => args.kind === undefined || record.kind === args.kind);
  const snapshots = await Promise.all(
    wanted.map(async (record) => options.stored.snapshot(record.id, { signal })),
  );
  const items = snapshots.flatMap((snapshot) =>
    snapshot === undefined ? [] : [intentViewOf(snapshot, options.chains)],
  );
  const last = records.at(-1);
  return ok(
    records.length === query.value.limit && last !== undefined
      ? { items, next: `${String(last.changedAtMs)}:${last.id}` }
      : { items },
  );
}
