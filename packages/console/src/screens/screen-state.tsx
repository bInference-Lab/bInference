import { Alert, AlertDescription } from "../components/ui/alert";
import { Skeleton } from "../components/ui/skeleton";
import { errorWords } from "../connection/error-words";
import { MessageText, useText } from "../i18n/console-text";

/** A screen's state before its data: loading, or why it could not load. */
export function ScreenState(props: { readonly error: Error | null }): React.JSX.Element {
  const text = useText();
  if (props.error === null) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <span className="sr-only">{text("console.loading")}</span>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  const reason = errorWords(text, props.error);
  return (
    <Alert variant="destructive">
      <AlertDescription>
        <MessageText text={text("console.loadFailed", { reason })} />
      </AlertDescription>
    </Alert>
  );
}

/** The Paper label of a paper card, entry or agent. */
export function PaperBadge(): React.JSX.Element {
  const text = useText();
  return (
    <span className="rounded-sm border border-gold px-1.5 py-0.5 text-xs text-gold">
      {text("console.paper")}
    </span>
  );
}
