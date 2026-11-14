import { RotateCwIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "../components/ui/button";
import { useEngine } from "../connection/engine-context";
import { MessageText, useText } from "../i18n/console-text";
import { LogLines } from "../logs/log-lines";
import { type LogLevel, useRecentLogs } from "../logs/use-recent-logs";
import { ScreenState } from "./screen-state";

const levels: readonly LogLevel[] = ["debug", "info", "warn", "error"];

// The lines of the level asked for, with what was left out, or why they could not load.
function RecentLines(props: { readonly level: LogLevel }): React.JSX.Element {
  const text = useText();
  const recent = useRecentLogs(props.level);
  if (recent.data === undefined) {
    return <ScreenState error={recent.error} />;
  }
  const { items, omitted, cut } = recent.data;
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="self-start"
        disabled={recent.isFetching}
        onClick={() => void recent.refetch()}
      >
        <RotateCwIcon data-icon="inline-start" strokeWidth={1.5} aria-hidden />
        {text("console.logs.reload")}
      </Button>
      {cut === true ? (
        <p className="text-sm text-muted-foreground">
          <MessageText text={text("console.logs.cut")} />
        </p>
      ) : null}
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{text("console.logs.none")}</p>
      ) : (
        <LogLines lines={items} />
      )}
      {omitted === 0 ? null : (
        <p className="text-sm text-muted-foreground">
          {text("console.logs.omitted", { count: omitted })}
        </p>
      )}
    </>
  );
}

/**
 * The engine log's newest lines (decision 0446), kept by the support bundle's field rules, at the
 * level the owner picks, read again on Reload. A connection without `admin`, such as the Mini App,
 * is told where to read them.
 */
export function LogsScreen(): React.JSX.Element {
  const text = useText();
  const { ready } = useEngine();
  const [level, pick] = useState<LogLevel>("info");
  const canRead = ready.scopes.includes("admin");
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">{text("console.logs.title")}</h1>
      <p className="text-sm text-muted-foreground">
        <MessageText text={text("console.logs.intro")} />
      </p>
      {canRead ? (
        <>
          <p className="text-sm text-muted-foreground">
            <MessageText text={text("console.logs.omittedMark")} />
          </p>
          <fieldset className="flex flex-wrap gap-2">
            <legend className="sr-only">{text("console.logs.levels")}</legend>
            {levels.map((each) => (
              <Button
                key={each}
                type="button"
                variant={each === level ? "default" : "outline"}
                aria-pressed={each === level}
                onClick={() => pick(each)}
              >
                {text("console.logs.level", { level: each })}
              </Button>
            ))}
          </fieldset>
          <RecentLines level={level} />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          <MessageText text={text("console.logs.noAdmin")} />
        </p>
      )}
    </section>
  );
}
