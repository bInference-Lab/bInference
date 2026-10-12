import { type Amount, type AmountWire, amountSchema } from "@binference/chain";
import { type Id, idSchema, type JsonValue } from "@binference/core";
import { type AssetInfo, type AssetInfos, assetInfosSchema } from "@binference/protocol";
import { z } from "zod";
import { epochMsSchema } from "../records/record-fields.js";
import type { EnginePush } from "./engine-push.js";

/**
 * A message a notice's message takes as an argument, such as the fill's `{result}` from `fill.*`
 * or the order's `{orderKind}` (spec 4, section 4.3): its key and its own arguments, written in the
 * owner's language when the notice is. A part may take parts of its own, two levels at most.
 */
export interface NoticePart {
  readonly key: string;
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
  /** The message's arguments that are messages themselves, each written before the message. */
  readonly parts?: Readonly<Record<string, NoticePart>>;
}

/**
 * One owner notice (ARCHITECTURE.md section 27) as the `notice/new` push carries it: the message
 * key, the agent it is about, and the message's arguments that are plain text or the value of an
 * ICU `select`. A notice about the whole install, such as the locked engine, names no agent. A
 * notice about an intent, such as a receipt, names the intent instead of carrying amounts: the
 * surface draws those from the stored intent, as it draws a card.
 */
export interface Notice extends NoticePart {
  readonly agent?: Id<"agt">;
  readonly intent?: Id<"int">;
  /**
   * The messages that follow the notice, each on a line of its own, such as `alert.woke` after an
   * alert that woke the agent (spec 4, section 4.3).
   */
  readonly after?: readonly NoticePart[];
  /**
   * The info of each token its amounts name that the registry does not list, as its order's card
   * stored it at the proposal, marked unverified (decision 0199).
   */
  readonly assets?: AssetInfos;
}

/** A notice's part as JSON carries it: each amount's base units as decimal text. */
interface NoticePartWire {
  readonly key: string;
  readonly values: Readonly<Record<string, string>>;
  readonly times?: Readonly<Record<string, number>>;
  readonly amounts?: Readonly<Record<string, AmountWire>>;
  readonly parts?: Readonly<Record<string, NoticePartWire>>;
}

/** A notice as the `notice/new` push carries it as JSON: each amount's base units as decimal text. */
export interface NoticeWire extends NoticePartWire {
  readonly agent?: string;
  readonly intent?: string;
  readonly after?: readonly NoticePartWire[];
  readonly assets?: Readonly<Record<string, AssetInfo>>;
}

// How deep parts may nest under a notice: a notice's part, and that part's own parts.
const partLevels = 2;
// The most messages that follow one notice.
const maxAfter = 4;

const messageShape = {
  key: z.string().min(1),
  values: z.record(z.string(), z.string()),
  times: z.record(z.string(), epochMsSchema).exactOptional(),
  amounts: z.record(z.string(), amountSchema).exactOptional(),
};

// A part that may hold parts `levels` deep below it.
function partSchemaOf(levels: number): z.ZodType<NoticePart, NoticePartWire> {
  if (levels === 0) {
    return z.strictObject(messageShape);
  }
  return z.strictObject({
    ...messageShape,
    parts: z.record(z.string(), partSchemaOf(levels - 1)).exactOptional(),
  });
}

const partSchema = partSchemaOf(partLevels - 1);

/**
 * Parses the data of a `notice/new` push back into its {@link Notice}, each amount's base units a
 * `bigint` again. A surface that formats a notice reads it through this schema.
 */
export const noticeSchema: z.ZodType<Notice, NoticeWire> = z.strictObject({
  ...messageShape,
  agent: idSchema("agt").exactOptional(),
  intent: idSchema("int").exactOptional(),
  parts: z.record(z.string(), partSchema).exactOptional(),
  after: z.array(partSchema).max(maxAfter).exactOptional(),
  assets: assetInfosSchema.exactOptional(),
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

interface PartData {
  readonly [name: string]: JsonValue;
}

// A part as JSON carries it, its own parts too.
function partData(part: NoticePart): PartData {
  const { key, values, times, amounts, parts } = part;
  return {
    key,
    values: { ...values },
    ...(times === undefined ? {} : { times: { ...times } }),
    ...(amounts === undefined ? {} : { amounts: amountWires(amounts) }),
    ...(parts === undefined
      ? {}
      : {
          parts: Object.fromEntries(
            Object.entries(parts).map(([name, inner]: readonly [string, NoticePart]) => [
              name,
              partData(inner),
            ]),
          ),
        }),
  };
}

// The notice as the push carries it, each amount's base units as decimal text. It never throws:
// the push is sent from the money path, and a surface checks it as it reads it.
function noticeData(notice: Notice) {
  const { agent, intent, after, assets } = notice;
  return {
    ...partData(notice),
    ...(agent === undefined ? {} : { agent }),
    ...(intent === undefined ? {} : { intent }),
    ...(after === undefined ? {} : { after: after.map(partData) }),
    ...(assets === undefined
      ? {}
      : {
          assets: Object.fromEntries(
            Object.entries(assets).map(([ref, info]: readonly [string, AssetInfo]) => [
              ref,
              { ...info },
            ]),
          ),
        }),
  };
}

/** The `notice/new` push of one notice, on the `notice` topic every reading client receives. */
export function noticePush(notice: Notice): EnginePush {
  return { topic: "notice", kind: "notice/new", data: noticeData(notice) };
}

/**
 * The `notice/new` push of a stored notice (decision 0133): the notice with its id and time, so a
 * client that misses pushes reads on with `notice/list` from the last id it has.
 */
export function storedNoticePush(stored: {
  readonly id: Id<"ntc">;
  readonly atMs: number;
  readonly notice: Notice;
}): EnginePush {
  const data = { id: stored.id, at: stored.atMs, ...noticeData(stored.notice) };
  return { topic: "notice", kind: "notice/new", data };
}
