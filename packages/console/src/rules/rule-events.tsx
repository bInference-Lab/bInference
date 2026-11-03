import { displayOutsideText, reasonText } from "@binference/i18n";
import type { ProtocolId, WebhookEventView } from "@binference/protocol";
import { Button } from "../components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { useFormatter, useText, type Words } from "../i18n/console-text";
import { ScreenState } from "../screens/screen-state";
import { useRuleEvents } from "./use-webhook-rules";

// An alert's `id` is the sender's text, up to 128 characters, shown whole and made visible.
const alertIdLength = 128;

// What became of the alert: a fill, a skip and why when its words name nothing the list lacks.
function outcomeOf(text: Words, event: WebhookEventView, reason: string | undefined): string {
  return text("console.rules.event.outcome", {
    taken: event.taken,
    fill: event.fill ?? "waiting",
    hasReason: reason === undefined ? "no" : "yes",
    reason: reason ?? "",
  });
}

function EventRow(props: { readonly event: WebhookEventView }): React.JSX.Element {
  const text = useText();
  const formatter = useFormatter();
  const { event } = props;
  const reason = event.reason === undefined ? undefined : reasonText(formatter, event.reason);
  return (
    <TableRow>
      <TableCell>{formatter.dateTime(event.receivedAt)}</TableCell>
      <TableCell className="whitespace-normal">{outcomeOf(text, event, reason)}</TableCell>
      <TableCell className="break-all whitespace-normal">
        {event.alertId === undefined ? "" : displayOutsideText(event.alertId, alertIdLength)}
      </TableCell>
    </TableRow>
  );
}

/**
 * What each alert to a rule's URL became, newest first, a page of 20 at a time
 * (`webhookRule/events`): filled, skipped and why, a repeat, or over its rate. An alert's body
 * never shows: binference reads nothing of it but its `id`.
 */
export function RuleEvents(props: {
  readonly rule: ProtocolId<"webhookRule">;
  readonly name: string;
}): React.JSX.Element {
  const text = useText();
  const events = useRuleEvents(props.rule);
  const items = events.data?.pages.flatMap((page) => page.items);
  if (items === undefined) {
    return <ScreenState error={events.error} />;
  }
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{text("console.rules.eventsEmpty")}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <Table aria-label={text("console.rules.eventsTitle", { name: props.name })}>
        <TableHeader>
          <TableRow>
            <TableHead>{text("console.rules.event.when")}</TableHead>
            <TableHead>{text("console.rules.event.what")}</TableHead>
            <TableHead>{text("console.rules.event.id")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((event) => (
            <EventRow key={event.event} event={event} />
          ))}
        </TableBody>
      </Table>
      {events.hasNextPage ? (
        <Button
          type="button"
          variant="outline"
          className="self-start"
          disabled={events.isFetchingNextPage}
          onClick={() => void events.fetchNextPage()}
        >
          {text("console.rules.olderEvents")}
        </Button>
      ) : null}
    </div>
  );
}
