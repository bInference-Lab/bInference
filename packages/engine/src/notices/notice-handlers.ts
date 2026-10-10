import { err, idSchema, ok } from "@binference/core";
import type { NoticeView } from "@binference/protocol";
import type { EngineHandler } from "../operations/engine-call.js";
import type { NoticeStore } from "../ports.js";
import type { NoticeRecord } from "./notice-record.js";

/** The handler of `notice/list` (protocol spec, section 7.1). */
export interface NoticeHandlers {
  readonly "notice/list": EngineHandler<"notice/list">;
}

const defaultPageSize = 50;
// A cursor is the id of the last notice the client has.
const cursorSchema = idSchema("ntc");

function viewOf(record: NoticeRecord): NoticeView {
  const { notice } = record;
  return {
    id: record.id,
    at: record.atMs,
    key: notice.key,
    ...(notice.agent === undefined ? {} : { agent: notice.agent }),
    ...(notice.intent === undefined ? {} : { intent: notice.intent }),
    values: notice.values,
    ...(notice.times === undefined ? {} : { times: notice.times }),
    ...(notice.amounts === undefined ? {} : { amounts: notice.amounts }),
    delivered: record.delivered,
  };
}

/**
 * Creates the notice handler over the notice store. `notice/list` pages through the notices kept,
 * oldest first, each with its delivery to every surface; a cursor is a notice's id, and the page
 * holds the notices after it. `next` is present while a full page came back.
 */
export function createNoticeHandlers(store: NoticeStore): NoticeHandlers {
  return {
    async "notice/list"({ args, signal }) {
      const after = args.cursor === undefined ? undefined : cursorSchema.safeParse(args.cursor);
      if (after?.success === false) {
        return err("protocol.bad_args");
      }
      const limit = args.limit ?? defaultPageSize;
      const page = after === undefined ? { limit } : { after: after.data, limit };
      const records = await store.list(page, { signal });
      const items = records.map(viewOf);
      const last = records.at(-1);
      return ok(
        records.length === limit && last !== undefined ? { items, next: last.id } : { items },
      );
    },
  };
}
