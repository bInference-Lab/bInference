import type { Id } from "@binference/core";
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
}

/** The `notice/new` push of one notice, on the `notice` topic every reading client receives. */
export function noticePush(notice: Notice): EnginePush {
  const { agent, intent, key, values, times } = notice;
  return {
    topic: "notice",
    kind: "notice/new",
    data: {
      key,
      ...(agent === undefined ? {} : { agent }),
      values: { ...values },
      ...(times === undefined ? {} : { times: { ...times } }),
      ...(intent === undefined ? {} : { intent }),
    },
  };
}
