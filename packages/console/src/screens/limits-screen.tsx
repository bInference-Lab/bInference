import { limitLines } from "@binference/i18n";
import type { AgentView } from "@binference/protocol";
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
import { useAgents } from "../connection/use-agents";
import { MessageText, useFormatter, useText } from "../i18n/console-text";
import { ScreenState } from "./screen-state";

function LimitTable(props: { readonly lines: ReturnType<typeof limitLines> }): React.JSX.Element {
  const text = useText();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{text("console.limits.limit")}</TableHead>
          <TableHead>{text("console.limits.value")}</TableHead>
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
        {view === undefined ? (
          <ScreenState error={limits.error} />
        ) : (
          <LimitTable lines={limitLines(view, { formatter })} />
        )}
        {view?.pending === undefined ? null : (
          <>
            <p className="text-sm">
              <MessageText
                text={text("console.limits.pending", {
                  when: formatter.dateTime(view.pending.effectiveAt),
                })}
              />
            </p>
            <LimitTable lines={limitLines(view.pending.changes, { formatter })} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Each agent's limits in effect, and the looser ones that wait 24 hours. */
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
