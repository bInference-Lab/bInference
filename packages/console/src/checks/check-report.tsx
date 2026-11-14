import type { CheckFindingView, CheckReportView } from "@binference/protocol";
import { useId } from "react";
import { Badge } from "../components/ui/badge";
import { MessageText, useFormatter, useText } from "../i18n/console-text";

const levelVariants = {
  ok: "outline",
  warn: "secondary",
  fail: "destructive",
  skip: "outline",
} as const;

// A finding's own words: a key of the shared `check` area and its values, never an error's text.
function wordsOf(finding: CheckFindingView): CheckFindingView["message"] {
  // oxlint-disable-next-line eslint/no-restricted-properties -- a finding's words are an i18n key and its values, which the page then picks; no error message is read
  return finding.message;
}

// One finding as the terminal prints it: its words, then each line that explains it.
function FindingWords(props: { readonly finding: CheckFindingView }): React.JSX.Element {
  const text = useText();
  const words = wordsOf(props.finding);
  const { more } = props.finding;
  return (
    <div className="flex flex-col gap-1">
      {words === undefined ? null : (
        <p>
          <MessageText text={text(words.key, words.values)} />
        </p>
      )}
      {(more ?? []).map((line) => (
        <p
          key={`${line.key}/${JSON.stringify(line.values ?? {})}`}
          className="text-muted-foreground"
        >
          <MessageText text={text(line.key, line.values)} />
        </p>
      ))}
    </div>
  );
}

// The findings of one level under its heading, each with its check id; none shows nothing.
function FindingGroup(props: {
  readonly heading: string;
  readonly findings: readonly CheckFindingView[];
}): React.JSX.Element | null {
  const id = useId();
  if (props.findings.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="text-base font-semibold">
        {props.heading}
      </h2>
      <ul className="flex flex-col gap-3">
        {props.findings.map((finding) => (
          <li key={finding.check} className="flex flex-col gap-1 rounded-md border p-3 text-sm">
            <code className="font-mono text-xs text-muted-foreground">{finding.check}</code>
            <FindingWords finding={finding} />
          </li>
        ))}
      </ul>
    </section>
  );
}

// Every other check by its id and level: those that passed with nothing to say, and those this
// system gives nothing to read.
function OtherChecks(props: { readonly findings: readonly CheckFindingView[] }): React.JSX.Element {
  const text = useText();
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="text-base font-semibold">
        {text("console.checks.rest")}
      </h2>
      <ul className="flex flex-wrap gap-2">
        {props.findings.map(({ check, level }) => (
          <li key={check} className="flex items-center gap-1.5 text-xs">
            <code className="font-mono">{check}</code>
            <Badge variant={levelVariants[level]}>{text("console.checks.level", { level })}</Badge>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * A check report as `binference check` prints it (decision 0445): how many checks ran, with their
 * problems and warnings counted, what the ceiling promises, then the problems, the warnings and
 * the notes, each in its words with its next step, and every other check by its id and level.
 */
export function CheckReport(props: { readonly report: CheckReportView }): React.JSX.Element {
  const text = useText();
  const formatter = useFormatter();
  const { findings, ranAt } = props.report;
  const of = (level: CheckFindingView["level"]) => findings.filter((each) => each.level === level);
  const notes = of("ok").filter((each) => wordsOf(each) !== undefined);
  const rest = findings.filter(
    (each) => each.level === "skip" || (each.level === "ok" && wordsOf(each) === undefined),
  );
  const counts = {
    checks: findings.length,
    problems: of("fail").length,
    warnings: of("warn").length,
  };
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm font-medium">{text("check.summary", counts)}</p>
      <p className="text-sm text-muted-foreground">
        {text("console.checks.ranAt", { at: formatter.dateTime(ranAt) })}
      </p>
      <p className="text-sm text-muted-foreground">{text("check.ceilingPromise")}</p>
      <FindingGroup heading={text("console.checks.problems")} findings={of("fail")} />
      <FindingGroup heading={text("console.checks.warnings")} findings={of("warn")} />
      <FindingGroup heading={text("console.checks.notes")} findings={notes} />
      {rest.length === 0 ? null : <OtherChecks findings={rest} />}
    </div>
  );
}
