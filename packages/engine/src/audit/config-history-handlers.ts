import { err, ok } from "@binference/core";
import { z } from "zod";
import type { EngineHandler } from "../operations/engine-call.js";
import type { ConfigJournal } from "../ports.js";

/** The handler of `config/history` (protocol spec, section 7.9). */
export interface ConfigHistoryHandlers {
  readonly "config/history": EngineHandler<"config/history">;
}

const defaultPageSize = 50;
// A cursor is the id of the last entry of the page before, in decimal.
const cursorSchema: z.ZodType<number, string> = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,14})$/)
  .pipe(z.coerce.number<string>());

/**
 * Creates the config history handler over the config journal. `config/history` pages through
 * every change in the order it was recorded: when, who, on which surface, the path, and its value
 * before and after; `next` is present while a full page came back.
 */
export function createConfigHistoryHandlers(journal: ConfigJournal): ConfigHistoryHandlers {
  return {
    async "config/history"({ args, signal }) {
      const after = cursorSchema.safeParse(args.cursor ?? "0");
      if (!after.success) {
        return err("protocol.bad_args");
      }
      const limit = args.limit ?? defaultPageSize;
      const entries = await journal.list({ after: after.data, limit }, { signal });
      const items = entries.map(({ id: _id, atMs, ...change }) => ({ at: atMs, ...change }));
      const last = entries.at(-1);
      return ok(
        entries.length === limit && last !== undefined
          ? { items, next: String(last.id) }
          : { items },
      );
    },
  };
}
