import type { IntentView } from "@binference/protocol";
import type { BridgeRecord } from "../bridges/bridge-record.js";
import type { BridgeStore } from "../bridges/ports.js";
import type { IntentRecord } from "../intents/intent-record.js";

/** A bridge's delivery as `IntentView.delivery` shows it (protocol spec, section 8.3). */
export type DeliveryView = NonNullable<IntentView["delivery"]>;

// A bridge's delivery as views show it (protocol spec, section 8.3).
function deliveryViewOf(bridge: BridgeRecord): DeliveryView {
  const { received, fillTx, refundTx, statusUrl, lateAtMs, settledAtMs } = bridge;
  return {
    state: bridge.state,
    toChain: bridge.toChain,
    recipient: bridge.recipient,
    minOut: bridge.minOut,
    ...(received === undefined ? {} : { received }),
    ...(fillTx === undefined ? {} : { fillTx }),
    ...(refundTx === undefined ? {} : { refundTx }),
    ...(statusUrl === undefined ? {} : { statusUrl }),
    sentAt: bridge.sentAtMs,
    ...(lateAtMs === undefined ? {} : { lateAt: lateAtMs }),
    ...(settledAtMs === undefined ? {} : { settledAt: settledAtMs }),
  };
}

/** A bridge intent's delivery, once its deposit opened it; none for any other intent. */
export async function deliveryOf(
  bridges: Pick<BridgeStore, "get"> | undefined,
  record: Pick<IntentRecord, "id" | "kind">,
  signal: AbortSignal,
): Promise<DeliveryView | undefined> {
  const bridge =
    record.kind === "bridge" && bridges !== undefined
      ? await bridges.get(record.id, { signal })
      : undefined;
  return bridge === undefined ? undefined : deliveryViewOf(bridge);
}
