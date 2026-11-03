import { cardLineText, displayOutsideText } from "@binference/i18n";
import type { AssetInfos, IntentView, WebhookRuleView } from "@binference/protocol";
import { ListIcon, RotateCwIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "../components/ui/card";
import { useEngine } from "../connection/engine-context";
import { errorWords } from "../connection/error-words";
import { MessageText, useFormatter, useText } from "../i18n/console-text";
import { PendingCard } from "../screens/pending-card";
import { PaperBadge } from "../screens/screen-state";
import { RuleEvents } from "./rule-events";
import { ShownUrl } from "./shown-url";
import { useDeleteRule, useRotateRule } from "./use-webhook-rules";

// A rule's name is the owner's text, shown as cards show it: cut and made visible.
const nameLength = 64;

/** What a rule shows: the rule, the assets its summary names, and its card while it waits. */
interface RuleItemProps {
  readonly rule: WebhookRuleView;
  readonly assets: AssetInfos;
  readonly pending?: IntentView;
}

// The summary as the engine drew it, and the rule's rate, fills and expiry.
function RuleFacts(props: RuleItemProps): React.JSX.Element {
  const text = useText();
  const formatter = useFormatter();
  const { rule, assets } = props;
  const { request } = rule;
  const summary =
    rule.summary === undefined ? request.token : cardLineText(rule.summary, { formatter, assets });
  return (
    <>
      <p>{summary}</p>
      <p className="text-muted-foreground">
        {text("console.rules.facts", {
          rate: rule.ratePerMinute ?? request.ratePerMinute ?? 1,
          fills: rule.fills,
          maxFills: request.maxFills ?? 0,
          expiry: request.expiresAt === undefined ? "" : formatter.dateTime(request.expiresAt),
        })}
      </p>
      {rule.lastAlertAt === undefined ? null : (
        <p className="text-muted-foreground">
          {text("console.rules.lastAlert", { at: formatter.dateTime(rule.lastAlertAt) })}
        </p>
      )}
    </>
  );
}

type Asking = "rotate" | "delete" | undefined;

// The brakes, each asked once more before it applies: Rotate URL with `admin`, Delete with
// `confirm`.
function RuleBrakes(props: {
  readonly rule: WebhookRuleView;
  readonly rotate: ReturnType<typeof useRotateRule>;
  readonly remove: ReturnType<typeof useDeleteRule>;
}): React.JSX.Element {
  const text = useText();
  const { ready } = useEngine();
  const [asking, ask] = useState<Asking>(undefined);
  const { rule, rotate, remove } = props;
  if (asking !== undefined) {
    const act = (): void => {
      ask(undefined);
      (asking === "rotate" ? rotate : remove).mutate(rule.rule);
    };
    return (
      <div className="flex w-full flex-col gap-2">
        <p className="text-sm">{text(`console.rules.${asking}Ask`)}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={asking === "delete" ? "destructive" : "default"}
            onClick={act}
          >
            {text(`console.rules.${asking}Confirm`)}
          </Button>
          <Button type="button" variant="outline" onClick={() => ask(undefined)}>
            {text("console.rules.keep")}
          </Button>
        </div>
      </div>
    );
  }
  const isBusy = rotate.isPending || remove.isPending;
  return (
    <>
      {ready.scopes.includes("admin") ? (
        <Button type="button" variant="outline" disabled={isBusy} onClick={() => ask("rotate")}>
          <RotateCwIcon data-icon="inline-start" strokeWidth={1.5} aria-hidden />
          {text("console.rules.rotate")}
        </Button>
      ) : null}
      {ready.scopes.includes("confirm") ? (
        <Button type="button" variant="outline" disabled={isBusy} onClick={() => ask("delete")}>
          <Trash2Icon data-icon="inline-start" strokeWidth={1.5} aria-hidden />
          {text("console.rules.delete")}
        </Button>
      ) : null}
    </>
  );
}

/**
 * One alert rule (decision 0337): its name, its state, what each alert trades and its bounds, its
 * card while it waits, the alerts its URL took, and its brakes. A rotation shows the new URL this
 * once; neither a rotation nor a delete opens a card.
 */
export function RuleItem(props: RuleItemProps): React.JSX.Element {
  const text = useText();
  const { rule, pending } = props;
  const [isShowingEvents, showEvents] = useState(false);
  const rotate = useRotateRule();
  const remove = useDeleteRule();
  const name = displayOutsideText(rule.request.name, nameLength);
  const failure = rotate.error ?? remove.error;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <span>{name}</span>
          <Badge variant="outline">{text("console.rules.state", { state: rule.state })}</Badge>
          <PaperBadge />
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <RuleFacts {...props} />
        {rotate.data === undefined ? null : (
          <ShownUrl url={rotate.data.url} onDone={() => rotate.reset()} />
        )}
        {failure === null ? null : (
          <Alert variant="destructive">
            <AlertDescription>
              <MessageText
                text={text("console.rules.failed", { reason: errorWords(text, failure) })}
              />
            </AlertDescription>
          </Alert>
        )}
        {pending === undefined ? null : <PendingCard intent={pending} />}
        {isShowingEvents ? <RuleEvents rule={rule.rule} name={name} /> : null}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          aria-expanded={isShowingEvents}
          onClick={() => showEvents((now) => !now)}
        >
          <ListIcon data-icon="inline-start" strokeWidth={1.5} aria-hidden />
          {text(isShowingEvents ? "console.rules.hideEvents" : "console.rules.events")}
        </Button>
        <RuleBrakes rule={rule} rotate={rotate} remove={remove} />
      </CardFooter>
    </Card>
  );
}
