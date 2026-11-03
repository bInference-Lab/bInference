import type { IntentView } from "@binference/protocol";
import { usePendingIntents } from "../cards/use-pending-intents";
import { useAgents } from "../connection/use-agents";
import { MessageText, useText } from "../i18n/console-text";
import { RuleForm } from "../rules/rule-form";
import { RuleItem } from "../rules/rule-item";
import { type RulePage, useWebhookRules } from "../rules/use-webhook-rules";
import { ScreenState } from "./screen-state";

function RuleList(props: {
  readonly page: RulePage;
  readonly pending: readonly IntentView[];
}): React.JSX.Element {
  const text = useText();
  const { page, pending } = props;
  if (page.items.length === 0) {
    return <p className="text-sm text-muted-foreground">{text("console.rules.empty")}</p>;
  }
  return (
    <ul aria-label={text("console.rules.list")} className="flex flex-col gap-4">
      {page.items.map((rule) => {
        const card = pending.find((intent) => intent.intent === rule.intent);
        return (
          <li key={rule.rule}>
            <RuleItem
              rule={rule}
              assets={page.assets ?? {}}
              {...(card === undefined ? {} : { pending: card })}
            />
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The owner's alert rules (decisions 0299 and 0337): the form that makes one, whose URL shows
 * once, then each rule active or awaiting its card, with its card while it waits, the alerts its
 * URL took, and Rotate URL and Delete.
 */
export function RulesScreen(): React.JSX.Element {
  const text = useText();
  const agents = useAgents()?.filter((agent) => agent.archivedAt === undefined);
  const rules = useWebhookRules();
  const pending = usePendingIntents().data ?? [];
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">{text("console.rules.title")}</h1>
      <p className="text-sm text-muted-foreground">{text("console.rules.intro")}</p>
      {agents === undefined ? <ScreenState error={null} /> : null}
      {agents?.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          <MessageText text={text("console.rules.noAgents")} />
        </p>
      ) : null}
      {agents === undefined || agents.length === 0 ? null : <RuleForm agents={agents} />}
      <h2 className="text-base font-semibold">{text("console.rules.list")}</h2>
      {rules.data === undefined ? (
        <ScreenState error={rules.error} />
      ) : (
        <RuleList page={rules.data} pending={pending} />
      )}
    </section>
  );
}
