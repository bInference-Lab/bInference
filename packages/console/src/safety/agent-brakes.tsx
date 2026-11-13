import type { AgentView } from "@binference/protocol";
import { Button } from "../components/ui/button";
import { useFormatter, useText } from "../i18n/console-text";
import type { BrakeScope } from "./use-brakes";
import type { SafetyStatus } from "./use-safety-status";

/** What the agent list may do: freeze with `confirm`, ask for an unfreeze with `loosen`. */
export interface AgentBrakeActions {
  /** Asks once more, then freezes; absent without `confirm`. */
  readonly freeze?: (scope: BrakeScope) => void;
  /** Opens the unfreeze card; absent without `loosen` or while the breaker holds. */
  readonly unfreeze?: (scope: BrakeScope) => void;
  readonly isBusy: boolean;
}

// One agent's freeze as the owner reads it: the owner's own since when, the breaker's, or none.
type Held =
  | { readonly state: "frozen"; readonly frozenAt: number }
  | { readonly state: "breaker" | "free" };

function heldOf(status: SafetyStatus, agent: AgentView): Held {
  const own = status.agents?.find((frozen) => frozen.agent === agent.agent);
  if (own !== undefined) {
    return { state: "frozen", frozenAt: own.frozenAt };
  }
  return { state: status.breaker === undefined ? "free" : "breaker" };
}

function AgentBrakeItem(props: {
  readonly agent: AgentView;
  readonly status: SafetyStatus;
  readonly actions: AgentBrakeActions;
}): React.JSX.Element {
  const text = useText();
  const formatter = useFormatter();
  const { agent, actions } = props;
  const held = heldOf(props.status, agent);
  const scope = { agent: agent.agent, name: agent.name };
  const when = held.state === "frozen" ? formatter.dateTime(held.frozenAt) : "";
  const isFrozen = held.state === "frozen";
  const act = isFrozen ? actions.unfreeze : actions.freeze;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
      <span className="min-w-0 font-medium break-words">{agent.name}</span>
      <span className="mr-auto text-muted-foreground">
        {text("console.safety.agentState", { state: held.state, when })}
      </span>
      {act === undefined ? null : (
        <Button variant="outline" size="sm" disabled={actions.isBusy} onClick={() => act(scope)}>
          {text(isFrozen ? "console.safety.unfreezeAgent" : "console.safety.freezeAgent", {
            name: agent.name,
          })}
        </Button>
      )}
    </li>
  );
}

/**
 * Each agent not archived with its freeze: frozen by the owner since when, held by the breaker
 * alone, or not frozen; and Freeze for one that is not frozen by the owner, or Unfreeze for one
 * that is, as `actions` allows.
 */
export function AgentBrakes(props: {
  readonly agents: readonly AgentView[];
  readonly status: SafetyStatus;
  readonly actions: AgentBrakeActions;
}): React.JSX.Element {
  const text = useText();
  return (
    <ul aria-label={text("console.safety.agents")} className="flex flex-col divide-y">
      {props.agents.map((agent) => (
        <AgentBrakeItem
          key={agent.agent}
          agent={agent}
          status={props.status}
          actions={props.actions}
        />
      ))}
    </ul>
  );
}
