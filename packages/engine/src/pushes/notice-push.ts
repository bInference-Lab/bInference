import { type Amount, type AmountWire, amountSchema } from "@binference/chain";
import { type Id, idSchema } from "@binference/core";
import { z } from "zod";
import { epochMsSchema } from "../records/record-fields.js";
import type { EnginePush } from "./engine-push.js";

/**
 * One owner notice (ARCHITECTURE.md section 27) as the `notice/new` push carries it: the message
 * key, the agent it is about, and the message's arguments that are plain text or the value of an
 * ICU `select`. A notice about the whole install, such as the locked engine, names no agent. A
 * notice about an intent, such as a receipt, names the intent instead of carrying amounts: the
 * surface draws those from the stored intent, as it draws a card.
 */
export interface Notice {
  readonly key: string;
  readonly agent?: Id<"agt">;
  readonly intent?: Id<"int">;
  readonly values: Readonly<Record<string, string>>;
  /**
   * The message's arguments that are moments, in epoch milliseconds. A surface formats each with
   * the formatter's `dateTime`, in the owner's language and timezone, before the message.
   */
  readonly times?: Readonly<Record<string, number>>;
  /**
   * The message's arguments that are amounts of an asset. The push carries their base units as
   * decimal text; a surface formats each with the formatter's `tokenAmount` and the asset's symbol.
   */
  readonly amounts?: Readonly<Record<string, Amount>>;
}

/** A notice as the `notice/new` push carries it as JSON: each amount's base units as decimal text. */
export interface NoticeWire {
  readonly key: string;
  readonly agent?: string;
  readonly intent?: string;
  readonly values: Readonly<Record<string, string>>;
  readonly times?: Readonly<Record<string, number>>;
  readonly amounts?: Readonly<Record<string, AmountWire>>;
}

/**
 * Parses the data of a `notice/new` push back into its {@link Notice}, each amount's base units a
 * `bigint` again. A surface that formats a notice reads it through this schema.
 */
export const noticeSchema: z.ZodType<Notice, NoticeWire> = z.strictObject({
  key: z.string().min(1),
  agent: idSchema("agt").exactOptional(),
  intent: idSchema("int").exactOptional(),
  values: z.record(z.string(), z.string()),
  times: z.record(z.string(), epochMsSchema).exactOptional(),
  amounts: z.record(z.string(), amountSchema).exactOptional(),
});

// Each amount as JSON carries it, with its base units as decimal text.
function amountWires(
  amounts: Readonly<Record<string, Amount>>,
): Readonly<Record<string, Readonly<Record<string, string>>>> {
  return Object.fromEntries(
    Object.entries(amounts).map(([name, amount]: readonly [string, Amount]) => [
      name,
      { ...z.encode(amountSchema, amount) },
    ]),
  );
}

/** The `notice/new` push of one notice, on the `notice` topic every reading client receives. */
export function noticePush(notice: Notice): EnginePush {
  const { agent, intent, key, values, times, amounts } = notice;
  return {
    topic: "notice",
    kind: "notice/new",
    data: {
      key,
      ...(agent === undefined ? {} : { agent }),
      values: { ...values },
      ...(times === undefined ? {} : { times: { ...times } }),
      ...(amounts === undefined ? {} : { amounts: amountWires(amounts) }),
      ...(intent === undefined ? {} : { intent }),
    },
  };
}
