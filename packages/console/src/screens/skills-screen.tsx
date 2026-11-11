import { useAgents } from "../connection/use-agents";
import { useText } from "../i18n/console-text";
import { ProposalItem } from "../skills/proposal-item";
import { usePendingProposals } from "../skills/use-skill-review";
import { WaitingSkills } from "../skills/waiting-skills";
import { ScreenState } from "./screen-state";

/**
 * The skills the agents propose and the workspace skills that wait (decision 0408): each pending
 * skill proposal with its findings, its changes, Apply and Reject; then each agent's waiting
 * skills with Accept. Nothing here applies without the owner's press.
 */
export function SkillsScreen(): React.JSX.Element {
  const text = useText();
  const proposals = usePendingProposals();
  const agents = useAgents()?.filter((agent) => agent.archivedAt === undefined) ?? [];
  const items = proposals.data?.items ?? [];
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">{text("console.skills.title")}</h1>
      <p className="text-sm text-muted-foreground">{text("console.skills.intro")}</p>
      <h2 className="text-base font-semibold">{text("console.skills.proposals")}</h2>
      {proposals.data === undefined ? <ScreenState error={proposals.error} /> : null}
      {proposals.data !== undefined && items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{text("console.skills.none")}</p>
      ) : null}
      {items.length === 0 ? null : (
        <ul aria-label={text("console.skills.proposals")} className="flex flex-col gap-4">
          {items.map((view) => (
            <li key={view.proposal}>
              <ProposalItem view={view} />
            </li>
          ))}
        </ul>
      )}
      <h2 className="text-base font-semibold">{text("console.skills.waitingList")}</h2>
      {agents.map((agent) => (
        <WaitingSkills key={agent.agent} agent={agent.agent} />
      ))}
    </section>
  );
}
