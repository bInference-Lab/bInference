import { assetValue, cardLineText } from "@binference/i18n";
import type { AlertView, AssetInfos, CardLineView } from "@binference/protocol";
import { Trash2Icon } from "lucide-react";
import { useState } from "react";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "../components/ui/card";
import { useEngine } from "../connection/engine-context";
import { FailedAlert } from "../connection/failed-alert";
import { useFormatter, useText } from "../i18n/console-text";
import { useDeleteAlert } from "./use-alerts";

const yes = { type: "choice", choice: "yes" } as const;
const no = { type: "choice", choice: "no" } as const;

// What an alert watches, as a line of the console's words with its values typed as a card's are.
function conditionLine(alert: AlertView, assets: AssetInfos): CardLineView {
  const { condition } = alert;
  if (condition.kind === "price") {
    const values = {
      token: assetValue(condition.asset, assets),
      direction: { type: "choice", choice: condition.direction },
      price: { type: "usd", usdMicros: condition.price },
    } as const;
    return { key: "console.alerts.price", values };
  }
  if (condition.kind === "wallet") {
    const { asset, minUsdMicros } = condition;
    const values = {
      side: { type: "choice", choice: condition.side ?? "any" },
      account: { type: "account", account: condition.account },
      hasToken: asset === undefined ? no : yes,
      token: asset === undefined ? no : assetValue(asset, assets),
      hasMin: minUsdMicros === undefined ? no : yes,
      min: { type: "usd", usdMicros: minUsdMicros ?? 0n },
    } as const;
    return { key: "console.alerts.wallet", values };
  }
  return { key: "console.alerts.launch", values: {} };
}

/** What an alert shows: the alert, the info of its tokens, and its agent. */
interface AlertItemProps {
  readonly alert: AlertView;
  readonly assets: AssetInfos;
  readonly agentName?: string;
}

// How often it fired, when last, whether it wakes the agent, and when it ends.
function AlertFacts(props: AlertItemProps): React.JSX.Element {
  const text = useText();
  const formatter = useFormatter();
  const { alert, agentName } = props;
  const { expiresAt, firedAt } = alert;
  return (
    <>
      <p className="text-muted-foreground">
        {text("console.alerts.facts", {
          fires: alert.fires ?? 0,
          wake: alert.wake === true ? "yes" : "no",
          hasExpiry: expiresAt === undefined ? "no" : "yes",
          expiry: expiresAt === undefined ? "" : formatter.dateTime(expiresAt),
        })}
      </p>
      {firedAt === undefined ? null : (
        <p className="text-muted-foreground">
          {text("console.alerts.lastFired", { at: formatter.dateTime(firedAt) })}
        </p>
      )}
      {agentName === undefined ? null : (
        <p className="text-muted-foreground">{text("console.orders.agent", { name: agentName })}</p>
      )}
    </>
  );
}

// Delete, asked once more in the page before `alert/delete` runs, for a connection with `propose`.
function AlertDelete(props: { readonly alert: AlertView }): React.JSX.Element | null {
  const text = useText();
  const { ready } = useEngine();
  const remove = useDeleteAlert();
  const [isAsking, ask] = useState(false);
  if (!ready.scopes.includes("propose")) {
    return null;
  }
  const act = (): void => {
    ask(false);
    remove.mutate(props.alert.alert);
  };
  return (
    <div className="flex w-full flex-col gap-2">
      <FailedAlert error={remove.error} wordsKey="console.alerts.failed" />
      {isAsking ? (
        <>
          <p className="text-sm">{text("console.alerts.deleteAsk")}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="destructive" onClick={act}>
              {text("console.alerts.deleteConfirm")}
            </Button>
            <Button type="button" variant="outline" onClick={() => ask(false)}>
              {text("console.alerts.keep")}
            </Button>
          </div>
        </>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="self-start"
          disabled={remove.isPending}
          onClick={() => ask(true)}
        >
          <Trash2Icon data-icon="inline-start" strokeWidth={1.5} aria-hidden />
          {text("console.alerts.delete")}
        </Button>
      )}
    </div>
  );
}

/**
 * One active alert (decisions 0244 and 0245): what it watches, how often it fired, whether it wakes
 * the agent, and Delete. An alert never trades, so a delete opens no card.
 */
export function AlertItem(props: AlertItemProps): React.JSX.Element {
  const formatter = useFormatter();
  const line = conditionLine(props.alert, props.assets);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base break-words">
          {cardLineText(line, { formatter, assets: props.assets })}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 text-sm">
        <AlertFacts {...props} />
      </CardContent>
      <CardFooter>
        <AlertDelete alert={props.alert} />
      </CardFooter>
    </Card>
  );
}
