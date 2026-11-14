import type { LogLineView } from "@binference/protocol";
import { Badge } from "../components/ui/badge";
import { useFormatter, useText } from "../i18n/console-text";

// A warning or an error line stands out; the others read as plain text.
const levelVariants = {
  debug: "outline",
  info: "outline",
  warn: "secondary",
  error: "destructive",
} as const;

// One line as the log writes it, in English: its time in the owner's zone, its level, subsystem
// and event, then each field as `name=value`.
function LogLine(props: { readonly line: LogLineView }): React.JSX.Element {
  const formatter = useFormatter();
  const { line } = props;
  const atMs = Date.parse(line.time);
  const fields = Object.entries(line.fields ?? {});
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-1.5">
      <time dateTime={line.time} className="text-muted-foreground">
        {Number.isNaN(atMs) ? line.time : formatter.dateTime(atMs)}
      </time>
      <Badge variant={levelVariants[line.level]}>{line.level}</Badge>
      <span>{line.subsystem}</span>
      <span className="font-medium">{line.event}</span>
      {fields.map(([name, value]) => (
        <span key={name} className="break-all text-muted-foreground">
          {`${name}=${String(value)}`}
        </span>
      ))}
    </div>
  );
}

/**
 * The engine log's lines as `log/recent` kept them (decision 0446), oldest first, each as the log
 * writes it; times show in the owner's zone.
 */
export function LogLines(props: { readonly lines: readonly LogLineView[] }): React.JSX.Element {
  const text = useText();
  return (
    <ol
      aria-label={text("console.logs.list")}
      className="flex flex-col divide-y rounded-md border px-3 font-mono text-xs"
    >
      {props.lines.map((line, index) => (
        // Two lines can share a time and an event; their place keeps their keys apart.
        <li key={`${line.time}/${String(index)}`}>
          <LogLine line={line} />
        </li>
      ))}
    </ol>
  );
}
