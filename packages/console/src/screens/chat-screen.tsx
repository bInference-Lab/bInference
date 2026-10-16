import type { AgentView } from "@binference/protocol";
import { useId, useState } from "react";
import { AgentChat } from "../chat/agent-chat";
import { useAgents } from "../connection/use-agents";
import { MessageText, useText } from "../i18n/console-text";
import { ScreenState } from "./screen-state";

function AgentPicker(props: {
  readonly agents: readonly AgentView[];
  readonly picked: AgentView;
  readonly pick: (agent: AgentView) => void;
}): React.JSX.Element | null {
  const text = useText();
  const id = useId();
  const { agents, picked } = props;
  if (agents.length < 2) {
    return null;
  }
  return (
    <div className="flex items-center gap-2 text-sm">
      <label htmlFor={id} className="text-muted-foreground">
        {text("console.chat.agent")}
      </label>
      <select
        id={id}
        value={picked.agent}
        onChange={(event) => {
          const next = agents.find((agent) => agent.agent === event.target.value);
          if (next !== undefined) {
            props.pick(next);
          }
        }}
        className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {agents.map((agent) => (
          <option key={agent.agent} value={agent.agent}>
            {agent.name}
          </option>
        ))}
      </select>
    </div>
  );
}

// The picked agent's chat, or why there is none.
function ChatBody(props: {
  readonly agents: readonly AgentView[] | undefined;
  readonly picked: AgentView | undefined;
}): React.JSX.Element {
  const text = useText();
  const { agents, picked } = props;
  if (agents === undefined) {
    return <ScreenState error={null} />;
  }
  if (picked === undefined) {
    return (
      <p className="text-sm text-muted-foreground">
        <MessageText text={text("console.chat.noAgents")} />
      </p>
    );
  }
  return <AgentChat key={picked.agent} agent={picked.agent} agentName={picked.name} />;
}

/**
 * The chat screen: the owner's chat with an agent, the same in the console and the Mini App. With
 * several agents, the owner picks one; each keeps its own chat.
 */
export function ChatScreen(): React.JSX.Element {
  const text = useText();
  const agents = useAgents()?.filter((agent) => agent.archivedAt === undefined);
  const [pickedId, setPickedId] = useState<AgentView["agent"] | undefined>(undefined);
  const picked = agents?.find((agent) => agent.agent === pickedId) ?? agents?.[0];
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">{text("console.chat.title")}</h1>
        {agents === undefined || picked === undefined ? null : (
          <AgentPicker agents={agents} picked={picked} pick={(agent) => setPickedId(agent.agent)} />
        )}
      </div>
      <ChatBody agents={agents} picked={picked} />
    </section>
  );
}
