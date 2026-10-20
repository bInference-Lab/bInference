import type { AgentView } from "@binference/protocol";
import { useId } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { useAgents } from "../connection/use-agents";
import { MessageText, useText } from "../i18n/console-text";
import { HoldingSectionView } from "../portfolio/holding-section";
import { usePortfolio } from "../portfolio/use-portfolio";
import { ScreenState } from "./screen-state";

function AgentHoldings(props: { readonly agent: AgentView }): React.JSX.Element {
  const text = useText();
  const { portfolio, error } = usePortfolio(props.agent.agent);
  if (portfolio === undefined) {
    return <ScreenState error={error} />;
  }
  if (portfolio.sections.length === 0) {
    return <p className="text-sm text-muted-foreground">{text("console.portfolio.empty")}</p>;
  }
  return (
    <>
      {portfolio.sections.map((section) => (
        <HoldingSectionView
          key={section.mode}
          section={section}
          wallets={portfolio.wallets}
          assets={portfolio.assets}
        />
      ))}
    </>
  );
}

function AgentPortfolioCard(props: { readonly agent: AgentView }): React.JSX.Element {
  const { agent } = props;
  const text = useText();
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id={id}>
              {text("console.portfolio.agent", { name: agent.name, mode: agent.mode })}
            </h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <AgentHoldings agent={agent} />
        </CardContent>
      </Card>
    </section>
  );
}

/**
 * Each agent's portfolio: its wallets' balances and their USD values, its positions as P&L cards
 * and those closed in the last 7 days, live and paper in separate sections that are never added
 * together. A ledger push loads it again.
 */
export function PortfolioScreen(): React.JSX.Element {
  const text = useText();
  const agents = useAgents()?.filter((agent) => agent.archivedAt === undefined);
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">{text("console.portfolio.title")}</h1>
      {agents === undefined ? <ScreenState error={null} /> : null}
      {agents?.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          <MessageText text={text("console.portfolio.noAgents")} />
        </p>
      ) : null}
      {agents?.map((agent) => (
        <AgentPortfolioCard key={agent.agent} agent={agent} />
      ))}
    </section>
  );
}
