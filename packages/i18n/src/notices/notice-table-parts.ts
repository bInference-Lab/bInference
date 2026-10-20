import { type Amount, type AssetRef, assetRefSchema } from "@binference/chain";
import { type NoticePartView, type ProtocolId, protocolIdSchema } from "@binference/protocol";

/** The coin of the fake chain the tests run on, `FAKE` with 18 decimals. */
export const noticeTableCoin: AssetRef = assetRefSchema.parse("fake:1/slip44:1");

/** 2026-10-11 09:30 UTC, the moment every notice of the notice table names. */
export const noticeTableAtMs: number = Date.UTC(2026, 9, 11, 9, 30, 0);

/** The agent, values and parts the notices of the notice table share. */
export interface NoticeTableParts {
  /** The agent the table's notices name. */
  readonly tableAgent: ProtocolId<"agent">;
  /** The table's moment as a notice's `when` time. */
  readonly at: { readonly when: number };
  /** The agent's name as a notice's value. */
  readonly agent: { readonly agent: string };
  /** Thousandths of the test chain's coin, which has 18 decimals. */
  readonly coinAmount: (thousandths: bigint) => Amount;
  /** An auto order's kind as a notice part. */
  readonly orderKind: (kind: string) => NoticePartView;
  /** A fill's sale. */
  readonly sale: NoticePartView;
  /** A new token launch. */
  readonly launch: NoticePartView;
}

const coinAmount = (thousandths: bigint): Amount => ({
  asset: noticeTableCoin,
  base: thousandths * 10n ** 15n,
});

/** The {@link NoticeTableParts} of the notice table. */
export const noticeTableParts: NoticeTableParts = {
  tableAgent: protocolIdSchema("agent").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000001"),
  at: { when: noticeTableAtMs },
  agent: { agent: "main" },
  coinAmount,
  orderKind: (kind) => ({ key: "order.kind", values: { kind } }),
  sale: {
    key: "fill.sell",
    values: { received: "$12.40", price: "$0.0000075" },
    amounts: { amount: coinAmount(1_650n) },
  },
  launch: {
    key: "launch.line",
    values: {
      token: "PEPE 0x6982…1933",
      launchpad: "Pad",
      tax: "1%",
      insiders: "2",
      creatorLaunches: "0",
    },
    parts: {
      curve: { key: "launch.curve", values: { graduated: "no", progress: "42%" } },
      age: { key: "launch.age", values: { unit: "minute", count: "3" } },
    },
  },
};
