import { shortAddress } from "@binference/i18n";
import { Button } from "../components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { useAgents } from "../connection/use-agents";
import { useFormatter, useText } from "../i18n/console-text";
import { type LedgerEntry, useLedger } from "../ledger/use-ledger";
import { PaperBadge, ScreenState } from "./screen-state";

function isPaper(entry: LedgerEntry): boolean {
  return entry.data["paper"] === true;
}

function LedgerRows(props: { readonly entries: readonly LedgerEntry[] }): React.JSX.Element {
  const text = useText();
  const formatter = useFormatter();
  const agents = new Map((useAgents() ?? []).map((agent) => [agent.agent, agent.name]));
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{text("console.ledger.when")}</TableHead>
          <TableHead>{text("console.ledger.agent")}</TableHead>
          <TableHead>{text("console.ledger.event")}</TableHead>
          <TableHead>{text("console.ledger.subject")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.entries.map((entry) => (
          <TableRow key={entry.entry}>
            <TableCell className="whitespace-nowrap">{formatter.dateTime(entry.at)}</TableCell>
            <TableCell>
              {entry.agent === undefined
                ? text("console.ledger.wholeInstall")
                : (agents.get(entry.agent) ?? shortAddress(entry.agent))}
            </TableCell>
            <TableCell>
              <span className="flex flex-wrap items-center gap-2">
                {text("console.ledger.kind", { kind: entry.kind })}
                {isPaper(entry) ? <PaperBadge /> : null}
              </span>
            </TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground">
              {shortAddress(entry.subject)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** The hash-chained ledger, newest first, with the Paper label on every paper entry. */
export function LedgerScreen(): React.JSX.Element {
  const text = useText();
  const ledger = useLedger();
  const entries = ledger.data?.pages.flatMap((page) => page.entries);
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">{text("console.ledger.title")}</h1>
      {entries === undefined ? <ScreenState error={ledger.error} /> : null}
      {entries?.length === 0 ? (
        <p className="text-sm text-muted-foreground">{text("console.ledger.empty")}</p>
      ) : null}
      {entries !== undefined && entries.length > 0 ? <LedgerRows entries={entries} /> : null}
      {ledger.hasNextPage ? (
        <Button
          variant="outline"
          className="self-start"
          disabled={ledger.isFetchingNextPage}
          onClick={() => void ledger.fetchNextPage()}
        >
          {text("console.ledger.older")}
        </Button>
      ) : null}
    </section>
  );
}
