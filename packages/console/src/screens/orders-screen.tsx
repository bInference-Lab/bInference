import { cardLineText } from "@binference/i18n";
import type { AgentView, AssetInfos, CardValueView, OrderView } from "@binference/protocol";
import { useId, useState } from "react";
import { usePendingIntents } from "../cards/use-pending-intents";
import { Button } from "../components/ui/button";
import { useEngine } from "../connection/engine-context";
import { useAgents } from "../connection/use-agents";
import { useFormatter, useText } from "../i18n/console-text";
import { AlertItem } from "../orders/alert-item";
import { OrderItem } from "../orders/order-item";
import { useAlertAssets, useAlerts } from "../orders/use-alerts";
import { type OrderList, useCancelOrder, useOrderPages } from "../orders/use-orders";
import { ScreenState } from "./screen-state";

const lists: readonly OrderList[] = ["open", "ended"];

function choice(value: string): CardValueView {
  return { type: "choice", choice: value };
}

// Each agent's name by its id, for the orders and alerts that name it.
function useAgentNames(): ReadonlyMap<string, string> {
  const agents: readonly AgentView[] = useAgents() ?? [];
  return new Map(agents.map(({ agent, name }) => [agent, name]));
}

// The orders of one mode under their heading; live and paper are never shown together.
function ModeGroup(props: {
  readonly mode: "live" | "paper";
  readonly orders: readonly OrderView[];
  readonly assets: AssetInfos;
  readonly cancel: ReturnType<typeof useCancelOrder>;
}): React.JSX.Element | null {
  const text = useText();
  const id = useId();
  const names = useAgentNames();
  const pending = usePendingIntents().data ?? [];
  const { mode, orders, assets, cancel } = props;
  if (orders.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="text-base font-semibold">
        {text("console.orders.mode", { mode })}
      </h2>
      <ul className="flex flex-col gap-3">
        {orders.map((order) => {
          const card = pending.find(({ intent }) => intent === order.intent);
          const name = names.get(order.agent);
          return (
            <li key={order.order}>
              <OrderItem
                order={order}
                assets={assets}
                cancel={cancel}
                {...(name === undefined ? {} : { agentName: name })}
                {...(card === undefined ? {} : { pending: card })}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// What the engine answered the last cancel: the order as it ended, which leaves the open list.
function CancelOutcome(props: {
  readonly cancel: ReturnType<typeof useCancelOrder>;
}): React.JSX.Element | null {
  const formatter = useFormatter();
  const ended = props.cancel.data;
  if (ended === undefined) {
    return null;
  }
  const line = {
    key: "console.orders.cancelled",
    values: {
      order: { type: "line", line: { key: "order.kind", values: { kind: choice(ended.kind) } } },
      state: choice(ended.state),
      at: { type: "dateTime", atMs: ended.changedAt },
    },
  } as const;
  return <output className="text-sm">{cardLineText(line, { formatter, assets: {} })}</output>;
}

// The orders of the list, a page of 50 at a time, live apart from paper.
function OrderLists(props: {
  readonly list: OrderList;
  readonly cancel: ReturnType<typeof useCancelOrder>;
}): React.JSX.Element {
  const text = useText();
  const pages = useOrderPages(props.list);
  if (pages.data === undefined) {
    return <ScreenState error={pages.error} />;
  }
  const orders = pages.data.pages.flatMap((page) => page.items);
  const assets: AssetInfos = Object.fromEntries(
    pages.data.pages.flatMap((page) => Object.entries(page.assets)),
  );
  if (orders.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {text("console.orders.empty", { list: props.list })}
      </p>
    );
  }
  const group = { assets, cancel: props.cancel };
  return (
    <>
      <ModeGroup mode="live" orders={orders.filter(({ paper }) => paper !== true)} {...group} />
      <ModeGroup mode="paper" orders={orders.filter(({ paper }) => paper === true)} {...group} />
      {pages.hasNextPage ? (
        <Button
          type="button"
          variant="outline"
          className="self-start"
          disabled={pages.isFetchingNextPage}
          onClick={() => void pages.fetchNextPage()}
        >
          {text("console.orders.more")}
        </Button>
      ) : null}
    </>
  );
}

// The active alerts, each with Delete.
function AlertSection(): React.JSX.Element {
  const text = useText();
  const id = useId();
  const alerts = useAlerts();
  const names = useAgentNames();
  const assets = useAlertAssets(alerts.data ?? []);
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="text-base font-semibold">
        {text("console.alerts.title")}
      </h2>
      <p className="text-sm text-muted-foreground">{text("console.alerts.intro")}</p>
      {alerts.data === undefined ? <ScreenState error={alerts.error} /> : null}
      {alerts.data?.length === 0 ? (
        <p className="text-sm text-muted-foreground">{text("console.alerts.empty")}</p>
      ) : null}
      <ul aria-label={text("console.alerts.list")} className="flex flex-col gap-3">
        {(alerts.data ?? []).map((alert) => {
          const name = names.get(alert.agent);
          return (
            <li key={alert.alert}>
              <AlertItem
                alert={alert}
                assets={assets}
                {...(name === undefined ? {} : { agentName: name })}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The agent's auto orders and alerts (decisions 0189, 0244 and 0246): the open orders or those
 * that ended, live apart from paper, each with its state, its card while it waits, its fills and
 * skips, and Cancel order while it is open; then the active alerts, each with Delete. A cancel
 * ends the order at once on every surface, and pushes on the `order` and `intent` topics load the
 * lists again.
 */
export function OrdersScreen(): React.JSX.Element {
  const text = useText();
  const { ready } = useEngine();
  const [list, show] = useState<OrderList>("open");
  const cancel = useCancelOrder();
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">{text("console.orders.title")}</h1>
      <p className="text-sm text-muted-foreground">{text("console.orders.intro")}</p>
      {ready.scopes.includes("propose") ? null : (
        <p className="text-sm text-muted-foreground">{text("console.orders.noScope")}</p>
      )}
      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">{text("console.orders.list")}</legend>
        {lists.map((each) => (
          <Button
            key={each}
            type="button"
            variant={each === list ? "default" : "outline"}
            aria-pressed={each === list}
            onClick={() => show(each)}
          >
            {text("console.orders.show", { list: each })}
          </Button>
        ))}
      </fieldset>
      <CancelOutcome cancel={cancel} />
      <OrderLists list={list} cancel={cancel} />
      <AlertSection />
    </section>
  );
}
