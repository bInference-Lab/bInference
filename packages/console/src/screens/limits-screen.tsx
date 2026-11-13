import { addressPartOf, displayOutsideText, limitLines } from "@binference/i18n";
import type { AgentView, LimitsView, WalletView } from "@binference/protocol";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { useEngine } from "../connection/engine-context";
import { FailedAlert } from "../connection/failed-alert";
import { useAgents } from "../connection/use-agents";
import { MessageText, useFormatter, useText } from "../i18n/console-text";
import { LimitForm } from "../limits/limit-form";
import { PendingLimits } from "../limits/pending-limits";
import { useCancelPending } from "../limits/use-limit-change";
import { ScreenState } from "./screen-state";

// Each limit and its value: the one in effect, or the one it takes once its 24 hours end.
function LimitTable(props: {
  readonly lines: ReturnType<typeof limitLines>;
  readonly isWaiting?: boolean;
}): React.JSX.Element {
  const text = useText();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{text("console.limits.limit")}</TableHead>
          <TableHead>
            {text(props.isWaiting === true ? "console.limits.then" : "console.limits.value")}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.lines.map((line) => (
          <TableRow key={line.field === "gasReserve" ? `gas:${line.chain}` : line.field}>
            <TableCell>{line.name}</TableCell>
            <TableCell className="whitespace-normal">{line.value}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// The agent's launch wallet, which alone trades on a launch's own curve (decision 0217).
function LaunchWallet(props: { readonly wallet: WalletView }): React.JSX.Element {
  const text = useText();
  const { label, address } = props.wallet;
  const values = {
    label: displayOutsideText(label, 64),
    address: addressPartOf(address),
  };
  return (
    <p className="text-sm">
      <MessageText text={text("console.limits.launchWallet", values)} />
    </p>
  );
}

// The looser limits that wait with Cancel, what a cancel did, and the form that changes a limit
// for a connection with `confirm`.
function ChangeLimits(props: {
  readonly agent: AgentView;
  readonly view: LimitsView;
}): React.JSX.Element {
  const { agent, view } = props;
  const { ready } = useEngine();
  const text = useText();
  const formatter = useFormatter();
  const cancel = useCancelPending(agent.agent);
  return (
    <>
      {view.pending === undefined ? null : (
        <PendingLimits
          pending={view.pending}
          cancel={cancel}
          table={<LimitTable lines={limitLines(view.pending.changes, { formatter })} isWaiting />}
        />
      )}
      {cancel.isSuccess ? (
        <output className="text-sm">{text("console.limits.cancelled")}</output>
      ) : null}
      <FailedAlert error={cancel.error} wordsKey="console.limits.failed" />
      {ready.scopes.includes("confirm") ? (
        <LimitForm agent={agent} view={view} />
      ) : (
        <p className="text-sm text-muted-foreground">{text("console.limits.noScope")}</p>
      )}
    </>
  );
}

function AgentLimits(props: { readonly agent: AgentView }): React.JSX.Element {
  const { agent } = props;
  const { client } = useEngine();
  const text = useText();
  const formatter = useFormatter();
  const limits = useQuery({
    queryKey: ["limits", agent.agent],
    queryFn: async ({ signal }) => client.call("limit/get", { agent: agent.agent }, { signal }),
  });
  const view = limits.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {text("console.limits.agent", { name: agent.name, mode: agent.mode })}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {agent.launchWallet === undefined ? null : <LaunchWallet wallet={agent.launchWallet} />}
        {view === undefined ? (
          <ScreenState error={limits.error} />
        ) : (
          <>
            <LimitTable lines={limitLines(view, { formatter })} />
            <ChangeLimits agent={agent} view={view} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Each agent's limits in effect, the looser ones that wait 24 hours with Cancel, and the form that
 * changes one: a stricter value applies at once, a looser one waits (decision 0111).
 */
export function LimitsScreen(): React.JSX.Element {
  const text = useText();
  const agents = useAgents()?.filter((agent) => agent.archivedAt === undefined);
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">{text("console.limits.title")}</h1>
      {agents === undefined ? <ScreenState error={null} /> : null}
      {agents?.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          <MessageText text={text("console.limits.noAgents")} />
        </p>
      ) : null}
      {agents?.map((agent) => (
        <AgentLimits key={agent.agent} agent={agent} />
      ))}
    </section>
  );
}
