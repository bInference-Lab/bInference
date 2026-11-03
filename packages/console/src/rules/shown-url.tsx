import { CheckIcon, CopyIcon } from "lucide-react";
import { useId, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { useText } from "../i18n/console-text";

/**
 * A rule's URL as `webhookRule/create` or `webhookRule/rotateUrl` answered it, shown this once
 * (decision 0337): the page holds it in memory only, until the owner says they copied it.
 */
export function ShownUrl(props: {
  readonly url: string;
  readonly onDone: () => void;
}): React.JSX.Element {
  const text = useText();
  const id = useId();
  const [isCopied, setCopied] = useState(false);
  const copy = (): void => {
    navigator.clipboard.writeText(props.url).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };
  return (
    <Alert className="border-gold">
      <AlertTitle>{text("console.rules.urlOnce.title")}</AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <p>{text("console.rules.urlOnce.body")}</p>
        <label htmlFor={id} className="sr-only">
          {text("console.rules.urlOnce.label")}
        </label>
        <input
          id={id}
          readOnly
          value={props.url}
          spellCheck={false}
          autoComplete="off"
          onFocus={(event) => event.currentTarget.select()}
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 font-mono text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={copy}>
            <CopyIcon data-icon="inline-start" strokeWidth={1.5} aria-hidden />
            {text("console.rules.copy")}
          </Button>
          <Button type="button" onClick={props.onDone}>
            <CheckIcon data-icon="inline-start" strokeWidth={1.5} aria-hidden />
            {text("console.rules.done")}
          </Button>
          <output aria-live="polite" className="text-sm text-muted-foreground">
            {isCopied ? text("console.rules.copied") : ""}
          </output>
        </div>
      </AlertDescription>
    </Alert>
  );
}
