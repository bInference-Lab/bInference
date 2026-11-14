import { orderLineText, reasonText } from "@binference/i18n";
import type { AssetInfos, IntentView, OrderView } from "@binference/protocol";
import { ListIcon } from "lucide-react";
import { useState } from "react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "../components/ui/card";
import { useEngine } from "../connection/engine-context";
import { FailedAlert } from "../connection/failed-alert";
import { useFormatter, useText } from "../i18n/console-text";
import { PendingCard } from "../screens/pending-card";
import { PaperBadge } from "../screens/screen-state";
import { OrderCancel } from "./order-cancel";
import { OrderFills } from "./order-fills";
import type { useCancelOrder } from "./use-orders";

// The states an order can still be cancelled in (protocol spec, section 7.5).
const openStates: ReadonlySet<OrderView["state"]> = new Set([
  "awaiting_confirmation",
  "active",
  "paused",
]);

/** What an order shows: the order, the info of its tokens, its agent, and its card while it waits. */
export interface OrderItemProps {
  readonly order: OrderView;
  readonly assets: AssetInfos;
  readonly agentName?: string;
  readonly pending?: IntentView;
  readonly cancel: ReturnType<typeof useCancelOrder>;
}

// The order's state, mode and agent, and why an ended one ended.
function OrderFacts(props: OrderItemProps): React.JSX.Element {
  const text = useText();
  const formatter = useFormatter();
  const { order, agentName } = props;
  const ended = order.endReason === undefined ? undefined : reasonText(formatter, order.endReason);
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{text("console.orders.state", { state: order.state })}</Badge>
        {order.paper === true ? <PaperBadge /> : null}
        {agentName === undefined ? null : (
          <span className="text-muted-foreground">
            {text("console.orders.agent", { name: agentName })}
          </span>
        )}
      </div>
      {ended === undefined ? null : <p>{text("console.orders.endReason", { reason: ended })}</p>}
      <p className="text-muted-foreground">
        {text("console.orders.changed", { at: formatter.dateTime(order.changedAt) })}
      </p>
    </>
  );
}

/**
 * One auto order (decision 0189): its line in the words every surface names it with, its state,
 * mode and agent, its card while it waits, its fills and skips when asked for, and Cancel order
 * while it is open, for a connection with `propose`. The engine decides a cancel; a refusal shows
 * in its code's words.
 */
export function OrderItem(props: OrderItemProps): React.JSX.Element {
  const text = useText();
  const formatter = useFormatter();
  const { ready } = useEngine();
  const [isShowingFills, showFills] = useState(false);
  const { order, assets, pending, cancel } = props;
  const isOpen = openStates.has(order.state);
  const failure = cancel.variables === order.order ? cancel.error : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base break-words">
          {orderLineText(order, { formatter, assets })}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <OrderFacts {...props} />
        <FailedAlert error={failure} wordsKey="console.orders.failed" />
        {pending === undefined ? null : <PendingCard intent={pending} />}
        {isShowingFills ? <OrderFills order={order.order} isPaper={order.paper === true} /> : null}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          aria-expanded={isShowingFills}
          onClick={() => showFills((now) => !now)}
        >
          <ListIcon data-icon="inline-start" strokeWidth={1.5} aria-hidden />
          {text(isShowingFills ? "console.orders.hideFills" : "console.orders.fills")}
        </Button>
        {isOpen && ready.scopes.includes("propose") ? (
          <OrderCancel order={order} cancel={cancel} />
        ) : null}
      </CardFooter>
    </Card>
  );
}
