import type { Amount } from "@binference/chain";
import type { NoticePartView } from "@binference/protocol";
import { noticeTableAtMs, type TableNotice } from "./notice-table.js";

/** A notice part as the `notice/new` push carries it: each amount's base units as decimal text. */
interface PartWire {
  readonly key: string;
  readonly values: Readonly<Record<string, string>>;
  readonly times?: Readonly<Record<string, number>>;
  readonly amounts?: Readonly<Record<string, { readonly asset: string; readonly base: string }>>;
  readonly parts?: Readonly<Record<string, PartWire>>;
}

type AmountWire = NonNullable<PartWire["amounts"]>[string];

function wireOf(part: Readonly<NoticePartView>): PartWire {
  const { amounts, parts, ...rest } = part;
  const amountWires = Object.entries(amounts ?? {}).map(
    ([name, amount]: readonly [string, Amount]): readonly [string, AmountWire] => [
      name,
      { asset: amount.asset, base: amount.base.toString() },
    ],
  );
  const partWires = Object.entries(parts ?? {}).map(
    ([name, inner]: readonly [string, NoticePartView]): readonly [string, PartWire] => [
      name,
      wireOf(inner),
    ],
  );
  return {
    ...rest,
    ...(amounts === undefined ? {} : { amounts: Object.fromEntries(amountWires) }),
    ...(parts === undefined ? {} : { parts: Object.fromEntries(partWires) }),
  };
}

/**
 * The data of the `notice/new` push that carries a notice of the table, as the engine sends it:
 * the `n`th notice id, the table's moment, and every amount's base units as decimal text.
 */
export function noticeTablePush(notice: Readonly<TableNotice>, n: number): object {
  const { after, assets, agent } = notice;
  return {
    id: `ntc_0190f1c2-3a4b-7c5d-8e6f-${String(n).padStart(12, "0")}`,
    at: noticeTableAtMs,
    ...wireOf(notice),
    ...(agent === undefined ? {} : { agent }),
    ...(after === undefined ? {} : { after: after.map(wireOf) }),
    ...(assets === undefined ? {} : { assets }),
  };
}
