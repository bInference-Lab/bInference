import type { OrderView } from "@binference/protocol";
import { XIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "../components/ui/button";
import { useText } from "../i18n/console-text";
import type { useCancelOrder } from "./use-orders";

/**
 * Cancel order, asked once more in the page before `order/cancel` runs: Cancel now cancels, Keep
 * it leaves the order as it is.
 */
export function OrderCancel(props: {
  readonly order: OrderView;
  readonly cancel: ReturnType<typeof useCancelOrder>;
}): React.JSX.Element {
  const text = useText();
  const [isAsking, ask] = useState(false);
  const { order, cancel } = props;
  if (!isAsking) {
    return (
      <Button type="button" variant="outline" disabled={cancel.isPending} onClick={() => ask(true)}>
        <XIcon data-icon="inline-start" strokeWidth={1.5} aria-hidden />
        {text("console.orders.cancel")}
      </Button>
    );
  }
  const act = (): void => {
    ask(false);
    cancel.mutate(order.order);
  };
  return (
    <div className="flex w-full flex-col gap-2">
      <p className="text-sm">{text("console.orders.cancelAsk")}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="destructive" onClick={act}>
          {text("console.orders.cancelConfirm")}
        </Button>
        <Button type="button" variant="outline" onClick={() => ask(false)}>
          {text("console.orders.keep")}
        </Button>
      </div>
    </div>
  );
}
