import { cardLineText } from "@binference/i18n";
import type { CardLinesView, IntentView } from "@binference/protocol";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, XIcon } from "lucide-react";
import { CardLine } from "../cards/card-line";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "../components/ui/card";
import { useEngine } from "../connection/engine-context";
import { errorWords } from "../connection/error-words";
import { useFormatter, useText } from "../i18n/console-text";
import { useFocusedCard } from "../push/use-focused-card";
import { PaperBadge } from "./screen-state";

/** What the owner answers, and the card version they read. */
interface Answer {
  readonly verb: "confirm" | "deny";
  readonly shown: CardLinesView;
}

function useAnswer(intent: IntentView["intent"]) {
  const { client } = useEngine();
  const queries = useQueryClient();
  return useMutation({
    mutationFn: async ({ verb, shown }: Answer) => {
      const signal = AbortSignal.timeout(30_000);
      const args = { intent, card: shown.card };
      return verb === "confirm"
        ? client.call("intent/confirm", { ...args, cardVersion: shown.version }, { signal })
        : client.call("intent/deny", args, { signal });
    },
    onSettled: async () => queries.invalidateQueries({ queryKey: ["intents"] }),
  });
}

function AnswerButtons(props: {
  readonly answer: ReturnType<typeof useAnswer>;
  readonly shown: CardLinesView | undefined;
}): React.JSX.Element {
  const { answer, shown } = props;
  const { ready } = useEngine();
  const text = useText();
  if (!ready.scopes.includes("confirm")) {
    return <p className="text-sm text-muted-foreground">{text("console.confirmations.noScope")}</p>;
  }
  const isIdle = shown !== undefined && !answer.isPending;
  return (
    <>
      <Button disabled={!isIdle} onClick={() => shown && answer.mutate({ verb: "confirm", shown })}>
        <CheckIcon data-icon="inline-start" strokeWidth={1.5} aria-hidden />
        {text("console.confirmations.confirm")}
      </Button>
      <Button
        variant="outline"
        disabled={!isIdle}
        onClick={() => shown && answer.mutate({ verb: "deny", shown })}
      >
        <XIcon data-icon="inline-start" strokeWidth={1.5} aria-hidden />
        {text("console.confirmations.cancel")}
      </Button>
    </>
  );
}

/**
 * One card that waits for the owner, drawn line by line as Telegram draws it (spec 4), its status
 * icons as line icons, with Confirm and Cancel for a connection that holds the `confirm` scope. A Confirm names the card
 * version it shows, so a new quote is never confirmed unseen.
 */
export function PendingCard(props: { readonly intent: IntentView }): React.JSX.Element {
  const { intent } = props;
  const { isFocused, showIn } = useFocusedCard(intent.intent);
  const { client } = useEngine();
  const text = useText();
  const formatter = useFormatter();
  const card = useQuery({
    queryKey: ["intents", "card", intent.intent, intent.card?.version],
    queryFn: async ({ signal }) =>
      client.call("intent/card", { intent: intent.intent }, { signal }),
  });
  const answer = useAnswer(intent.intent);
  const lines = (card.data?.lines ?? []).map((line) =>
    cardLineText(line, { formatter, assets: card.data?.assets ?? {} }),
  );
  const [header, ...rest] = lines;
  const shown = card.data;
  return (
    <Card
      ref={showIn}
      aria-busy={card.isPending}
      className={isFocused ? "ring-2 ring-gold" : undefined}
    >
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {header === undefined ? null : <CardLine text={header} />}
          {intent.paper ? <PaperBadge /> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 text-sm">
        {rest.map((line) => (
          <p key={line}>
            <CardLine text={line} />
          </p>
        ))}
        {answer.error === null ? null : (
          <Alert variant="destructive">
            <AlertDescription>
              {text("console.confirmations.failed", { reason: errorWords(text, answer.error) })}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <AnswerButtons answer={answer} shown={shown} />
      </CardFooter>
    </Card>
  );
}
