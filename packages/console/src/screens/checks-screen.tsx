import { ListChecksIcon } from "lucide-react";
import { CheckReport } from "../checks/check-report";
import { useCheckRun } from "../checks/use-check-run";
import { Button } from "../components/ui/button";
import { useEngine } from "../connection/engine-context";
import { FailedAlert } from "../connection/failed-alert";
import { MessageText, useText } from "../i18n/console-text";

/**
 * The checks of `binference check` (decision 0445), run in the engine when the owner asks, with
 * the report in the terminal's words. A connection without `admin`, such as the Mini App, is told
 * where to run them; a fix runs only in the terminal.
 */
export function ChecksScreen(): React.JSX.Element {
  const text = useText();
  const { ready } = useEngine();
  const run = useCheckRun();
  const canRun = ready.scopes.includes("admin");
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">{text("console.checks.title")}</h1>
      <p className="text-sm text-muted-foreground">
        <MessageText text={text("console.checks.intro")} />
      </p>
      {canRun ? (
        <>
          <Button
            type="button"
            className="self-start"
            disabled={run.isPending}
            onClick={() => run.mutate()}
          >
            <ListChecksIcon data-icon="inline-start" strokeWidth={1.5} aria-hidden />
            {text(run.data === undefined ? "console.checks.run" : "console.checks.runAgain")}
          </Button>
          <FailedAlert error={run.error} wordsKey="console.checks.failed" />
          {run.data === undefined ? (
            <p className="text-sm text-muted-foreground">{text("console.checks.none")}</p>
          ) : (
            <CheckReport report={run.data} />
          )}
          <p className="text-sm text-muted-foreground">
            <MessageText text={text("console.checks.fixInTerminal")} />
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          <MessageText text={text("console.checks.noAdmin")} />
        </p>
      )}
    </section>
  );
}
