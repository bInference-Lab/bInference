import { err, ok } from "@binference/core";
import { z } from "zod";
import { ledgerEntryViewOf } from "../ledger/ledger-entry-view.js";
import type { LedgerEntry } from "../ledger/ledger-entry.js";
import type { LedgerStore } from "../ports.js";
import type { EngineCall, EngineHandler } from "./engine-call.js";

/** The handler of `ledger/list` (protocol spec, section 7.9). */
export interface LedgerHandlers {
  readonly "ledger/list": EngineHandler<"ledger/list">;
}

const defaultPageSize = 50;
// A cursor is the `seq` of the last entry of the page before, in decimal.
const cursorSchema: z.ZodType<number, string> = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,14})$/)
  .pipe(z.coerce.number<string>());

function matches(entry: LedgerEntry, args: EngineCall<"ledger/list">["args"]): boolean {
  const { agent, from, to } = args;
  return (
    (agent === undefined || entry.agentId === agent) &&
    (from === undefined || entry.atMs >= from) &&
    (to === undefined || entry.atMs <= to)
  );
}

/**
 * Creates the ledger handlers over the ledger store. `ledger/list` pages through the entries in
 * `seq` order with their hashes, so a client can check the chain; the filters apply within each
 * page, and `next` is present while a full page came back.
 */
export function createLedgerHandlers(ledger: LedgerStore): LedgerHandlers {
  return {
    async "ledger/list"({ args, signal }) {
      const after = cursorSchema.safeParse(args.cursor ?? "0");
      if (!after.success) {
        return err("protocol.bad_args");
      }
      const limit = args.limit ?? defaultPageSize;
      const page = { after: after.data, limit };
      const entries = await ledger.list(page, { signal });
      const items = entries.filter((entry) => matches(entry, args)).map(ledgerEntryViewOf);
      const last = entries.at(-1);
      return ok(
        entries.length === limit && last !== undefined
          ? { items, next: String(last.seq) }
          : { items },
      );
    },
  };
}
